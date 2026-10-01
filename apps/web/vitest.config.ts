// Unit tests of the web app's pure modules (reducer, API client, helpers). Components are
// covered by Playwright e2e (CLAUDE.md 3.1), so the environment is plain Node with
// browser globals stubbed per test.
import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'web', include: ['src/**/*.test.ts'] } });
