// Integration test of CLAUDE.md 12: the generator runs 120 sessions with --publish-next
// against a real server on a temp database, then verify finds no difference for either
// version, and the dashboard summary says the numbers match.
import { afterEach, describe, expect, it } from 'vitest';
import { contract } from '@funnel/shared';
import { systemClock } from '../apps/server/src/clock.ts';
import { createTestApp, TEST_ENV, type TestApp } from '../apps/server/src/test/harness.ts';
import { generateTraffic } from './lib/generator.ts';
import { createClient } from './lib/http.ts';
import { verifyGroundTruth } from './lib/verify.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const secrets = {
  generatorKey: TEST_ENV.generatorKey,
  admin: { user: TEST_ENV.adminUser, password: TEST_ENV.adminPassword },
};

describe('pnpm verify after pnpm generate --publish-next', () => {
  it('finds no difference for both versions, and a tampered ground truth fails', async () => {
    t = await createTestApp({ clock: systemClock });
    const baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
    const { truth } = await generateTraffic({
      baseUrl,
      sessions: 120,
      seed: 42,
      publishNext: true,
      ...secrets,
    });
    const call = createClient({ baseUrl, ...secrets });

    const results = await verifyGroundTruth(call, truth);
    expect(results.map((r) => r.name)).toEqual([
      'v1',
      'v1 · QA included',
      'v1 · campaign spring_launch',
      'v1 · variant B',
      'v2',
      'v2 · QA included',
      'v2 · campaign spring_launch',
      'v2 · variant B',
    ]);
    for (const r of results) expect(r).toEqual({ name: r.name, differences: [] });

    const summary = await call('analyticsSummary', { query: {} });
    expect(contract.analyticsSummary.response.parse(summary.data).groundTruthMatches).toBe(true);

    // The comparison is not vacuous: one wrong number is reported with its path.
    const tampered = structuredClone(truth);
    const first = tampered.checks[0];
    if (!first) throw new Error('ground truth has checks');
    first.expected.kpis.all.clickedCta += 1;
    const [v1] = await verifyGroundTruth(call, tampered);
    expect(v1?.differences).toContain(
      `kpis.all.clickedCta: expected ${String(first.expected.kpis.all.clickedCta)}, got ${String(first.expected.kpis.all.clickedCta - 1)}`,
    );
  });
});
