// Root Vitest config: one run across all packages (vitest `projects` replaces the
// deprecated workspace file) with per-package coverage thresholds (CLAUDE.md 3.1).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/shared',
      'apps/server',
      'apps/web',
      // The generator and verify start a real server in-process and talk to it over HTTP,
      // like the scripts do against prod (CLAUDE.md 12, integration).
      { test: { name: 'scripts', include: ['scripts/**/*.test.ts'], testTimeout: 60_000 } },
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: [
        'packages/shared/src/**/*.ts',
        'apps/server/src/**/*.ts',
        // The rest of apps/web is covered by e2e (CLAUDE.md 3.1); the queue is pure logic.
        'apps/web/src/features/funnel/eventQueue.ts',
      ],
      exclude: ['**/*.test.ts', 'apps/server/src/main.ts'],
      thresholds: {
        'packages/shared/src/**': { lines: 90 },
        'apps/server/src/**': { lines: 80 },
        'apps/web/src/features/funnel/eventQueue.ts': { lines: 85 },
      },
    },
  },
});
