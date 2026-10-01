// Config versions (CLAUDE.md 6.1). Stored versions never change (only draft -> published),
// and the active version is the newest row of the activation journal, so publishing a
// new config needs no redeploy and rolling back loses nothing. Parsed configs and the
// active version are cached in memory: versions are immutable, and the active-version
// cache is dropped on every journal write. That is correct only with one service
// instance per process (one server instance, CLAUDE.md 2): app.ts creates it once and
// every module that needs versions gets that instance.
import { createHash } from 'node:crypto';
import {
  DomainError,
  lintConfig,
  parseConfig,
  type FunnelConfig,
  type LintErrorCode,
  type LintReport,
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
    const activation = repo.transaction(() => {
      repo.markPublished(funnelId, version);
      return repo.appendActivation({
        funnelId,
        version,
        action: 'publish',
        fromVersion: previous?.version ?? null,
        note: note ?? null,
        createdAt: clock.now().toISOString(),
      });
    });
    activeVersions.delete(funnelId);
    return activation;
  }

  return {
    config,
    findActive,
    upload,
    publish,

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
