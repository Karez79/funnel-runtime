// Root Vitest config: one run across all packages (vitest `projects` replaces the
// deprecated workspace file) with per-package coverage thresholds (CLAUDE.md 3.1).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/server', 'apps/web'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**/*.ts', 'apps/server/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'apps/server/src/main.ts'],
      thresholds: {
        'packages/shared/src/**': { lines: 90 },
        'apps/server/src/**': { lines: 80 },
      },
    },
  },
});
