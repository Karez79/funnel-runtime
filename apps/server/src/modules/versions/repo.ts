// Storage of config versions and the append-only activation journal (CLAUDE.md 5, 6.1).
// Versions are never updated except draft -> published, and journal rows are never
// changed: the active version is simply the newest journal row.
import { and, count, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { funnelActivations, funnelVersions } from '../../db/schema.ts';

export type VersionRow = typeof funnelVersions.$inferSelect;
export type ActivationRow = typeof funnelActivations.$inferSelect;
type NewActivation = Omit<typeof funnelActivations.$inferInsert, 'id'>;

export function createVersionsRepo(db: Db) {
  return {
    /** Runs `fn` in one SQLite transaction; better-sqlite3 transactions are synchronous. */
    transaction<T>(fn: () => T): T {
      return db.transaction(() => fn());
    },

    isEmpty(): boolean {
      return db.select({ n: count() }).from(funnelVersions).get()?.n === 0;
    },

    list(): VersionRow[] {
      return db.select().from(funnelVersions).orderBy(funnelVersions.version).all();
    },

    get(funnelId: string, version: number): VersionRow | undefined {
      return db
        .select()
        .from(funnelVersions)
        .where(and(eq(funnelVersions.funnelId, funnelId), eq(funnelVersions.version, version)))
        .get();
    },

    findByHash(funnelId: string, configHash: string): VersionRow | undefined {
      return db
        .select()
        .from(funnelVersions)
        .where(
          and(eq(funnelVersions.funnelId, funnelId), eq(funnelVersions.configHash, configHash)),
        )
        .get();
    },

    insert(row: VersionRow): void {
      db.insert(funnelVersions).values(row).run();
    },

    markPublished(funnelId: string, version: number): void {
      db.update(funnelVersions)
        .set({ state: 'published' })
        .where(and(eq(funnelVersions.funnelId, funnelId), eq(funnelVersions.version, version)))
        .run();
    },

    appendActivation(row: NewActivation): ActivationRow {
      return db.insert(funnelActivations).values(row).returning().get();
    },

    latestActivation(funnelId: string): ActivationRow | undefined {
      return db
        .select()
        .from(funnelActivations)
        .where(eq(funnelActivations.funnelId, funnelId))
        .orderBy(desc(funnelActivations.id))
        .limit(1)
        .get();
    },
  };
}
export type VersionsRepo = ReturnType<typeof createVersionsRepo>;
