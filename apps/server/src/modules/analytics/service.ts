// Analytics API (CLAUDE.md 11.2). Selects rows with the filters the database can apply
// and hands them to the shared `aggregate`, the one definition of every metric that the
// generator's ground truth and `verify` use as well. Version and variant of each event
// come from its session row (the repo joins on it), never from the event.
// "Matches generator ground truth" recomputes every check of the newest uploaded ground
// truth from the database and compares it with the shared `compareSummaries`, the same
// comparison `pnpm verify` makes, so the line means the same on prod and locally.
import {
  aggregate,
  AnalyticsFiltersSchema,
  compareSummaries,
  DomainError,
  GroundTruthSchema,
  type GroundTruth,
  REJECT_REASONS,
  resolveFunnel,
  type AnalyticsFilters,
  type AnalyticsSummary,
  type AnalyticsVersion,
  type IngestQuality,
  type ResolvedFunnel,
  type VariantKey,
} from '@funnel/shared';
import { z } from 'zod';
import type { Clock } from '../../clock.ts';
import type { VersionsService } from '../versions/service.ts';
import type { AnalyticsRepo } from './repo.ts';

const Flags = z.looseObject({
  out_of_order: z.boolean().optional(),
  context_mismatch: z.boolean().optional(),
});
const Props = z.record(z.string(), z.unknown());
const Reason = z.enum(REJECT_REASONS);
/** A stored upload that no longer parses reads as "nothing uploaded". */
const StoredTruth = GroundTruthSchema.optional();
/** The upload answer lists at most this many differences; verify prints them all. */
const MAX_DIFFERENCES = 100;

/** Stored JSON is written by ingest; a malformed value reads as empty, not as a 500. */
function parseJson<T>(schema: z.ZodType<T>, json: string, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Filters arrive with any offset; stored timestamps are UTC ISO strings. */
const utc = (iso: string | undefined) =>
  iso === undefined ? undefined : new Date(iso).toISOString();

export function createAnalyticsService(
  repo: AnalyticsRepo,
  versions: VersionsService,
  clock: Clock,
) {
  // Versions are immutable, so a resolved variant never changes.
  const resolved = new Map<string, ResolvedFunnel>();
  function resolve(funnelId: string, version: number, variant: VariantKey): ResolvedFunnel {
    const key = `${funnelId}@${String(version)}:${variant}`;
    let funnel = resolved.get(key);
    if (!funnel) {
      funnel = resolveFunnel(versions.config(funnelId, version), variant);
      resolved.set(key, funnel);
    }
    return funnel;
  }

  function filters() {
    const list = versions.published();
    const funnelId = list[0]?.funnelId;
    return {
      versions: list.map((v) => ({ version: v.version, active: v.active })),
      campaigns: funnelId === undefined ? [] : repo.utmValues(funnelId, 'utmCampaign'),
      sources: funnelId === undefined ? [] : repo.utmValues(funnelId, 'utmSource'),
    };
  }

  function compute(filters: AnalyticsFilters): AnalyticsSummary {
    const list = versions.published();
    const funnelId = list[0]?.funnelId ?? '';
    const analyticsVersions: AnalyticsVersion[] = list.map((v) => ({
      version: v.version,
      active: v.active,
      funnels: { A: resolve(funnelId, v.version, 'A'), B: resolve(funnelId, v.version, 'B') },
    }));
    const period = { from: utc(filters.from), to: utc(filters.to) };
    const scope = {
      funnelId,
      includeQa: filters.includeQa,
      campaign: filters.campaign,
      ...period,
    };
    const ingest: IngestQuality = {
      duplicates: repo.duplicates(period),
      rejected: repo.rejectedByReason(period).flatMap(({ reason, count }) => {
        const known = Reason.safeParse(reason);
        return known.success ? [{ reason: known.data, count }] : [];
      }),
    };
    return aggregate({
      sessions: repo.sessions(scope),
      events: repo.events(scope).map((row) => {
        const flags = parseJson(Flags, row.flagsJson, {});
        return {
          eventId: row.eventId,
          sessionId: row.sessionId,
          name: row.name,
          stepId: row.stepId,
          serverTs: row.serverTs,
          properties: parseJson(Props, row.propsJson, {}),
          outOfOrder: flags.out_of_order === true,
          contextMismatch: flags.context_mismatch === true,
        };
      }),
      versions: analyticsVersions,
      ingest,
      filters,
      now: clock.now(),
    });
  }

  /** Differences per check, prefixed with the check's name; empty when all match. */
  function compareWith(truth: GroundTruth): string[] {
    return truth.checks.flatMap((check) => {
      const filters = AnalyticsFiltersSchema.safeParse(check.query);
      if (!filters.success) return [`${check.name}: invalid filters`];
      try {
        return compareSummaries(check.expected, compute(filters.data)).map(
          (line) => `${check.name}: ${line}`,
        );
      } catch (error) {
        // A version of the run that the server does not have is a mismatch, not a 500.
        if (error instanceof DomainError) return [`${check.name}: ${error.message}`];
        throw error;
      }
    });
  }

  return {
    filters,

    summary(query: AnalyticsFilters): AnalyticsSummary {
      const json = repo.latestGroundTruth();
      const truth = json === undefined ? undefined : parseJson(StoredTruth, json, undefined);
      return {
        ...compute(query),
        groundTruthMatches: truth === undefined ? null : compareWith(truth).length === 0,
      };
    },

    uploadGroundTruth(truth: GroundTruth) {
      repo.saveGroundTruth(JSON.stringify(truth), clock.now().toISOString());
      const differences = compareWith(truth);
      return {
        matches: differences.length === 0,
        differences: differences.slice(0, MAX_DIFFERENCES),
      };
    },
  };
}
export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
