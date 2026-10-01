// Config versions (CLAUDE.md 6.1). Stored versions never change (only draft -> published),
// and the active version is the newest row of the activation journal, so publishing a
// new config needs no redeploy and rolling back loses nothing. Parsed configs and the
// active version are cached in memory: versions are immutable, and the active-version
// cache is dropped on every journal write. That is correct only with one service
// instance per process (one server instance, CLAUDE.md 2): app.ts creates it once and
// every module that needs versions gets that instance.
import { createHash } from 'node:crypto';
import {
  contract,
  DomainError,
  diffConfigs,
  lintConfig,
  parseConfig,
  resolveFunnel,
  type ConfigChange,
  type FunnelConfig,
  type LintErrorCode,
  type LintReport,
  type ResolvedFunnel,
  type VariantKey,
  type VersionSummary,
} from '@funnel/shared';
import type { Clock } from '../../clock.ts';
import type { ActivationRow, VersionRow, VersionsRepo } from './repo.ts';

/** Lint errors that make a version impossible to store (it would clash with stored ones). */
const IDENTITY_ERRORS: ReadonlySet<LintErrorCode> = new Set(['funnel_id', 'version_order']);

export interface UploadResult {
  row: VersionRow;
  lint: LintReport;
  created: boolean;
}

export interface ActiveVersion {
  version: number;
  config: FunnelConfig;
}

function hashConfig(json: string): string {
  return createHash('sha256').update(json).digest('hex');
}

const notFound = (version: number) =>
  new DomainError('not_found', `Version ${String(version)} not found`);

export function createVersionsService(repo: VersionsRepo, clock: Clock) {
  const configs = new Map<string, FunnelConfig>();
  const activeVersions = new Map<string, number>();

  function config(funnelId: string, version: number): FunnelConfig {
    const key = `${funnelId}@${String(version)}`;
    const cached = configs.get(key);
    if (cached) return cached;
    const row = repo.get(funnelId, version);
    if (!row) throw notFound(version);
    const parsed = parseConfig(JSON.parse(row.configJson));
    // Every stored config passed the same schema on upload.
    if (!parsed.ok) throw new DomainError('internal', `Stored config ${key} no longer parses`);
    configs.set(key, parsed.config);
    return parsed.config;
  }

  function findActive(funnelId: string): ActiveVersion | null {
    let version = activeVersions.get(funnelId);
    if (version === undefined) {
      // Misses are not cached: the funnel id comes from a public URL, and remembering
      // every unknown id would let anyone grow this map without bound.
      version = repo.latestActivation(funnelId)?.version;
      if (version === undefined) return null;
      activeVersions.set(funnelId, version);
    }
    return { version, config: config(funnelId, version) };
  }

  /**
   * Stores a config as a draft. Schema problems and lint errors that clash with stored
   * versions are 422; other lint errors are stored with the draft and block publishing,
   * so the admin can review them. The same config uploaded again is a no-op.
   */
  function upload(raw: unknown, releaseNote?: string): UploadResult {
    const parsed = parseConfig(raw);
    if (!parsed.ok) {
      throw new DomainError('unprocessable', 'Config does not match the schema', {
        issues: parsed.issues,
      });
    }
    const cfg = parsed.config;
    const previous = findActive(cfg.funnelId)?.config;
    const context = previous ? { previous } : {};
    const json = JSON.stringify(raw);
    const configHash = hashConfig(json);

    const stored = repo.findByHash(cfg.funnelId, configHash);
    if (stored) return { row: stored, lint: lintConfig(cfg, context), created: false };

    const existing = repo.list().map((v) => ({ funnelId: v.funnelId, version: v.version }));
    const lint = lintConfig(cfg, { ...context, existing });
    const clash = lint.errors.filter((e) => IDENTITY_ERRORS.has(e.code));
    if (clash.length > 0) {
      throw new DomainError('unprocessable', 'Config cannot be stored as a new version', {
        issues: clash.map((e) => `${e.code}: ${e.message}`),
      });
    }
    const row: VersionRow = {
      funnelId: cfg.funnelId,
      version: cfg.version,
      configJson: json,
      configHash,
      releaseNote: releaseNote ?? cfg.releaseNote ?? null,
      state: 'draft',
      createdAt: clock.now().toISOString(),
    };
    repo.insert(row);
    return { row, lint, created: true };
  }

  /** Draft -> published and active, in one transaction; blocked by lint errors. */
  function publish(funnelId: string, version: number, note?: string): ActivationRow {
    const row = repo.get(funnelId, version);
    if (!row) throw notFound(version);
    if (row.state !== 'draft') {
      throw new DomainError('conflict', `Version ${String(version)} is already published`);
    }
    const previous = findActive(funnelId);
    const lint = lintConfig(
      config(funnelId, version),
      previous ? { previous: previous.config } : {},
    );
    if (lint.errors.length > 0) {
      throw new DomainError('unprocessable', `Version ${String(version)} has lint errors`, lint);
    }
    return switchTo(funnelId, version, 'publish', note, () => {
      repo.markPublished(funnelId, version);
    });
  }

  /** One journal row (plus `before` in the same transaction); drops the active cache. */
  function switchTo(
    funnelId: string,
    version: number,
    action: ActivationRow['action'],
    note: string | undefined,
    before: () => void = () => undefined,
  ): ActivationRow {
    try {
      return repo.transaction(() => {
        before();
        return repo.appendActivation({
          funnelId,
          version,
          action,
          fromVersion: findActive(funnelId)?.version ?? null,
          note: note ?? null,
          createdAt: clock.now().toISOString(),
        });
      });
    } finally {
      activeVersions.delete(funnelId);
    }
  }

  // ---- admin API (6.1). One funnel per database: upload lint refuses another funnelId.

  function soleFunnelId(): string {
    const first = repo.list()[0];
    if (!first) throw new DomainError('not_found', 'No versions stored');
    return first.funnelId;
  }

  function publishedVersion(funnelId: string, version: number): VersionRow {
    const row = repo.get(funnelId, version);
    if (!row) throw notFound(version);
    if (row.state !== 'published') {
      throw new DomainError('conflict', `Version ${String(version)} is a draft: publish it first`);
    }
    return row;
  }

  function summaries(funnelId: string): VersionSummary[] {
    const activeNow = findActive(funnelId)?.version;
    const activations = repo.activations(funnelId);
    const counts = new Map(
      repo.sessionCounts(funnelId, clock.now().toISOString()).map((c) => [c.version, c]),
    );
    // repo.list() holds only this funnel: upload refuses another funnelId (one per database).
    return repo.list().map((row) => ({
      funnelId: row.funnelId,
      version: row.version,
      title: config(row.funnelId, row.version).title,
      state: row.state,
      releaseNote: row.releaseNote,
      createdAt: row.createdAt,
      // Newest first, so the first match is the latest time it became active.
      activatedAt: activations.find((a) => a.version === row.version)?.createdAt ?? null,
      active: row.version === activeNow,
      activeSessions: counts.get(row.version)?.active ?? 0,
      totalSessions: counts.get(row.version)?.total ?? 0,
    }));
  }

  function summary(funnelId: string, version: number): VersionSummary {
    const found = summaries(funnelId).find((s) => s.version === version);
    if (!found) throw notFound(version);
    return found;
  }

  const toActivation = (row: ActivationRow) => ({
    id: row.id,
    version: row.version,
    action: row.action,
    fromVersion: row.fromVersion,
    note: row.note,
    createdAt: row.createdAt,
  });

  const admin = {
    list() {
      const funnelId = soleFunnelId();
      return {
        versions: summaries(funnelId),
        activations: repo.activations(funnelId).map(toActivation),
      };
    },

    activeDetails() {
      const funnelId = soleFunnelId();
      const active = findActive(funnelId);
      if (!active) throw new DomainError('not_found', 'No active version');
      const row = repo.get(funnelId, active.version);
      if (!row) throw notFound(active.version);
      // The config as uploaded, including fields the schema ignores (4.1).
      const raw = contract.activeVersion.response.shape.config.parse(JSON.parse(row.configJson));
      return { version: summary(funnelId, active.version), config: raw };
    },

    uploadVersion(raw: unknown, releaseNote?: string) {
      const { row, lint, created } = upload(raw, releaseNote);
      return { version: summary(row.funnelId, row.version), lint, created };
    },

    /** Changes from `against` (default: the active version) to `version`, and its lint. */
    diff(version: number, against: number | 'active') {
      const funnelId = soleFunnelId();
      const target = config(funnelId, version);
      const base =
        against === 'active'
          ? findActive(funnelId)
          : { version: against, config: config(funnelId, against) };
      const changes: ConfigChange[] = base ? diffConfigs(base.config, target) : [];
      const lint = lintConfig(target, base ? { previous: base.config } : {});
      return { version, against: base?.version ?? null, changes, lint };
    },

    publishVersion(version: number, note?: string) {
      return { activation: toActivation(publish(soleFunnelId(), version, note)) };
    },

    /** Makes any published version active again (journal action `activate`). */
    activateVersion(version: number, note?: string) {
      const funnelId = soleFunnelId();
      publishedVersion(funnelId, version);
      if (findActive(funnelId)?.version === version) {
        throw new DomainError('conflict', `Version ${String(version)} is already active`);
      }
      return { activation: toActivation(switchTo(funnelId, version, 'activate', note)) };
    },

    /**
     * Back to the version that was active before the current one: the `fromVersion` of
     * the newest journal row. Only new sessions are affected; pinned ones keep theirs.
     */
    rollback(note?: string) {
      const funnelId = soleFunnelId();
      const target = repo.latestActivation(funnelId)?.fromVersion ?? null;
      if (target === null) {
        throw new DomainError('conflict', 'There is no previous version to roll back to');
      }
      publishedVersion(funnelId, target);
      return { activation: toActivation(switchTo(funnelId, target, 'rollback', note)) };
    },

    /** Resolved funnel of any stored version for in-memory preview: no session, no events. */
    preview(version: number, variant: VariantKey): { funnel: ResolvedFunnel } {
      return { funnel: resolveFunnel(config(soleFunnelId(), version), variant) };
    },
  };

  return {
    config,
    findActive,
    upload,
    publish,
    admin,

    /**
     * Published versions of the database's funnel with the active flag, oldest first.
     * Drafts never have sessions (6.2), so analytics compares only these.
     */
    published(): { funnelId: string; version: number; active: boolean }[] {
      const rows = repo.list().filter((row) => row.state === 'published');
      const first = rows[0];
      if (!first) return [];
      const activeNow = findActive(first.funnelId)?.version;
      return rows.map((row) => ({
        funnelId: row.funnelId,
        version: row.version,
        active: row.version === activeNow,
      }));
    },

    /** The active version; 404 when the funnel has never been published. */
    active(funnelId: string): ActiveVersion {
      const found = findActive(funnelId);
      if (!found) throw new DomainError('not_found', `Funnel "${funnelId}" has no active version`);
      return found;
    },

    /**
     * First start: the first config becomes the published, active version and the rest
     * are stored as drafts (CLAUDE.md 2, `pnpm seed`). Does nothing once any version exists.
     */
    seedIfEmpty(published: unknown, drafts: readonly unknown[]): boolean {
      if (!repo.isEmpty()) return false;
      try {
        repo.transaction(() => {
          const { row } = upload(published);
          publish(row.funnelId, row.version, 'seed');
          for (const draft of drafts) upload(draft);
        });
      } finally {
        // A failed seed rolls the rows back, so nothing read inside it may stay cached.
        configs.clear();
        activeVersions.clear();
      }
      return true;
    },
  };
}
export type VersionsService = ReturnType<typeof createVersionsService>;
