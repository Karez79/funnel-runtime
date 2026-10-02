// Integration test of CLAUDE.md 12: the generator runs 120 sessions with --publish-next
// against a real server on a temp database, then verify finds no difference for either
// version, and the dashboard summary says the numbers match. A real visitor uses the
// server during the run (a session, a beacon sent twice, a broken event): the checks
// count only the generator's own rows, so the visitor changes nothing they compare.
import { afterEach, describe, expect, it } from 'vitest';
import { contract, type GroundTruth } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
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

/** What a visitor on the public URL does: no generator key, a beacon re-sent, a broken event. */
async function visit(baseUrl: string): Promise<void> {
  const visitor = createClient({ baseUrl });
  const { session } = (
    await visitor('createSession', { body: { funnelId: 'workstyle-planner', utm: {} } })
  ).data;
  const body = {
    events: [
      {
        event_id: uuidv7(),
        session_id: session.id,
        name: 'step_viewed',
        client_timestamp: new Date().toISOString(),
        client_seq: 1,
        funnel_id: 'workstyle-planner',
        funnel_version: session.funnelVersion,
        experiment_id: session.experimentId,
        variant: session.variant,
        step_id: 'intro',
        properties: {},
      },
      { name: 'broken' },
    ],
  };
  await visitor('eventsBatch', { body });
  await visitor('eventsBatch', { body });
}

/** The same checks without `traffic=generator`, as before it existed. */
function unscoped(truth: GroundTruth): GroundTruth {
  return {
    ...truth,
    checks: truth.checks.map((check) => {
      const query = { ...check.query };
      delete query.traffic;
      return { ...check, query };
    }),
  };
}

describe('pnpm verify after pnpm generate --publish-next', () => {
  it('finds no difference for both versions, and a tampered ground truth fails', async () => {
    t = await createTestApp({ clock: systemClock });
    const baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
    let visited: Promise<void> | undefined;
    const { truth } = await generateTraffic({
      baseUrl,
      sessions: 120,
      seed: 42,
      publishNext: true,
      ...secrets,
      // Mid-run, between the sessions on v1 and those on v2.
      log: (line) => {
        if (line.startsWith('Published')) visited = visit(baseUrl);
      },
    });
    await visited;
    expect(visited).toBeDefined();
    const call = createClient({ baseUrl, ...secrets });

    // The visitor is inside the run's window: unscoped, v2 counts one session more.
    const expectedV2 = truth.checks.find((c) => c.name === 'v2')?.expected.kpis.all.started;
    if (expectedV2 === undefined) throw new Error('a v2 check');
    const unscopedV2 = (await verifyGroundTruth(call, unscoped(truth))).find(
      (r) => r.name === 'v2',
    );
    expect(unscopedV2?.differences).toContain(
      `kpis.all.started: expected ${String(expectedV2)}, got ${String(expectedV2 + 1)}`,
    );

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
