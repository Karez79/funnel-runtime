// E2E runs against the production build: the real server process (NODE_ENV=production)
// serves the built web app from one URL, on a fresh temporary SQLite file per run
// (CLAUDE.md 12). Credentials come from e2e/env.ts so specs never restate them.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_ADMIN, E2E_BASE_URL, E2E_GENERATOR_KEY, E2E_PORT } from './e2e/env.ts';

// The config is loaded by the runner and by every worker; create the temp dir once.
process.env.FUNNEL_E2E_DB_DIR ??= mkdtempSync(join(tmpdir(), 'funnel-e2e-'));
const dbDir = process.env.FUNNEL_E2E_DB_DIR;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: E2E_BASE_URL,
    httpCredentials: E2E_ADMIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node apps/server/src/main.ts',
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(E2E_PORT),
      DATABASE_PATH: join(dbDir, 'e2e.db'),
      WEB_DIST: 'apps/web/dist',
      LOG_LEVEL: 'warn',
      ADMIN_USER: E2E_ADMIN.username,
      ADMIN_PASSWORD: E2E_ADMIN.password,
      GENERATOR_KEY: E2E_GENERATOR_KEY,
      // Every test starts a session from one IP; the production default (30/min) is a
      // per-visitor limit, not a property under test here (rate limits have server tests).
      RATE_LIMIT_SESSIONS: '600',
      RATE_LIMIT_EVENTS: '600',
    },
  },
});
