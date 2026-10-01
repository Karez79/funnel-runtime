import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract,
  ErrorBody,
  SessionUnprocessableDetailsSchema,
  type SessionResponse,
} from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { events, sessions } from '../../db/schema.ts';
import {
  adminAuth,
  createTestApp,
  generatorHeaders,
  testClock,
  type TestApp,
} from '../../test/harness.ts';
import { assignVariant, fnv1a32 } from './assignment.ts';
import { createSessionsRepo } from './repo.ts';

const FUNNEL = 'workstyle-planner';
const EXPERIMENT_V1 = 'question-order-and-result-framing-v1';
const HALF = { A: { weight: 50 }, B: { weight: 50 } };

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function app(options: Parameters<typeof createTestApp>[0] = {}): Promise<TestApp> {
  t = await createTestApp(options);
  return t;
}

async function create(
  a: TestApp,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return a.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { funnelId: FUNNEL, ...body },
    headers,
  });
}

async function created(a: TestApp, body: Record<string, unknown> = {}): Promise<SessionResponse> {
  const res = await create(a, body);
  expect(res.statusCode).toBe(201);
  return contract.createSession.response.parse(res.json());
}

async function read(a: TestApp, id: string) {
  return a.app.inject({ method: 'GET', url: `/api/sessions/${id}` });
}

function row(a: TestApp, id: string) {
  return a.handle.db.select().from(sessions).where(eq(sessions.id, id)).get();
}

describe('test 2: variant stability', () => {
  it('returns the same variant on a repeated GET and on 20 reads', async () => {
    const a = await app();
    const { session } = await created(a);
    for (let i = 0; i < 20; i++) {
      const res = await read(a, session.id);
      expect(res.statusCode).toBe(200);
      const body = contract.getSession.response.parse(res.json());
      expect(body.session.variant).toBe(session.variant);
      expect(body.funnel.meta.variant).toBe(session.variant);
    }
  });

  it('assigns deterministically for a (sessionId, experimentId) pair', () => {
    const id = uuidv7();
    const first = assignVariant(id, EXPERIMENT_V1, HALF);
    for (let i = 0; i < 50; i++) expect(assignVariant(id, EXPERIMENT_V1, HALF)).toBe(first);
  });

  it('splits 10 000 uuid v7 ids 50±2%', () => {
    // Fixed time and seeded random bytes: the same 10 000 ids on every run.
    let seed = 42;
    const nextByte = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % 256;
    };
    const start = Date.parse('2026-10-01T00:00:00Z');
    let a = 0;
    for (let i = 0; i < 10_000; i++) {
      const random = Uint8Array.from({ length: 16 }, nextByte);
      const id = uuidv7({ msecs: start + i, random });
      if (assignVariant(id, EXPERIMENT_V1, HALF) === 'A') a++;
    }
    expect(a / 10_000).toBeGreaterThanOrEqual(0.48);
    expect(a / 10_000).toBeLessThanOrEqual(0.52);
  });

  it('stores the hash assignment as the session variant', async () => {
    const a = await app();
    const { session } = await created(a);
    expect(session.variant).toBe(assignVariant(session.id, EXPERIMENT_V1, HALF));
    expect(row(a, session.id)).toMatchObject({ variantSource: 'hash', trafficType: 'live' });
  });

  it('honours an override and marks the session as QA', async () => {
    const a = await app();
    for (const variant of ['A', 'B'] as const) {
      const { session, funnel } = await created(a, { variantOverride: variant });
      expect(session).toMatchObject({ variant, variantSource: 'override' });
      expect(funnel.meta.variant).toBe(variant);
      expect(row(a, session.id)).toMatchObject({
        variant,
        variantSource: 'override',
        trafficType: 'qa',
      });
    }
  });
});

describe('fnv1a32 and weights', () => {
  it('matches the reference FNV-1a values', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('scales weights that do not sum to 100', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7());
    const share = (w: typeof HALF) =>
      ids.filter((id) => assignVariant(id, 'exp', w) === 'A').length / ids.length;
    expect(share({ A: { weight: 1 }, B: { weight: 1 } })).toBe(share(HALF));
    expect(share({ A: { weight: 1 }, B: { weight: 3 } })).toBeCloseTo(0.25, 1);
  });
});

describe('POST /api/sessions', () => {
  it('starts on the active version with the first step of the variant', async () => {
    const a = await app();
    const { session, funnel } = await created(a);
    expect(session).toMatchObject({
      funnelVersion: 1,
      experimentId: EXPERIMENT_V1,
      stateRev: 0,
      resultId: null,
      state: { answers: {}, history: [], currentStepId: 'intro' },
      expiresAt: '2026-10-04T12:00:00.000Z',
    });
    expect(funnel.meta).toMatchObject({ version: 1, variant: session.variant });
    expect(funnel.sequence[0]).toBe('intro');
  });

  it('sends only the assigned variant', async () => {
    const a = await app();
    const { funnel } = await created(a, { variantOverride: 'B' });
    expect(funnel.sequence.slice(0, 3)).toEqual(['intro', 'work_mode', 'timezone_span']);
    expect(JSON.stringify(funnel)).not.toContain('stepOverrides');
  });

  it('writes session_started exactly once, in the server fields of the session', async () => {
    const a = await app();
    const { session } = await created(a, {
      utm: { source: 'linkedin', medium: 'paid', campaign: 'spring_launch' },
    });
    const rows = a.handle.db.select().from(events).where(eq(events.sessionId, session.id)).all();
    expect(rows).toEqual([
      {
        eventId: `srv:session_started:${session.id}`,
        sessionId: session.id,
        name: 'session_started',
        funnelId: FUNNEL,
        funnelVersion: 1,
        experimentId: EXPERIMENT_V1,
        variant: session.variant,
        stepId: null,
        utmSource: 'linkedin',
        utmMedium: 'paid',
        utmCampaign: 'spring_launch',
        clientTs: '2026-10-01T12:00:00.000Z',
        serverTs: '2026-10-01T12:00:00.000Z',
        clientSeq: null,
        origin: 'server',
        propsJson: '{}',
        flagsJson: '{}',
      },
    ]);
  });

  it('stores empty UTM values as missing', async () => {
    const a = await app();
    const { session } = await created(a, { utm: { source: '', campaign: '  ', medium: 'email' } });
    expect(row(a, session.id)).toMatchObject({
      utmSource: null,
      utmCampaign: null,
      utmMedium: 'email',
    });
  });

  it('stores UTM once, all five fields', async () => {
    const a = await app();
    const utm = { source: 's', medium: 'm', campaign: 'c', content: 'x', term: 't' };
    const { session } = await created(a, { utm });
    expect(row(a, session.id)).toMatchObject({
      utmSource: 's',
      utmMedium: 'm',
      utmCampaign: 'c',
      utmContent: 'x',
      utmTerm: 't',
    });
    const bare = await created(a);
    expect(row(a, bare.session.id)).toMatchObject({ utmSource: null, utmCampaign: null });
  });

  it('starts new sessions on the newly published version only', async () => {
    const a = await app();
    const before = await created(a);
    a.services.versions.publish(FUNNEL, 2);
    const after = await created(a);
    expect(before.session.funnelVersion).toBe(1);
    expect(after.session.funnelVersion).toBe(2);
    expect(after.session.experimentId).toBe('question-order-and-result-framing-v2');
  });

  it('accepts synthetic traffic only with the generator key', async () => {
    const a = await app();
    const ok = await create(a, { trafficType: 'synthetic' }, generatorHeaders);
    expect(ok.statusCode).toBe(201);
    const id = contract.createSession.response.parse(ok.json()).session.id;
    expect(row(a, id)?.trafficType).toBe('synthetic');

    for (const headers of [{}, { 'x-generator-key': 'wrong' }]) {
      const res = await create(a, { trafficType: 'synthetic' }, headers);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'forbidden' } });
    }
    expect(a.handle.db.select().from(sessions).all()).toHaveLength(1);
  });

  it('marks a generator override as QA, not synthetic', async () => {
    const a = await app();
    const res = await create(
      a,
      { trafficType: 'synthetic', variantOverride: 'A' },
      generatorHeaders,
    );
    const id = contract.createSession.response.parse(res.json()).session.id;
    expect(row(a, id)?.trafficType).toBe('qa');
  });

  it('answers 404 for a funnel without an active version and 400 for a bad body', async () => {
    const a = await app();
    const missing = await create(a, { funnelId: 'nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'not_found' } });
    const bad = await create(a, { variantOverride: 'C' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('is rate limited per client, except for the generator', async () => {
    const a = await app({ env: { rateLimits: { sessions: 2 } } });
    expect((await create(a)).statusCode).toBe(201);
    expect((await create(a)).statusCode).toBe(201);
    const limited = await create(a);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect((await create(a, {}, generatorHeaders)).statusCode).toBe(201);
    // A forged X-Forwarded-For is not a new client.
    const forged = await create(a, {}, { 'x-forwarded-for': '203.0.113.9' });
    expect(forged.statusCode).toBe(429);
    // Reads are not limited.
    const res = await a.app.inject({ method: 'GET', url: `/api/funnel/${FUNNEL}/active` });
    expect(res.statusCode).toBe(200);
  });

  it('keys the limit by the edge client-IP header when configured', async () => {
    const a = await app({ env: { rateLimits: { sessions: 1 }, clientIpHeader: 'x-real-ip' } });
    const from = (ip: string, xff = '198.51.100.1') =>
      create(a, {}, { 'x-real-ip': ip, 'x-forwarded-for': xff });
    expect((await from('192.0.2.1')).statusCode).toBe(201);
    expect((await from('192.0.2.1', '203.0.113.7')).statusCode).toBe(429);
    expect((await from('192.0.2.2')).statusCode).toBe(201);
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns the stored session', async () => {
    const a = await app();
    const made = await created(a, { variantOverride: 'B' });
    const res = await read(a, made.session.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(made);
  });

  it('resolves the pinned version, not the active one', async () => {
    const a = await app();
    const { session } = await created(a);
    a.services.versions.publish(FUNNEL, 2);
    const body = contract.getSession.response.parse((await read(a, session.id)).json());
    expect(body.session.funnelVersion).toBe(1);
    expect(body.funnel.meta.version).toBe(1);
    expect(body.funnel.sequence).not.toContain('meeting_hours');
  });

  it('answers 404 for an unknown session', async () => {
    const a = await app();
    const res = await read(a, uuidv7());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers 410 once the TTL of the pinned version has passed', async () => {
    const clock = testClock();
    const a = await app({ clock });
    const { session } = await created(a);
    clock.advance(72 * 60 * 60 * 1000 - 1);
    expect((await read(a, session.id)).statusCode).toBe(200);
    clock.advance(1);
    const res = await read(a, session.id);
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: { code: 'gone' } });
  });
});

const HYBRID = {
  team_size: 12,
  work_mode: 'hybrid',
  priorities: ['focus', 'speed'],
  timezone_span: 'same',
  office_days: 2,
  async_maturity: 'medium',
  tool_count: 8,
};
const without = (answers: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(answers).filter(([k]) => k !== key));
const V1_A_PATH = ['intro', 'team_size', 'work_mode', 'priorities', 'timezone_span', 'office_days'];

async function save(
  a: TestApp,
  id: string,
  answers: Record<string, unknown>,
  baseRev: number,
  extra: { currentStepId?: string; history?: string[] } = {},
) {
  return a.app.inject({
    method: 'PUT',
    url: `/api/sessions/${id}/state`,
    payload: {
      baseRev,
      state: { answers, history: V1_A_PATH, currentStepId: 'result', ...extra },
    },
  });
}

async function complete(a: TestApp, id: string) {
  return a.app.inject({ method: 'POST', url: `/api/sessions/${id}/complete` });
}

describe('test 1: version pinning', () => {
  it('keeps a v1 session on v1 after v2 is published; new sessions get v2', async () => {
    const a = await app();
    const { session } = await created(a, { variantOverride: 'A' });
    a.services.versions.publish(FUNNEL, 2);

    const got = contract.getSession.response.parse((await read(a, session.id)).json());
    expect(got.session.funnelVersion).toBe(1);
    expect(got.funnel.meta).toMatchObject({ version: 1, experimentId: EXPERIMENT_V1 });

    const saved = await save(a, session.id, HYBRID, 0);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ stateRev: 1 });

    // meeting_hours exists only in v2: neither its answer nor the step fits a v1 session.
    const v2Answer = await save(a, session.id, { ...HYBRID, meeting_hours: 6 }, 1);
    expect(v2Answer.statusCode).toBe(422);
    expect(v2Answer.json()).toMatchObject({
      error: { code: 'unprocessable', details: { answer: 'meeting_hours' } },
    });
    const v2Step = await save(a, session.id, HYBRID, 1, { currentStepId: 'meeting_hours' });
    expect(v2Step.statusCode).toBe(422);
    expect(v2Step.json()).toMatchObject({ error: { details: { stepId: 'meeting_hours' } } });

    const done = await complete(a, session.id);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ resultId: 'hybrid_structured' });

    const fresh = await created(a);
    expect(fresh.session.funnelVersion).toBe(2);
    expect(fresh.funnel.sequence).toContain('meeting_hours');
  });
});

describe('test 4: rollback keeps sessions and events', () => {
  it('lets v2 sessions finish on v2 after a rollback to v1, and deletes nothing', async () => {
    const a = await app();
    const admin = { authorization: adminAuth };
    await a.app.inject({ method: 'POST', url: '/api/admin/versions/2/publish', headers: admin });
    const { session } = await created(a, { variantOverride: 'A' });
    expect(session.funnelVersion).toBe(2);
    const countEvents = () => a.handle.db.select().from(events).all().length;
    const before = countEvents();

    const rollback = await a.app.inject({
      method: 'POST',
      url: '/api/admin/rollback',
      headers: admin,
    });
    expect(rollback.statusCode).toBe(200);
    expect((await created(a)).session.funnelVersion).toBe(1);

    const got = contract.getSession.response.parse((await read(a, session.id)).json());
    expect(got.funnel.meta.version).toBe(2);
    // meeting_heavy exists only in v2, so the result proves the v2 config was used.
    const saved = await save(a, session.id, { ...HYBRID, meeting_hours: 20 }, 0, {
      history: [...V1_A_PATH, 'meeting_hours', 'async_maturity', 'tool_count'],
    });
    expect(saved.statusCode).toBe(200);
    const done = await complete(a, session.id);
    expect(done.statusCode).toBe(200);
    expect(contract.completeSession.response.parse(done.json()).resultId).toBe('meeting_heavy');

    // The v2 session and its session_started are still there; only new rows were added.
    expect(row(a, session.id)?.funnelVersion).toBe(2);
    expect(countEvents()).toBe(before + 1);
    const started = a.handle.db
      .select()
      .from(events)
      .where(eq(events.eventId, `srv:session_started:${session.id}`))
      .get();
    expect(started).toMatchObject({ funnelVersion: 2, name: 'session_started' });
    const versions = await a.app.inject({
      method: 'GET',
      url: '/api/admin/versions',
      headers: admin,
    });
    expect(versions.json()).toMatchObject({
      versions: [
        { version: 1, active: true },
        { version: 2, state: 'published', totalSessions: 1 },
      ],
    });
  });
});

describe('PUT /api/sessions/:id/state', () => {
  it('stores the state and bumps the revision', async () => {
    const clock = testClock();
    const a = await app({ clock });
    const { session } = await created(a, { variantOverride: 'A' });
    clock.advance(1000);
    expect((await save(a, session.id, { team_size: 5 }, 0)).json()).toEqual({ stateRev: 1 });
    expect((await save(a, session.id, HYBRID, 1)).json()).toEqual({ stateRev: 2 });
    const body = contract.getSession.response.parse((await read(a, session.id)).json());
    expect(body.session).toMatchObject({
      stateRev: 2,
      state: { answers: HYBRID, history: V1_A_PATH, currentStepId: 'result' },
    });
    expect(row(a, session.id)?.updatedAt).toBe('2026-10-01T12:00:01.000Z');
  });

  it('answers 409 with the server state when baseRev is stale', async () => {
    const a = await app();
    const { session } = await created(a, { variantOverride: 'A' });
    await save(a, session.id, { team_size: 5 }, 0);
    const res = await save(a, session.id, HYBRID, 0);
    expect(res.statusCode).toBe(409);
    const details = contract.saveState.errorDetails.conflict.parse(
      ErrorBody.parse(res.json()).error.details,
    );
    expect(details).toEqual({
      stateRev: 1,
      state: { answers: { team_size: 5 }, history: V1_A_PATH, currentStepId: 'result' },
    });
    expect(row(a, session.id)?.stateRev).toBe(1);
  });

  it.each([
    ['out of range', { team_size: 999 }, 'team_size', 'max', '999'],
    ['an unknown option', { work_mode: 'zeppelin' }, 'work_mode', 'invalidOption', 'zeppelin'],
    [
      'too many choices',
      { priorities: ['speed', 'focus', 'culture', 'cost'] },
      'priorities',
      'maxSelections',
      'culture',
    ],
    ['the wrong shape', { tool_count: 'many' }, 'tool_count', 'invalidType', 'many'],
  ])(
    'rejects an answer %s with 422 naming the step, not the value',
    async (_n, answers, stepId, code, value) => {
      const a = await app();
      const { session } = await created(a);
      const res = await save(a, session.id, answers, 0);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: { code: 'unprocessable', details: { stepId, code } },
      });
      expect(res.body).not.toContain(value);
      expect(row(a, session.id)?.stateRev).toBe(0);
    },
  );

  it('rejects history steps that are not in the pinned funnel', async () => {
    const a = await app();
    const { session } = await created(a);
    const res = await save(a, session.id, {}, 0, { currentStepId: 'intro', history: ['nowhere'] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { details: { stepId: 'nowhere' } } });
  });

  it('answers 404 and 410 like GET', async () => {
    const clock = testClock();
    const a = await app({ clock });
    expect((await save(a, uuidv7(), {}, 0)).statusCode).toBe(404);
    const { session } = await created(a);
    clock.advance(72 * 60 * 60 * 1000);
    expect((await save(a, session.id, {}, 0)).statusCode).toBe(410);
    expect((await complete(a, session.id)).statusCode).toBe(410);
  });
});

describe('optimistic lock in SQL', () => {
  it('refuses a write whose base revision is no longer current', async () => {
    const a = await app();
    const { session } = await created(a);
    const repo = createSessionsRepo(a.handle.db);
    const now = '2026-10-01T12:00:00.000Z';
    expect(repo.saveState(session.id, '{}', 0, now)).toBe(true);
    expect(repo.saveState(session.id, '{}', 0, now)).toBe(false);
    expect(row(a, session.id)?.stateRev).toBe(1);
  });
});

describe('POST /api/sessions/:id/complete', () => {
  it('stores the computed result and returns it with the variant overrides', async () => {
    const a = await app();
    const { session } = await created(a, { variantOverride: 'B' });
    await save(a, session.id, { ...HYBRID, async_maturity: 'high' }, 0, { history: [] });
    const res = await complete(a, session.id);
    expect(res.statusCode).toBe(200);
    const body = contract.completeSession.response.parse(res.json());
    expect(body.resultId).toBe('async_native');
    expect(body.result.title).toBe('Your team is ready to reduce meetings');
    expect(row(a, session.id)?.resultId).toBe('async_native');
  });

  it('is idempotent for the same state and recomputes after the answers change', async () => {
    const clock = testClock();
    const a = await app({ clock });
    const { session } = await created(a, { variantOverride: 'A' });
    await save(a, session.id, HYBRID, 0);
    const first: unknown = (await complete(a, session.id)).json();
    const updatedAt = row(a, session.id)?.updatedAt;
    clock.advance(1000);
    // The same state again: same result, the row is not rewritten.
    expect((await complete(a, session.id)).json()).toEqual(first);
    expect(row(a, session.id)?.updatedAt).toBe(updatedAt);

    // Back from the result, a different work mode, Continue to the result again.
    await save(a, session.id, { ...HYBRID, work_mode: 'office' }, 1);
    const again = await complete(a, session.id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ resultId: 'office_core' });
    expect(row(a, session.id)?.resultId).toBe('office_core');
  });

  it('answers 422 naming the first unanswered visible step', async () => {
    const a = await app();
    const { session } = await created(a, { variantOverride: 'A' });
    await save(a, session.id, without(HYBRID, 'office_days'), 0);
    const res = await complete(a, session.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: { code: 'unprocessable', details: { stepId: 'office_days', code: 'required' } },
    });
    expect(row(a, session.id)?.resultId).toBeNull();
  });

  it('does not require answers of steps that became hidden', async () => {
    const a = await app();
    // office_days was answered for hybrid, then work_mode changed to remote: the step is
    // hidden and its stale answer is kept but not required. No v1 rule reads office_days,
    // so "not used for the result" is covered by computeResult's tests in shared.
    const { session } = await created(a, { variantOverride: 'A' });
    await save(a, session.id, { ...HYBRID, office_days: 4 }, 0);
    await save(a, session.id, { ...HYBRID, work_mode: 'remote', office_days: 4 }, 1);
    expect((await complete(a, session.id)).json()).toMatchObject({ resultId: 'balanced' });

    const other = await created(a, { variantOverride: 'A' });
    const remote = without({ ...HYBRID, work_mode: 'remote' }, 'office_days');
    await save(a, other.session.id, remote, 0);
    const done = await complete(a, other.session.id);
    expect(done.statusCode).toBe(200);
    // With hybrid the same answers miss office_days, which is then required.
    const third = await created(a, { variantOverride: 'A' });
    await save(a, third.session.id, without(HYBRID, 'office_days'), 0);
    const missing = await complete(a, third.session.id);
    expect(missing.statusCode).toBe(422);
    expect(
      SessionUnprocessableDetailsSchema.parse(ErrorBody.parse(missing.json()).error.details),
    ).toEqual({ stepId: 'office_days', code: 'required' });
  });

  it('answers 404 for an unknown session', async () => {
    const a = await app();
    expect((await complete(a, uuidv7())).statusCode).toBe(404);
  });
});
