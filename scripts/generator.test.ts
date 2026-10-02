import { afterEach, describe, expect, it } from 'vitest';
import { systemClock } from '../apps/server/src/clock.ts';
import {
  configJson,
  createTestApp,
  TEST_ENV,
  type TestApp,
} from '../apps/server/src/test/harness.ts';
import { generateTraffic, MIN_SESSIONS } from './lib/generator.ts';
import { createClient } from './lib/http.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** A real server on a free port and a fresh database: v1 active, v2 draft (seed). */
async function server() {
  t = await createTestApp({ clock: systemClock });
  const address = await t.app.listen({ host: '127.0.0.1', port: 0 });
  return address;
}

const secrets = {
  generatorKey: TEST_ENV.generatorKey,
  admin: { user: TEST_ENV.adminUser, password: TEST_ENV.adminPassword },
};

describe('pnpm generate', () => {
  it('refuses fewer than 100 sessions', async () => {
    await expect(
      generateTraffic({
        baseUrl: 'http://127.0.0.1:9',
        sessions: MIN_SESSIONS - 1,
        seed: 1,
        publishNext: false,
        ...secrets,
      }),
    ).rejects.toThrow('at least 100');
  });

  it('with --publish-next covers both versions, every branch and every fault', async () => {
    const baseUrl = await server();
    const run = await generateTraffic({
      baseUrl,
      sessions: 120,
      seed: 42,
      publishNext: true,
      ...secrets,
    });

    expect(run.published).toBe(2);
    expect(run.visitors).toHaveLength(120);
    // Paused sessions came back after publishing and finished on v1, where they started.
    const resumed = run.visitors.filter((v) => v.resumed);
    expect(resumed.length).toBeGreaterThan(0);
    for (const v of resumed)
      expect({ version: v.version, outcome: v.outcome }).toEqual({ version: 1, outcome: 'result' });
    expect(run.visitors.filter((v) => v.plan.override !== null)).toHaveLength(4);

    const checks = new Map(run.truth.checks.map((c) => [c.name, c.expected]));
    const v1 = checks.get('v1');
    const v2 = checks.get('v2');
    if (!v1 || !v2) throw new Error('a check per version');
    for (const summary of [v1, v2]) {
      // Both variants, every conditional step and every result are reached.
      expect(summary.experiment.A.sessions).toBeGreaterThan(0);
      expect(summary.experiment.B.sessions).toBeGreaterThan(0);
      for (const branch of summary.branches) expect(branch.seen).toBeGreaterThan(0);
      for (const r of summary.results) expect(r.sessions.all).toBeGreaterThan(0);
      expect(summary.kpis.all.backUsage).toBeGreaterThan(0);
      expect(summary.dataQuality.outOfOrder).toBeGreaterThan(0);
      expect(summary.dataQuality.duplicates).toBeGreaterThan(0);
      expect(summary.dataQuality.rejected.map((r) => r.reason)).toEqual([
        'invalid_event',
        'server_only',
        'unknown_event',
        'unknown_session',
      ]);
      // Drop-offs exist: not every started session reaches the result.
      expect(summary.kpis.all.reachedResult).toBeLessThan(summary.kpis.all.started);
    }
    // QA (override) sessions are hidden by default and counted with includeQa.
    const qa =
      (checks.get('v1 · QA included')?.kpis.all.started ?? 0) +
      (checks.get('v2 · QA included')?.kpis.all.started ?? 0);
    expect(qa - v1.kpis.all.started - v2.kpis.all.started).toBe(4);
    expect(run.truth.checks.some((c) => c.expected.dataQuality.contextMismatch > 0)).toBe(true);

    // The server's own numbers agree with the generator's, and ingest answered as expected.
    expect(run.delivery.surprises).toEqual([]);
    expect(run.upload).toEqual({ matches: true, differences: [] });
  });

  it('without a draft to publish puts every session on the active version', async () => {
    const baseUrl = await server();
    const run = await generateTraffic({
      baseUrl,
      sessions: 100,
      seed: 7,
      publishNext: false,
      ...secrets,
    });
    expect(run.published).toBeNull();
    expect(new Set(run.visitors.map((v) => v.version))).toEqual(new Set([1]));
    expect(run.truth.checks.map((c) => c.name)).toEqual([
      'v1',
      'v1 · QA included',
      'v1 · campaign spring_launch',
      'v1 · variant B',
    ]);
    expect(run.upload.matches).toBe(true);
  });

  it('sends recommendation_expanded only from sessions whose version lists it (v3)', async () => {
    const baseUrl = await server();
    const admin = createClient({ baseUrl, ...secrets });
    await admin('publishVersion', { params: { v: 2 }, body: {} });
    await admin('uploadVersion', { query: {}, body: configJson('funnel-v3.json') });
    const run = await generateTraffic({
      baseUrl,
      sessions: 100,
      seed: 3,
      publishNext: true,
      ...secrets,
    });
    expect(run.published).toBe(3);
    const other = (name: string) =>
      run.truth.checks.find((c) => c.name === name)?.expected.otherEvents;
    expect(other('v2')).toEqual([]);
    const [expanded] = other('v3') ?? [];
    expect(expanded?.name).toBe('recommendation_expanded');
    expect(expanded?.sessions).toBeGreaterThan(0);
    // Sent right after every CTA click of a v3 session: one per clicking session.
    expect(expanded?.shareOfCta).toBe(1);
    expect(run.delivery.surprises).toEqual([]);
    expect(run.upload).toEqual({ matches: true, differences: [] });
  });
});
