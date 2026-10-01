// First-start data (CLAUDE.md 2): configs/funnel-v1.json becomes the published, active
// version and configs/funnel-v2.json a draft, so publishing v2 shows versioning at work.
// funnel-v3.json is the second iteration and is never seeded: it arrives later through
// the admin API on the running server. The server calls this at every start (it does
// nothing once a version exists); `pnpm seed` runs the same function by hand.
import { readFileSync } from 'node:fs';
import { systemClock, type Clock } from '../clock.ts';
import { createVersionsRepo } from '../modules/versions/repo.ts';
import { createVersionsService } from '../modules/versions/service.ts';
import { loadEnv } from '../env.ts';
import { openDb, type Db } from './client.ts';
import { runMigrations } from './migrate.ts';

const CONFIGS_DIR = new URL('../../../../configs/', import.meta.url);
const PUBLISHED = 'funnel-v1.json';
const DRAFTS = ['funnel-v2.json'];

/** A config from `configs/` as raw JSON (tests derive variants of it). */
export function readConfig(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, CONFIGS_DIR), 'utf8'));
}

/** Returns true when the database was empty and has been seeded. */
export function seedIfEmpty(db: Db, clock: Clock = systemClock): boolean {
  const versions = createVersionsService(createVersionsRepo(db), clock);
  return versions.seedIfEmpty(readConfig(PUBLISHED), DRAFTS.map(readConfig));
}

// `pnpm seed`: the same function against the configured database.
if (import.meta.main) {
  const env = loadEnv(process.env);
  const handle = openDb(env.databasePath);
  try {
    runMigrations(handle.db);
    process.stdout.write(
      seedIfEmpty(handle.db)
        ? `Seeded ${env.databasePath}: v1 published and active, v2 draft\n`
        : `${env.databasePath} already has versions, nothing to seed\n`,
    );
  } finally {
    handle.close();
  }
}
