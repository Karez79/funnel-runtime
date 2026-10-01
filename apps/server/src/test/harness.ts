// Test harness: a fresh migrated SQLite file per test app, real HTTP via inject().
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type AppEnv } from '../app.ts';
import { openDb, type DbHandle } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import type { App } from '../plugins/route.ts';

const TEST_ENV: AppEnv = {
  adminUser: 'admin',
  adminPassword: 'secret',
  buildVersion: 'test',
  logLevel: 'silent',
  // No web build in API tests: unknown paths must answer with the JSON 404.
  webDist: '/nonexistent/web-dist',
};

export interface TestApp {
  app: App;
  handle: DbHandle;
  close: () => Promise<void>;
}

export async function createTestApp(env: Partial<AppEnv> = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'funnel-test-'));
  const handle = openDb(join(dir, 'test.db'));
  runMigrations(handle.db);
  const app = await buildApp({ ...TEST_ENV, ...env }, handle.db);
  return {
    app,
    handle,
    close: async () => {
      await app.close();
      if (handle.isOpen()) handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const adminAuth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
