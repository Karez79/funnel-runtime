// Process entry: env -> database -> migrations -> HTTP. Railway sends SIGTERM on every
// redeploy, so shutdown stops accepting requests and closes the database cleanly.
import { buildApp } from './app.ts';
import { openDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { loadEnv } from './env.ts';

const env = loadEnv(process.env);
const handle = openDb(env.databasePath);
runMigrations(handle.db);
const app = await buildApp(env, handle.db);

let closing = false;
const shutdown = async (signal: string): Promise<void> => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  handle.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: env.host, port: env.port });
