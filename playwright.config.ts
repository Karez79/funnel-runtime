// E2E runs against the production build: the real server process serves the built web
// app from one URL, on a fresh temporary SQLite file per run (CLAUDE.md 12).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const dbDir = mkdtempSync(join(tmpdir(), 'funnel-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node apps/server/src/main.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: join(dbDir, 'e2e.db'),
      WEB_DIST: 'apps/web/dist',
      LOG_LEVEL: 'warn',
    },
  },
});
