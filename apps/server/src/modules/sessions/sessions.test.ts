import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { contract, type SessionResponse } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { events, sessions } from '../../db/schema.ts';
import { createTestApp, generatorHeaders, testClock, type TestApp } from '../../test/harness.ts';
import { assignVariant, fnv1a32 } from './assignment.ts';

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
    let a = 0;
    for (let i = 0; i < 10_000; i++) if (assignVariant(uuidv7(), EXPERIMENT_V1, HALF) === 'A') a++;
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
    // Reads are not limited.
    const res = await a.app.inject({ method: 'GET', url: `/api/funnel/${FUNNEL}/active` });
    expect(res.statusCode).toBe(200);
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
