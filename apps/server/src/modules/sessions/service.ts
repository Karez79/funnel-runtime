// Sessions (CLAUDE.md 6.2, 6.3). The server decides everything that analytics later
// trusts: a new session always starts on the active version, its variant is assigned
// here (hash or an explicit QA override), UTM is stored once, and all of it is pinned
// to the row. Reading a session resolves its PINNED version, never the active one, so
// publishing or rolling back never changes a session that is already running.
import type { contract } from '@funnel/shared';
import {
  DomainError,
  resolveFunnel,
  SessionStateSchema,
  type ResolvedFunnel,
  type SessionResponse,
  type SessionState,
  type VariantKey,
} from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import type { Clock } from '../../clock.ts';
import { sameSecret } from '../../secrets.ts';
import type { VersionsService } from '../versions/service.ts';
import { assignVariant } from './assignment.ts';
import type { SessionRow, SessionsRepo } from './repo.ts';

const HOUR_MS = 60 * 60 * 1000;

export type CreateSessionInput = z.output<typeof contract.createSession.body> & {
  /** Value of the generator header, if sent. */
  generatorKey: string | undefined;
};

export function createSessionsService(
  repo: SessionsRepo,
  versions: VersionsService,
  clock: Clock,
  generatorKey: string,
) {
  // Versions are immutable, so a resolved variant of a version never changes.
  const resolvedCache = new Map<string, ResolvedFunnel>();

  function resolved(funnelId: string, version: number, variant: VariantKey): ResolvedFunnel {
    const key = `${funnelId}@${String(version)}:${variant}`;
    const cached = resolvedCache.get(key);
    if (cached) return cached;
    const funnel = resolveFunnel(versions.config(funnelId, version), variant);
    resolvedCache.set(key, funnel);
    return funnel;
  }

  function parseState(row: SessionRow): SessionState {
    const parsed = SessionStateSchema.safeParse(JSON.parse(row.stateJson));
    // Every stored state passed the same schema when it was written.
    if (!parsed.success) throw new DomainError('internal', `Session ${row.id} has a broken state`);
    return parsed.data;
  }

  function toResponse(row: SessionRow): SessionResponse {
    return {
      session: {
        id: row.id,
        funnelVersion: row.funnelVersion,
        experimentId: row.experimentId,
        variant: row.variant,
        variantSource: row.variantSource,
        state: parseState(row),
        stateRev: row.stateRev,
        resultId: row.resultId,
        expiresAt: row.expiresAt,
      },
      funnel: resolved(row.funnelId, row.funnelVersion, row.variant),
    };
  }

  /** The session if it exists and has not expired: 404 / 410 otherwise. */
  function live(id: string): SessionRow {
    const row = repo.get(id);
    if (!row) throw new DomainError('not_found', 'Session not found');
    if (new Date(row.expiresAt).getTime() <= clock.now().getTime()) {
      throw new DomainError('gone', 'Session has expired');
    }
    return row;
  }

  function create(input: CreateSessionInput): SessionResponse {
    const synthetic = input.trafficType === 'synthetic';
    if (synthetic && !sameSecret(input.generatorKey ?? '', generatorKey)) {
      throw new DomainError('forbidden', 'Synthetic traffic requires a valid generator key');
    }
    // Always the active version: sessions never start on drafts or older versions (6.2).
    const { version, config } = versions.active(input.funnelId);
    const id = uuidv7();
    const experimentId = config.experiment.id;
    const override = input.variantOverride;
    const variant = override ?? assignVariant(id, experimentId, config.experiment.variants);
    const funnel = resolved(config.funnelId, version, variant);
    const firstStep = funnel.sequence[0];
    if (firstStep === undefined) throw new DomainError('internal', 'Funnel has no steps');

    const now = clock.now();
    const createdAt = now.toISOString();
    const state: SessionState = { answers: {}, history: [], currentStepId: firstStep };
    const utm = {
      utmSource: input.utm.source ?? null,
      utmMedium: input.utm.medium ?? null,
      utmCampaign: input.utm.campaign ?? null,
    };
    const row: SessionRow = {
      id,
      funnelId: config.funnelId,
      funnelVersion: version,
      experimentId,
      variant,
      variantSource: override ? 'override' : 'hash',
      // An override is QA traffic even from the generator: QA is hidden by default (11.2).
      trafficType: override ? 'qa' : synthetic ? 'synthetic' : 'live',
      ...utm,
      utmContent: input.utm.content ?? null,
      utmTerm: input.utm.term ?? null,
      stateJson: JSON.stringify(state),
      stateRev: 0,
      resultId: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(now.getTime() + config.session.ttlHours * HOUR_MS).toISOString(),
    };
    repo.insertWithEvent(row, {
      eventId: `srv:session_started:${id}`,
      sessionId: id,
      name: 'session_started',
      funnelId: config.funnelId,
      funnelVersion: version,
      experimentId,
      variant,
      stepId: null,
      ...utm,
      clientTs: createdAt,
      serverTs: createdAt,
      clientSeq: null,
      origin: 'server',
      propsJson: '{}',
      flagsJson: '{}',
    });
    return toResponse(row);
  }

  return {
    create,

    get(id: string): SessionResponse {
      return toResponse(live(id));
    },
  };
}
export type SessionsService = ReturnType<typeof createSessionsService>;
