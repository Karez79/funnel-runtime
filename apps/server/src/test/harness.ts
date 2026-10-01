// Test harness: a fresh migrated SQLite file per test app, real HTTP via inject().
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, createSharedServices, type AppEnv, type SharedServices } from '../app.ts';
import { openDb, type DbHandle } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { z } from 'zod';
import { readConfig, seedIfEmpty } from '../db/seed.ts';
import type { Clock } from '../clock.ts';
import type { App } from '../plugins/route.ts';

export const TEST_ENV: AppEnv = {
  adminUser: 'admin',
  adminPassword: 'secret',
  generatorKey: 'generator-secret',
  // High enough that only the rate-limit tests themselves ever hit it.
  rateLimits: { sessions: 1000 },
  buildVersion: 'test',
  logLevel: 'silent',
  // No web build in API tests: unknown paths must answer with the JSON 404.
  webDist: '/nonexistent/web-dist',
};

export interface TestApp {
  app: App;
  handle: DbHandle;
  /** The app's own shared services: a test publishing through them is seen by the app. */
  services: SharedServices;
  close: () => Promise<void>;
}

/** A clock the test can move: `clock.set('2026-01-01T00:00:00Z')`, `clock.advance(ms)`. */
export function testClock(start = '2026-10-01T12:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    set: (iso: string) => {
      current = new Date(iso).getTime();
    },
    advance: (ms: number) => {
      current += ms;
    },
  } satisfies Clock & Record<string, unknown>;
}

interface TestAppOptions {
  env?: Partial<AppEnv>;
  /** Seed v1 (active) and v2 (draft) like a first start does; default true. */
  seed?: boolean;
  clock?: Clock;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { env = {}, seed = true, clock = testClock() } = options;
  const dir = mkdtempSync(join(tmpdir(), 'funnel-test-'));
  const handle = openDb(join(dir, 'test.db'));
  runMigrations(handle.db);
  if (seed) seedIfEmpty(handle.db, clock);
  const services = createSharedServices(handle.db, clock);
  const app = await buildApp({ ...TEST_ENV, ...env }, handle.db, clock, services);
  return {
    app,
    handle,
    services,
    close: async () => {
      await app.close();
      if (handle.isOpen()) handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The generator header with the test GENERATOR_KEY. */
export const generatorHeaders = { 'x-generator-key': 'generator-secret' };

export const adminAuth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;

const JsonObject = z.record(z.string(), z.unknown());

/** A config from `configs/` with top-level fields replaced, for upload tests. */
export function configJson(name: string, patch: Record<string, unknown> = {}) {
  return { ...JsonObject.parse(readConfig(name)), ...patch };
}
