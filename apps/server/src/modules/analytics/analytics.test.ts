import { afterEach, describe, expect, it } from 'vitest';
import { AnalyticsSummarySchema, contract, type SessionResponse } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { events, ingestLog, rejectedEvents, sessions } from '../../db/schema.ts';
import {
  adminAuth,
  createTestApp,
  generatorHeaders,
  testClock,
  type TestApp,
} from '../../test/harness.ts';

const FUNNEL = 'workstyle-planner';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(options: Parameters<typeof createTestApp>[0] = {}) {
  t = await createTestApp(options);
  return t;
}

async function newSession(a: TestApp, body: Record<string, unknown> = {}) {
  const res = await a.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { funnelId: FUNNEL, ...body },
  });
  expect(res.statusCode).toBe(201);
  return contract.createSession.response.parse(res.json()).session;
}

/**
 * Most tests write accepted rows straight into the table to set up exact cases; the
 * "through ingest" test below proves that real ingest writes the same format.
 */
function insertEvent(
  a: TestApp,
  s: SessionResponse['session'],
  name: string,
  stepId: string | null,
  extra: { props?: Record<string, unknown>; flags?: string; serverTs?: string } = {},
) {
  a.handle.db
    .insert(events)
    .values({
      eventId: uuidv7(),
      sessionId: s.id,
      name,
      funnelId: FUNNEL,
      funnelVersion: s.funnelVersion,
      experimentId: s.experimentId,
      variant: s.variant,
      stepId,
      serverTs: extra.serverTs ?? '2026-10-01T12:00:00.000Z',
      origin: 'client',
      propsJson: JSON.stringify(extra.props ?? {}),
      flagsJson: extra.flags ?? '{}',
    })
    .run();
}

async function summary(a: TestApp, query = '') {
  const res = await a.app.inject({
    method: 'GET',
    url: `/api/analytics/summary${query}`,
    headers: { authorization: adminAuth },
  });
  return res;
}

async function okSummary(a: TestApp, query = '') {
  const res = await summary(a, query);
  expect(res.statusCode).toBe(200);
  return AnalyticsSummarySchema.parse(res.json());
}

describe('analytics API', () => {
  it('requires admin auth', async () => {
    const a = await start();
    const res = await a.app.inject({ method: 'GET', url: '/api/analytics/summary' });
    expect(res.statusCode).toBe(401);
    const filters = await a.app.inject({ method: 'GET', url: '/api/analytics/filters' });
    expect(filters.statusCode).toBe(401);
  });

  it('answers an empty summary for the active version before any session', async () => {
    const a = await start();
    const s = await okSummary(a);
    expect(s.version).toBe(1);
    expect(s.kpis.all.started).toBe(0);
    // v2 is a draft: drafts never have sessions and are not compared.
    expect(s.versions.map((v) => v.version)).toEqual([1]);
    expect(s.groundTruthMatches).toBeNull();
  });

  it('aggregates sessions and events from the database by unique session', async () => {
    const a = await start();
    const one = await newSession(a, { utm: { source: 'linkedin', campaign: 'spring_launch' } });
    const two = await newSession(a, { utm: { source: 'newsletter', campaign: 'partner_webinar' } });
    await newSession(a);
    insertEvent(a, one, 'step_viewed', 'intro');
    insertEvent(a, one, 'step_viewed', 'intro');
    insertEvent(a, one, 'step_completed', 'team_size', { flags: '{"out_of_order":true}' });
    insertEvent(a, one, 'result_viewed', 'result', { props: { result_id: 'balanced' } });
    insertEvent(a, one, 'cta_clicked', 'result', {
      props: { result_id: 'balanced', action: 'x' },
      flags: '{"context_mismatch":true}',
    });
    insertEvent(a, two, 'step_viewed', 'intro', { flags: 'not json' });

    const s = await okSummary(a);
    expect(s.kpis.all).toMatchObject({ started: 3, reachedResult: 1, clickedCta: 1 });
    const intro = s.steps.find((step) => step.stepId === 'intro');
    // The third session sent no step event: it reached the first step and left (11.2).
    expect(intro?.metrics.all.reached).toBe(3);
    expect(intro?.metrics.all.completed).toBe(1);
    expect(s.dataQuality).toMatchObject({ outOfOrder: 1, contextMismatch: 1 });
    expect(s.sources.map((x) => x.source)).toEqual(['linkedin', 'newsletter', null]);

    const campaign = await okSummary(a, '?campaign=spring_launch');
    expect(campaign.kpis.all.started).toBe(1);
    // Events of sessions outside the filter do not leak into step metrics.
    expect(campaign.steps.find((step) => step.stepId === 'intro')?.metrics.all.reached).toBe(1);
    const source = await okSummary(a, '?source=newsletter');
    expect(source.kpis.all.started).toBe(1);

    const filters = await a.app.inject({
      method: 'GET',
      url: '/api/analytics/filters',
      headers: { authorization: adminAuth },
    });
    expect(contract.analyticsFilters.response.parse(filters.json())).toEqual({
      versions: [{ version: 1, active: true }],
      campaigns: ['partner_webinar', 'spring_launch'],
      sources: ['linkedin', 'newsletter'],
    });
  });

  it('shows synthetic sessions and hides QA override sessions unless includeQa=true', async () => {
    const a = await start();
    await newSession(a);
    const synthetic = await a.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { funnelId: FUNNEL, trafficType: 'synthetic' },
      headers: generatorHeaders,
    });
    expect(synthetic.statusCode).toBe(201);
    await newSession(a, { variantOverride: 'B', utm: { campaign: 'qa_only' } });
    expect((await okSummary(a)).kpis.all.started).toBe(2);
    expect((await okSummary(a, '?includeQa=true')).kpis.all.started).toBe(3);
    // A campaign only QA sessions carry would select an empty dashboard: not offered.
    const filters = await a.app.inject({
      method: 'GET',
      url: '/api/analytics/filters',
      headers: { authorization: adminAuth },
    });
    expect(contract.analyticsFilters.response.parse(filters.json()).campaigns).toEqual([]);
  });

  it('takes the result breakdown from the stored session result', async () => {
    const a = await start();
    const s = await newSession(a);
    a.handle.db
      .update(sessions)
      .set({ resultId: 'office_core' })
      .where(eq(sessions.id, s.id))
      .run();
    insertEvent(a, s, 'result_viewed', 'result', { props: { result_id: 'balanced' } });
    const summary = await okSummary(a);
    const counts = Object.fromEntries(summary.results.map((r) => [r.resultId, r.sessions.all]));
    expect(counts).toMatchObject({ office_core: 1, balanced: 0 });
  });

  it('filters the period with any offset', async () => {
    const clock = testClock('2026-10-01T12:00:00.000Z');
    const a = await start({ clock });
    await newSession(a);
    // 14:30 at +03:00 is 11:30 UTC: the session at 12:00 UTC is inside.
    expect((await okSummary(a, '?from=2026-10-01T14:30:00%2B03:00')).kpis.all.started).toBe(1);
    expect((await okSummary(a, '?from=2026-10-01T15:30:00%2B03:00')).kpis.all.started).toBe(0);
    expect((await okSummary(a, '?to=2026-10-01T11:00:00Z')).kpis.all.started).toBe(0);
  });

  it('reads duplicates and rejections from the ingest tables', async () => {
    const a = await start();
    const db = a.handle.db;
    const at = '2026-10-01T12:00:00.000Z';
    db.insert(ingestLog)
      .values([
        { receivedAt: at, accepted: 3, duplicates: 2, rejected: 1 },
        { receivedAt: at, accepted: 0, duplicates: 4, rejected: 2 },
      ])
      .run();
    db.insert(rejectedEvents)
      .values([
        { reason: 'unknown_event', rawJson: '{}', receivedAt: at },
        { reason: 'unknown_event', rawJson: '{}', receivedAt: at },
        { reason: 'unknown_session', rawJson: '{}', receivedAt: at },
        { reason: 'something_new', rawJson: '{}', receivedAt: at },
      ])
      .run();
    const s = await okSummary(a);
    expect(s.dataQuality.duplicates).toBe(6);
    expect(s.dataQuality.rejected).toEqual([
      { reason: 'unknown_event', count: 2 },
      { reason: 'unknown_session', count: 1 },
    ]);
    expect((await okSummary(a, '?from=2026-10-02T00:00:00Z')).dataQuality.duplicates).toBe(0);
  });

  it('follows the active version and keeps older versions comparable', async () => {
    const a = await start();
    await newSession(a);
    const publish = await a.app.inject({
      method: 'POST',
      url: '/api/admin/versions/2/publish',
      headers: { authorization: adminAuth },
    });
    expect(publish.statusCode).toBe(200);
    const onV2 = await newSession(a);
    expect(onV2.funnelVersion).toBe(2);

    const current = await okSummary(a);
    expect(current.version).toBe(2);
    expect(current.kpis.all.started).toBe(1);
    expect(current.versions.map((v) => [v.version, v.active, v.kpis.started])).toEqual([
      [1, false, 1],
      [2, true, 1],
    ]);
    expect((await okSummary(a, '?version=1')).kpis.all.started).toBe(1);
  });

  it('counts what ingest stores: unique sessions, duplicates, flags', async () => {
    const a = await start();
    const s = await newSession(a);
    const event = (name: string, stepId: string | null, seq: number, extra = {}) => ({
      event_id: uuidv7(),
      session_id: s.id,
      name,
      client_timestamp: '2026-10-01T12:00:00.000Z',
      client_seq: seq,
      funnel_id: FUNNEL,
      funnel_version: s.funnelVersion,
      experiment_id: s.experimentId,
      variant: s.variant,
      step_id: stepId,
      properties: {},
      ...extra,
    });
    const batch = {
      events: [
        event('step_viewed', 'intro', 2),
        // Arrives after seq 2 was accepted: flagged out of order.
        event('step_viewed', 'team_size', 1),
        // Claims another version: stored with the session's one and flagged.
        event('step_viewed', 'work_mode', 3, { funnel_version: 9 }),
        event('no_such_event', null, 4),
      ],
    };
    for (let i = 0; i < 2; i += 1) {
      const res = await a.app.inject({ method: 'POST', url: '/api/events/batch', payload: batch });
      expect(res.statusCode).toBe(200);
    }
    const summary = await okSummary(a);
    const reached = (id: string) =>
      summary.steps.find((step) => step.stepId === id)?.metrics.all.reached;
    expect([reached('intro'), reached('team_size'), reached('work_mode')]).toEqual([1, 1, 1]);
    expect(summary.dataQuality).toEqual({
      duplicates: 3,
      outOfOrder: 1,
      contextMismatch: 1,
      rejected: [{ reason: 'unknown_event', count: 2 }],
    });
  });

  it('with traffic=generator counts only rows written with the generator key', async () => {
    const a = await start();
    const create = async (body: Record<string, unknown>, headers = {}) => {
      const res = await a.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { funnelId: FUNNEL, ...body },
        headers,
      });
      expect(res.statusCode).toBe(201);
      return contract.createSession.response.parse(res.json()).session;
    };
    const synthetic = { trafficType: 'synthetic' };
    const gen = await create(synthetic, generatorHeaders);
    await create({ ...synthetic, variantOverride: 'B' }, generatorHeaders);
    // A real visitor and a reviewer's ?variant=B session arrive during the run.
    const visitor = await create({});
    await create({ variantOverride: 'A' });

    const batch = (s: typeof gen) => ({
      events: [
        {
          event_id: uuidv7(),
          session_id: s.id,
          name: 'step_viewed',
          client_timestamp: '2026-10-01T12:00:00.000Z',
          client_seq: 1,
          funnel_id: FUNNEL,
          funnel_version: s.funnelVersion,
          experiment_id: s.experimentId,
          variant: s.variant,
          step_id: 'intro',
          properties: {},
        },
        { name: 'broken' },
      ],
    });
    const send = async (payload: ReturnType<typeof batch>, headers = {}) => {
      const res = await a.app.inject({
        method: 'POST',
        url: '/api/events/batch',
        payload,
        headers,
      });
      expect(res.statusCode).toBe(200);
    };
    const genBatch = batch(gen);
    await send(genBatch, generatorHeaders);
    await send(genBatch, generatorHeaders);
    // The visitor's beacon is sent twice, and a wrong key does not make a batch the generator's.
    const visitorBatch = batch(visitor);
    await send(visitorBatch);
    await send(visitorBatch, { 'x-generator-key': 'guess' });

    const scoped = await okSummary(a, '?traffic=generator');
    expect(scoped.kpis.all.started).toBe(1);
    expect(scoped.steps.find((s) => s.stepId === 'intro')?.metrics.all.reached).toBe(1);
    expect(scoped.dataQuality.duplicates).toBe(1);
    expect(scoped.dataQuality.rejected).toEqual([{ reason: 'invalid_event', count: 2 }]);
    expect((await okSummary(a, '?traffic=generator&includeQa=true')).kpis.all.started).toBe(2);

    const all = await okSummary(a, '?includeQa=true');
    expect(all.kpis.all.started).toBe(4);
    expect(all.dataQuality.duplicates).toBe(2);
    expect(all.dataQuality.rejected).toEqual([{ reason: 'invalid_event', count: 4 }]);
    expect((await summary(a, '?traffic=live')).statusCode).toBe(400);
  });

  it('answers 404 for a version that does not exist and 400 for a bad filter', async () => {
    const a = await start();
    expect((await summary(a, '?version=9')).statusCode).toBe(404);
    expect((await summary(a, '?variant=C')).statusCode).toBe(400);
  });
});

describe('generator ground truth', () => {
  async function upload(a: TestApp, body: unknown, auth = true, key = true) {
    return a.app.inject({
      method: 'PUT',
      url: '/api/admin/ground-truth',
      headers: {
        ...(auth ? { authorization: adminAuth } : {}),
        ...(key ? generatorHeaders : {}),
      },
      payload: body as Record<string, unknown>,
    });
  }

  const truth = (checks: unknown[]) => ({
    generatedAt: '2026-10-01T12:00:00.000Z',
    seed: 42,
    sessions: 2,
    checks,
  });

  it('requires admin auth and a valid file', async () => {
    const a = await start();
    expect((await upload(a, truth([]), false)).statusCode).toBe(401);
    expect((await upload(a, truth([]))).statusCode).toBe(400);
  });

  it('requires the generator key on top of the admin guard, also with ADMIN_AUTH=off', async () => {
    for (const env of [{}, { adminAuth: { mode: 'off' } as const }]) {
      const a = await start({ env });
      await newSession(a);
      const expected = await okSummary(a, '?version=1');
      const body = truth([{ name: 'v1', query: { version: '1' }, expected }]);
      const noKey = await upload(a, body, true, false);
      expect(noKey.statusCode).toBe(403);
      expect(noKey.json()).toMatchObject({ error: { code: 'forbidden' } });
      // The key is checked before the body: without it a broken file is still a 403.
      expect((await upload(a, { checks: 'broken' }, true, false)).statusCode).toBe(403);
      const wrong = await a.app.inject({
        method: 'PUT',
        url: '/api/admin/ground-truth',
        headers: { authorization: adminAuth, 'x-generator-key': 'wrong' },
        payload: body,
      });
      expect(wrong.statusCode).toBe(403);
      // Nothing was stored: the dashboard line still says "not run".
      expect((await okSummary(a)).groundTruthMatches).toBeNull();
      expect((await upload(a, body)).statusCode).toBe(200);
      await a.close();
      t = undefined;
    }
  });

  it('answers and shows whether the stored checks match the server numbers', async () => {
    const a = await start();
    const one = await newSession(a, { utm: { campaign: 'spring_launch' } });
    await newSession(a);
    insertEvent(a, one, 'result_viewed', 'result', { props: { result_id: 'balanced' } });
    const expected = await okSummary(a, '?version=1');
    const campaign = await okSummary(a, '?version=1&campaign=spring_launch');

    const res = await upload(
      a,
      truth([
        { name: 'v1', query: { version: '1' }, expected },
        {
          name: 'v1 · spring_launch',
          query: { version: '1', campaign: 'spring_launch' },
          expected: campaign,
        },
      ]),
    );
    expect(res.statusCode).toBe(200);
    expect(contract.uploadGroundTruth.response.parse(res.json())).toEqual({
      matches: true,
      differences: [],
    });
    expect((await okSummary(a)).groundTruthMatches).toBe(true);

    // New data inside the checked scope breaks the match.
    insertEvent(a, one, 'cta_clicked', 'result', { props: { result_id: 'balanced', action: 'x' } });
    expect((await okSummary(a)).groundTruthMatches).toBe(false);
  });

  it('lists the differences and treats an unknown version as a mismatch', async () => {
    const a = await start();
    await newSession(a);
    const expected = await okSummary(a, '?version=1');
    const wrong = structuredClone(expected);
    wrong.kpis.all.started = 5;
    const res = await upload(
      a,
      truth([
        { name: 'v1', query: { version: '1' }, expected: wrong },
        { name: 'v9', query: { version: '9' }, expected },
      ]),
    );
    const body = contract.uploadGroundTruth.response.parse(res.json());
    expect(body.matches).toBe(false);
    expect(body.differences).toEqual([
      'v1: kpis.all.started: expected 5, got 1',
      'v9: Version 9 not found',
    ]);
    expect((await okSummary(a)).groundTruthMatches).toBe(false);
  });

  it('refuses checks that cover no session or do not pin valid filters', async () => {
    const a = await start();
    const empty = await okSummary(a, '?version=1');
    await newSession(a);
    const expected = await okSummary(a, '?version=1');
    for (const check of [
      // An empty expectation would match an empty server: a vacuous "Yes".
      { name: 'empty', query: { version: '1' }, expected: empty },
      // Without a version the check would follow whichever version is active later.
      { name: 'unpinned', query: {}, expected },
      { name: 'bad', query: { version: '1', variant: 'C' }, expected },
    ]) {
      expect((await upload(a, truth([check]))).statusCode).toBe(400);
    }
    expect((await okSummary(a)).groundTruthMatches).toBeNull();
  });

  it('uses the newest upload', async () => {
    const a = await start();
    await newSession(a);
    const expected = await okSummary(a, '?version=1');
    const wrong = structuredClone(expected);
    wrong.kpis.all.started = 5;
    await upload(a, truth([{ name: 'v1', query: { version: '1' }, expected: wrong }]));
    expect((await okSummary(a)).groundTruthMatches).toBe(false);
    await upload(a, truth([{ name: 'v1', query: { version: '1' }, expected }]));
    expect((await okSummary(a)).groundTruthMatches).toBe(true);
  });
});
