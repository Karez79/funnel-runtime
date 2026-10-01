// `pnpm verify` (CLAUDE.md 9.2): asks the analytics API for every check of the ground
// truth with the same filters and compares field by field with the shared
// `compareSummaries`, the comparison the dashboard's "Matches generator ground truth"
// line makes on the server too.
import { AnalyticsFiltersSchema, compareSummaries, type GroundTruth } from '@funnel/shared';
import type { Client } from './http.ts';

export interface CheckResult {
  readonly name: string;
  readonly differences: readonly string[];
}

export async function verifyGroundTruth(call: Client, truth: GroundTruth): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of truth.checks) {
    const { includeQa, ...filters } = AnalyticsFiltersSchema.parse(check.query);
    const { data } = await call('analyticsSummary', {
      query: { ...filters, includeQa: includeQa ? 'true' : 'false' },
    });
    results.push({ name: check.name, differences: compareSummaries(check.expected, data) });
  }
  return results;
}
