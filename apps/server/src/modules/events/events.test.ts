import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { contract, type ClientEvent, type SessionResponse } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { events, ingestLog, rejectedEvents } from '../../db/schema.ts';
import {
  adminAuth,
  configJson,
  createTestApp,
  generatorHeaders,
  type TestApp,
} from '../../test/harness.ts';

const FUNNEL = 'workstyle-planner';
const JsonObject = z.record(z.string(), z.unknown());

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function app(options: Parameters<typeof createTestApp>[0] = {}): Promise<TestApp> {
  t = await createTestApp(options);
  return t;
}

async function session(
  a: TestApp,
  body: Record<string, unknown> = {},
): Promise<SessionResponse['session']> {
  const res = await a.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { funnelId: FUNNEL, ...body },
  });
  expect(res.statusCode).toBe(201);
  return contract.createSession.response.parse(res.json()).session;
}

let seq = 0;
/** A valid client event for the session; fields can be overridden per test. */
function event(
  s: SessionResponse['session'],
  overrides: Partial<ClientEvent> & Record<string, unknown> = {},
): ClientEvent {
  seq += 1;
  return {
    event_id: uuidv7(),
    session_id: s.id,
    name: 'step_viewed',
    client_timestamp: '2026-10-01T12:00:01.000Z',
    client_seq: seq,
    funnel_id: FUNNEL,
    funnel_version: s.funnelVersion,
    experiment_id: s.experimentId,
    variant: s.variant,
    step_id: 'team_size',
    properties: { step_type: 'number', visible_step_index: 1, visible_step_count: 6 },
    ...overrides,
  };
}

async function send(a: TestApp, items: unknown[], extra: Record<string, unknown> = {}) {
  return a.app.inject({
    method: 'POST',
    url: '/api/events/batch',
    payload: { events: items, ...extra },
  });
}

async function batch(a: TestApp, items: unknown[], extra: Record<string, unknown> = {}) {
  const res = await send(a, items, extra);
  expect(res.statusCode).toBe(200);
  return contract.eventsBatch.response.parse(res.json());
}

function clientRows(a: TestApp, sessionId: string) {
  return a.handle.db
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(asc(events.clientSeq))
    .all()
    .filter((row) => row.origin === 'client');
}

function flags(row: { flagsJson: string }): Record<string, unknown> {
  return JsonObject.parse(JSON.parse(row.flagsJson));
}

describe('test 3: deduplication and per-event validation', () => {
  it('stores an event sent twice in one batch once', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s);
    const res = await batch(a, [e, e]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'duplicate']);
    expect(res).toMatchObject({ accepted: 1, duplicates: 1, rejected: 0 });
    expect(clientRows(a, s.id)).toHaveLength(1);
  });

  it('stores an event sent in two batches once', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s);
    expect((await batch(a, [e])).results[0]?.status).toBe('accepted');
    const second = await batch(a, [e, event(s)]);
    expect(second.results.map((r) => r.status)).toEqual(['duplicate', 'accepted']);
    expect(clientRows(a, s.id)).toHaveLength(2);
  });

  it('a whole batch replayed after a timeout changes nothing', async () => {
    const a = await app();
    const s = await session(a);
    const items = [event(s), event(s, { name: 'answer_submitted', properties: {} }), event(s)];
    const first = await batch(a, items, { batch_id: 'b-1' });
    expect(first.accepted).toBe(3);
    const before = clientRows(a, s.id);
    const replay = await batch(a, items, { batch_id: 'b-1' });
    expect(replay.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(replay).toMatchObject({ accepted: 0, duplicates: 3, rejected: 0 });
    expect(clientRows(a, s.id)).toEqual(before);
    const logs = a.handle.db.select().from(ingestLog).all();
    expect(logs.map((l) => [l.batchId, l.accepted, l.duplicates, l.rejected])).toEqual([
      ['b-1', 3, 0, 0],
      ['b-1', 0, 3, 0],
    ]);
  });

  it('a broken event is rejected alone and the rest of the batch is stored', async () => {
    const a = await app();
    const s = await session(a);
    const good = [event(s), event(s)];
    const noId: Record<string, unknown> = { ...event(s) };
    delete noId.event_id;
    const res = await batch(a, [good[0], noId, 'not an object', good[1]]);
    expect(res.results).toEqual([
      { event_id: good[0]?.event_id, status: 'accepted' },
      { event_id: null, status: 'rejected', reason: 'invalid_event' },
      { event_id: null, status: 'rejected', reason: 'invalid_event' },
      { event_id: good[1]?.event_id, status: 'accepted' },
    ]);
    expect(res).toMatchObject({ accepted: 2, duplicates: 0, rejected: 2 });
    expect(clientRows(a, s.id)).toHaveLength(2);
    const rejected = a.handle.db.select().from(rejectedEvents).all();
    expect(rejected.map((r) => r.reason)).toEqual(['invalid_event', 'invalid_event']);
  });

  it('rejects an event that is not in the catalog of the pinned version', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, { name: 'recommendation_expanded', step_id: 'result' });
    const res = await batch(a, [e]);
    expect(res.results).toEqual([
      { event_id: e.event_id, status: 'rejected', reason: 'unknown_event' },
    ]);
    expect(clientRows(a, s.id)).toHaveLength(0);
  });

  it('drops properties outside the whitelist and flags them', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, {
      name: 'answer_submitted',
      properties: { answer_kind: 'number', value: 12, team_size: '12' },
    });
    expect((await batch(a, [e])).results[0]?.status).toBe('accepted');
    const [row] = clientRows(a, s.id);
    expect(JSON.parse(row?.propsJson ?? '')).toEqual({ answer_kind: 'number' });
    expect(row && flags(row)).toEqual({ dropped_props: ['value', 'team_size'] });
  });

  it('the order of arrival does not matter for what is stored', async () => {
    const a = await app();
    const s1 = await session(a, { variantOverride: 'A' });
    const s2 = await session(a, { variantOverride: 'A' });
    // Events that exercise every per-event rule: whitelist, mismatch, null step.
    const make = (s: SessionResponse['session']) => [
      event(s, { client_seq: 1 }),
      event(s, {
        client_seq: 2,
        name: 'answer_submitted',
        properties: { answer_kind: 'number', value: 3 },
      }),
      event(s, { client_seq: 3, name: 'step_completed', properties: { next_step_id: 'x' } }),
      event(s, {
        client_seq: 4,
        name: 'back_clicked',
        step_id: null,
        variant: 'B',
        properties: {},
      }),
      event(s, { client_seq: 5, name: 'result_viewed', step_id: 'result', properties: {} }),
    ];
    const ordered = make(s1);
    await batch(a, ordered);
    // Same events for s2, shuffled across three batches, with duplicates in between.
    const [e1, e2, e3, e4, e5] = make(s2);
    await batch(a, [e5, e3]);
    await batch(a, [e2, e5, e1]);
    await batch(a, [e4, e3, e1]);
    const stored = (id: string) =>
      clientRows(a, id).map((r) => {
        const rest = flags(r);
        delete rest.out_of_order;
        return [r.name, r.stepId, r.clientSeq, r.propsJson, rest, r.variant, r.funnelVersion];
      });
    expect(stored(s2.id)).toEqual(stored(s1.id));
    expect(stored(s1.id)).toHaveLength(5);
  });

  it('checks the step against the session variant, not the whole version', async () => {
    const a = await app();
    const config = configJson('funnel-v2.json', { version: 3 });
    const experiment = z
      .object({
        variants: z.object({ B: z.object({ stepSequence: z.array(z.string()) }).loose() }).loose(),
      })
      .loose()
      .parse(config.experiment);
    const B = experiment.variants.B;
    const withoutToolCount = {
      ...experiment,
      variants: {
        ...experiment.variants,
        B: { ...B, stepSequence: B.stepSequence.filter((id) => id !== 'tool_count') },
      },
    };
    const auth = { authorization: adminAuth };
    const upload = await a.app.inject({
      method: 'POST',
      url: '/api/admin/versions',
      payload: { ...config, experiment: withoutToolCount },
      headers: auth,
    });
    expect(upload.statusCode).toBe(201);
    const publish = await a.app.inject({
      method: 'POST',
      url: '/api/admin/versions/3/publish',
      headers: auth,
    });
    expect(publish.statusCode).toBe(200);
    const sa = await session(a, { variantOverride: 'A' });
    const sb = await session(a, { variantOverride: 'B' });
    const inA = event(sa, { step_id: 'tool_count' });
    const inB = event(sb, { step_id: 'tool_count' });
    expect((await batch(a, [inA, inB])).results.map((r) => r.status)).toEqual([
      'accepted',
      'rejected',
    ]);
  });

  it('takes version, experiment, variant and UTM from the session, flagging a mismatch', async () => {
    const a = await app();
    const s = await session(a, { utm: { source: 'linkedin', campaign: 'spring_launch' } });
    const other = s.variant === 'A' ? 'B' : 'A';
    const lying = event(s, {
      funnel_version: 9,
      experiment_id: 'forged',
      variant: other,
      utm_campaign: 'forged',
    });
    const honest = event(s, { utm_source: 'linkedin' });
    expect((await batch(a, [lying, honest])).accepted).toBe(2);
    const rows = clientRows(a, s.id);
    for (const row of rows) {
      expect(row).toMatchObject({
        funnelId: FUNNEL,
        funnelVersion: s.funnelVersion,
        experimentId: s.experimentId,
        variant: s.variant,
        utmSource: 'linkedin',
        utmCampaign: 'spring_launch',
        utmMedium: null,
        origin: 'client',
      });
    }
    expect(rows.map(flags)).toEqual([{ context_mismatch: true }, {}]);
  });
});

describe('ingest: per-event checks', () => {
  it('rejects an event of an unknown session', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, { session_id: uuidv7() });
    expect((await batch(a, [e])).results).toEqual([
      { event_id: e.event_id, status: 'rejected', reason: 'unknown_session' },
    ]);
  });

  it('rejects session_started from a client as server_only', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, { name: 'session_started', step_id: null, properties: {} });
    expect((await batch(a, [e])).results).toEqual([
      { event_id: e.event_id, status: 'rejected', reason: 'server_only' },
    ]);
  });

  it('rejects a step that is not part of the session', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, { step_id: 'meeting_hours' });
    expect((await batch(a, [e])).results).toEqual([
      { event_id: e.event_id, status: 'rejected', reason: 'unknown_step' },
    ]);
  });

  it('accepts an event without a step', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, { name: 'back_clicked', step_id: null, properties: {} });
    expect((await batch(a, [e])).accepted).toBe(1);
  });

  it('flags events whose client_seq is below the highest already stored', async () => {
    const a = await app();
    const s = await session(a);
    const e1 = event(s, { client_seq: 1 });
    const e3 = event(s, { client_seq: 3 });
    const e2 = event(s, { client_seq: 2 });
    const e4 = event(s, { client_seq: 4 });
    await batch(a, [e1, e3]);
    await batch(a, [e2, e4]);
    const bySeq = Object.fromEntries(
      clientRows(a, s.id).map((r): [string, unknown] => [String(r.clientSeq), flags(r)]),
    );
    expect(bySeq).toEqual({ 1: {}, 2: { out_of_order: true }, 3: {}, 4: {} });
  });

  it('stores a rejected item without property values or unknown keys', async () => {
    const a = await app();
    const s = await session(a);
    const e = event(s, {
      name: 'nope',
      properties: { team_size: 'secret-answer' },
      answer: 'secret-top-level',
    });
    await batch(a, [e, 'secret-string'], { batch_id: 'b-raw' });
    const rows = a.handle.db.select().from(rejectedEvents).all();
    expect(rows[0]).toMatchObject({
      batchId: 'b-raw',
      eventId: e.event_id,
      reason: 'unknown_event',
    });
    expect(JSON.parse(rows[0]?.rawJson ?? '')).toMatchObject({ properties: ['team_size'] });
    expect(rows[0]?.rawJson).not.toContain('secret');
    expect(rows[1]?.rawJson).toBe('{"type":"string"}');
  });

  it('cuts a stored rejected item to 4 KB without splitting a character', async () => {
    const a = await app();
    const s = await session(a);
    // Two-byte padding with both parities, so one of the cuts falls inside a character.
    for (const prefix of ['', 'a']) {
      await batch(a, [event(s, { name: 'nope', step_id: prefix + 'é'.repeat(5000) })]);
    }
    const raws = a.handle.db
      .select()
      .from(rejectedEvents)
      .all()
      .map((r) => r.rawJson);
    expect(raws).toHaveLength(2);
    for (const raw of raws) {
      expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(4096);
      expect(Buffer.byteLength(raw)).toBeGreaterThan(4090);
      expect(raw).not.toContain('\uFFFD');
    }
  });

  it('answers 413 to a body over 256 KB', async () => {
    const a = await app();
    const res = await a.app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload: { events: [{ padding: 'x'.repeat(257 * 1024) }] },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('answers 400 to a broken envelope and stores nothing', async () => {
    const a = await app();
    const s = await session(a);
    for (const payload of [{}, { events: 'x' }, { events: Array(101).fill(event(s)) }]) {
      const res = await a.app.inject({ method: 'POST', url: '/api/events/batch', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'invalid_request' } });
    }
    expect(a.handle.db.select().from(ingestLog).all()).toHaveLength(0);
  });

  it('answers 200 even when every event is rejected', async () => {
    const a = await app();
    const res = await batch(a, [1, 2]);
    expect(res).toMatchObject({ accepted: 0, duplicates: 0, rejected: 2 });
  });

  it('is rate limited per client, except for the generator', async () => {
    const a = await app({ env: { rateLimits: { sessions: 1000, events: 1 } } });
    expect((await send(a, [])).statusCode).toBe(200);
    const limited = await send(a, []);
    expect(limited.statusCode).toBe(429);
    const generator = await a.app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload: { events: [] },
      headers: generatorHeaders,
    });
    expect(generator.statusCode).toBe(200);
  });
});
