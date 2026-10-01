// Process entry: env -> database -> migrations -> seed -> HTTP. Railway sends SIGTERM on every
// redeploy, so shutdown stops accepting requests and closes the database cleanly, with
// a hard deadline so a stuck connection cannot keep the old container alive.
import { buildApp, createSharedServices } from './app.ts';
import { openDb, type DbHandle } from './db/client.ts';
import type { App } from './plugins/route.ts';
import { runMigrations } from './db/migrate.ts';
import { seedIfEmpty } from './db/seed.ts';
import { loadEnv } from './env.ts';

const SHUTDOWN_DEADLINE_MS = 10_000;

const env = loadEnv(process.env);

// Signal handlers go first: a SIGTERM that arrives while migrations run must still
// stop the process promptly instead of waiting for the platform's SIGKILL.
const proc: { app?: App; handle?: DbHandle; closing: boolean } = { closing: false };
const shutdown = async (signal: string): Promise<void> => {
  if (proc.closing) return;
  proc.closing = true;
  proc.app?.log.info({ signal }, 'shutting down');
  setTimeout(() => {
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  try {
    await proc.app?.close();
  } finally {
    proc.handle?.close();
  }
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

proc.handle = openDb(env.databasePath);
runMigrations(proc.handle.db);
seedIfEmpty(proc.handle.db);
proc.app = await buildApp(env, proc.handle.db, createSharedServices(proc.handle.db));
if (!proc.closing) await proc.app.listen({ host: env.host, port: env.port });
