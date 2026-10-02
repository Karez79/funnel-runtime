// `pnpm demo:iteration2` (CLAUDE.md 13.2 Phase 7): publishes the next config on a running
// server without a redeploy, checks pinned sessions, the new branch and event, rolls back
// and checks the schema; prints a ✔/✘ checklist, exit code 1 on any ✘. Secrets come from
// the environment like for `pnpm generate` (GENERATOR_KEY, ADMIN_USER, ADMIN_PASSWORD).
// Usage: pnpm demo:iteration2 [--base-url http://localhost:3000] [--config configs/funnel-v3.json]
import { parseArgs } from 'node:util';
import { runIterationDemo } from './lib/demo.ts';
import { cliEnv } from './lib/env.ts';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://localhost:3000' },
    config: { type: 'string' },
  },
});

const write = (line: string) => process.stdout.write(`${line}\n`);
const checks = await runIterationDemo({
  baseUrl: values['base-url'],
  ...cliEnv(process.env),
  ...(values.config ? { configPath: values.config } : {}),
  log: write,
});

write('');
for (const { label, ok, detail } of checks) write(`${ok ? '✔' : '✘'} ${label} — ${detail}`);
const failed = checks.filter((c) => !c.ok).length;
write(
  failed === 0
    ? `All ${String(checks.length)} checks passed.`
    : `${String(failed)} of ${String(checks.length)} checks failed.`,
);
if (failed > 0) process.exitCode = 1;
