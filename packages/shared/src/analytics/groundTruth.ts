// The generator's ground truth and the one comparison of it with the analytics API
// (CLAUDE.md 9.1, 9.2). The generator computes the expected summaries with the same
// `aggregate`, but over its own journal of what it did; `pnpm verify` and the server's
// "Matches generator ground truth" line both compare with `compareSummaries`, so the
// rule of what must match lives here once.
//
// What is not compared, and why: `groundTruthMatches` is the answer to this very
// question; the `active` flag of a version and versions published after the run change
// legitimately later (rollback, iteration 2) without changing a single number of the run.
import { z } from 'zod';
import { AnalyticsSummarySchema, type AnalyticsSummary } from './summary.ts';

/** Rates are computed in floating point by the same code on both sides. */
const TOLERANCE = 1e-9;

const GroundTruthCheckSchema = z.object({
  /** Shown by verify, e.g. "v2 · campaign spring_launch". */
  name: z.string().min(1).max(200),
  /** Query string of `GET /api/analytics/summary`, exactly as verify sends it. */
  query: z.record(z.string(), z.string()),
  expected: AnalyticsSummarySchema,
});

export const GroundTruthSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  seed: z.number().int(),
  /** Sessions the run created, QA included. */
  sessions: z.number().int().nonnegative(),
  checks: z.array(GroundTruthCheckSchema).min(1).max(50),
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const show = (value: unknown): string =>
  value === undefined
    ? 'undefined'
    : Array.isArray(value)
      ? `[${String(value.length)} items]`
      : JSON.stringify(value);

function compare(path: string, expected: unknown, actual: unknown, out: string[]): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > TOLERANCE) {
      out.push(`${path}: expected ${String(expected)}, got ${String(actual)}`);
    }
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push(`${path}: expected ${String(expected.length)} items, got ${String(actual.length)}`);
      return;
    }
    expected.forEach((item, i) => {
      compare(`${path}[${String(i)}]`, item, actual[i], out);
    });
    return;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys)
      compare(path === '' ? key : `${path}.${key}`, expected[key], actual[key], out);
    return;
  }
  if (!Object.is(expected, actual)) {
    out.push(`${path}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

/** Only what the run determines: see the header for what is left out. */
function comparable(summary: Record<string, unknown>) {
  const rest: Record<string, unknown> = { ...summary };
  delete rest.groundTruthMatches;
  delete rest.versions;
  const list: unknown[] = Array.isArray(summary.versions) ? summary.versions : [];
  const versions = new Map<number, Record<string, unknown>>();
  for (const v of list) {
    if (!isRecord(v) || typeof v.version !== 'number') continue;
    const kept = { ...v };
    delete kept.active;
    versions.set(v.version, kept);
  }
  return { rest, versions };
}

/**
 * Field-level differences between the expected summary and what the API answered, as
 * readable lines (`kpis.all.started: expected 12, got 11`); empty when they match.
 */
export function compareSummaries(
  expected: AnalyticsSummary,
  actual: AnalyticsSummary | Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const want = comparable(expected);
  const got = comparable(actual);
  compare('', want.rest, got.rest, out);
  for (const [version, kpis] of want.versions) {
    const path = `versions[v${String(version)}]`;
    const other = got.versions.get(version);
    if (other === undefined) out.push(`${path}: missing`);
    else compare(path, kpis, other, out);
  }
  return out;
}
