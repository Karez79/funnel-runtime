// `pnpm verify` (CLAUDE.md 9.2): compares the analytics API with the ground truth the
// generator wrote. Prints OK or every differing field; exit code 1 on any difference.
// Usage: pnpm verify [--base-url http://localhost:3000] [--file .generated/ground-truth.json]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { GroundTruthSchema } from '@funnel/shared';
import { cliEnv } from './lib/env.ts';
import { createClient } from './lib/http.ts';
import { verifyGroundTruth } from './lib/verify.ts';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://localhost:3000' },
    file: { type: 'string', default: '.generated/ground-truth.json' },
  },
});

const write = (line: string) => process.stdout.write(`${line}\n`);
const truth = GroundTruthSchema.parse(JSON.parse(readFileSync(values.file, 'utf8')));
const call = createClient({ baseUrl: values['base-url'], ...cliEnv(process.env) });
const results = await verifyGroundTruth(call, truth);

let failed = 0;
for (const { name, differences } of results) {
  if (differences.length === 0) {
    write(`OK        ${name}`);
    continue;
  }
  failed += 1;
  write(`MISMATCH  ${name}`);
  for (const line of differences) write(`          ${line}`);
}
write(
  failed === 0
    ? `OK: all ${String(results.length)} checks match the generator's ground truth.`
    : `${String(failed)} of ${String(results.length)} checks differ from the ground truth.`,
);
if (failed > 0) process.exitCode = 1;
