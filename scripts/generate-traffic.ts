// `pnpm generate` (CLAUDE.md 9.1): synthetic traffic through the HTTP API and the ground
// truth that `pnpm verify` and the dashboard compare with. Secrets come from the
// environment (GENERATOR_KEY, ADMIN_USER, ADMIN_PASSWORD), never from flags.
// Usage: pnpm generate [--sessions 150] [--seed 42] [--base-url http://localhost:3000]
//                      [--out .generated/ground-truth.json] [--publish-next]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import type { AnalyticsSummary } from '@funnel/shared';
import { generateTraffic } from './lib/generator.ts';
import { cliEnv } from './lib/env.ts';

const { values } = parseArgs({
  options: {
    sessions: { type: 'string', default: '150' },
    seed: { type: 'string', default: '42' },
    'base-url': { type: 'string', default: 'http://localhost:3000' },
    out: { type: 'string', default: '.generated/ground-truth.json' },
    'publish-next': { type: 'boolean', default: false },
  },
});

const env = cliEnv(process.env);
const write = (line: string) => process.stdout.write(`${line}\n`);
const pct = (rate: number | null) => (rate === null ? '—' : `${(rate * 100).toFixed(1)}%`);

const result = await generateTraffic({
  baseUrl: values['base-url'],
  sessions: Number(values.sessions),
  seed: Number(values.seed),
  publishNext: values['publish-next'],
  generatorKey: env.generatorKey,
  admin: env.admin,
  log: write,
});

mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, `${JSON.stringify(result.truth, null, 2)}\n`);

const rows = result.truth.checks
  .filter((check) => /^v\d+$/.test(check.name))
  .map(({ name, expected }: { name: string; expected: AnalyticsSummary }) => ({
    check: name,
    started: expected.kpis.all.started,
    result: expected.kpis.all.reachedResult,
    cta: expected.kpis.all.clickedCta,
    'A started→CTA': pct(expected.experiment.A.rate),
    'B started→CTA': pct(expected.experiment.B.rate),
    'back usage': pct(expected.kpis.all.backUsage),
  }));
const report = result.delivery;
write('');
write(
  `Ground truth (${String(result.truth.sessions)} sessions, seed ${String(result.truth.seed)}):`,
);
for (const row of rows)
  write(
    `  ${Object.entries(row)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ')}`,
  );
write(
  `  delivery: ${String(report.batches)} batches (${String(report.resent)} re-sent), ` +
    `${String(report.delivered.length)} events stored, ${String(report.duplicates)} duplicates, ` +
    `${String(report.rejected.reduce((n, r) => n + r.count, 0))} rejected on purpose`,
);
if (result.published !== null) write(`  published v${String(result.published)} mid-run`);
for (const surprise of report.surprises) write(`  unexpected ingest status: ${surprise}`);
write(`Written to ${values.out}; uploaded to the server.`);
write(
  result.upload.matches
    ? 'Server analytics match the ground truth.'
    : `Server analytics differ from the ground truth:\n  ${result.upload.differences.join('\n  ')}`,
);
if (!result.upload.matches || report.surprises.length > 0) process.exitCode = 1;
