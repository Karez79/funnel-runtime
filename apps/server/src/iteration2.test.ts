// Tests of CLAUDE.md 12 that need funnel-v3 (Phase 7): the second iteration goes to a
// running server through the admin API only. Publishing v3 must not change the database
// schema, a v2 session caught mid-way on a step v3 removed must still finish on v2, and
// the event v3 adds is accepted only from v3 sessions and shows up in Other events.
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnalyticsSummarySchema,
  answerKey,
  computeResult,
  contract,
  ErrorBody,
  isInteractive,
  nextStep,
  type AnswerValue,
  type SessionResponse,
  type Step,
} from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { adminAuth, configJson, createTestApp, type TestApp } from './test/harness.ts';

const FUNNEL = 'workstyle-planner';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function app(): Promise<TestApp> {
  t = await createTestApp();
  return t;
}

async function admin(a: TestApp, method: 'GET' | 'POST', url: string, payload?: object) {
  return a.app.inject({
    method,
    url,
    headers: { authorization: adminAuth },
    ...(payload === undefined ? {} : { payload }),
  });
}

/** v2 published and active, as on prod before the second iteration. */
async function onV2(a: TestApp) {
  expect((await admin(a, 'POST', '/api/admin/versions/2/publish', {})).statusCode).toBe(200);
}

/** Uploads configs/funnel-v3.json as a draft and publishes it, like the admin UI or API. */
async function publishV3(a: TestApp) {
  const upload = await admin(a, 'POST', '/api/admin/versions', configJson('funnel-v3.json'));
  expect(upload.statusCode).toBe(201);
  const { lint } = contract.uploadVersion.response.parse(upload.json());
  expect(lint.errors).toEqual([]);
  expect((await admin(a, 'POST', '/api/admin/versions/3/publish', {})).statusCode).toBe(200);
}

async function newSession(a: TestApp, body: Record<string, unknown> = {}) {
  const res = await a.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { funnelId: FUNNEL, ...body },
  });
  expect(res.statusCode).toBe(201);
  return contract.createSession.response.parse(res.json());
}

/** A valid answer: the preferred one if given, else the first option or the minimum. */
function answer(step: Step, preferred: Record<string, AnswerValue>): AnswerValue {
  if (!isInteractive(step)) throw new Error(`${step.id} takes no answer`);
  const given = preferred[answerKey(step)];
  if (given !== undefined) return given;
  if (step.type === 'number') return step.input.min ?? 0;
  const first = step.input.options[0]?.value ?? '';
  return step.type === 'multi-select' ? [first] : first;
}

/**
 * Walks a session forward with the shared engine, saving the state on every move, until
 * `stopAt` is the current step (or the result). Returns the last saved revision.
 */
async function walk(
  a: TestApp,
  { session, funnel }: SessionResponse,
  stopAt: string,
  preferred: Record<string, AnswerValue> = {},
): Promise<SessionResponse['session']['state']> {
  let state = session.state;
  let rev = session.stateRev;
  while (state.currentStepId !== stopAt) {
    const step = funnel.steps[state.currentStepId];
    if (!step || step.type === 'result') break;
    const answers = isInteractive(step)
      ? { ...state.answers, [answerKey(step)]: answer(step, preferred) }
      : state.answers;
    const next = nextStep(funnel, answers, step.id);
    if (next === null) throw new Error(`no step after ${step.id}`);
    state = { answers, history: [...state.history, step.id], currentStepId: next };
    const res = await a.app.inject({
      method: 'PUT',
      url: `/api/sessions/${session.id}/state`,
      payload: { state, baseRev: rev },
    });
    expect(res.statusCode).toBe(200);
    rev = contract.saveState.response.parse(res.json()).stateRev;
  }
  return state;
}

async function complete(a: TestApp, id: string) {
  const res = await a.app.inject({ method: 'POST', url: `/api/sessions/${id}/complete` });
  expect(res.statusCode).toBe(200);
  return contract.completeSession.response.parse(res.json());
}

/** Everything the schema is made of, plus how many migrations were applied. */
function schemaSnapshot(a: TestApp) {
  return {
    objects: a.handle.db.all<{ type: string; name: string; sql: string | null }>(
      sql`select type, name, sql from sqlite_master order by type, name`,
    ),
    migrations: a.handle.db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)
      .n,
  };
}

/** A client event of the session, with the context the session itself has. */
function clientEvent(
  s: SessionResponse['session'],
  name: string,
  stepId: string,
  properties: Record<string, string | number>,
) {
  return {
    event_id: uuidv7(),
    session_id: s.id,
    name,
    client_timestamp: new Date().toISOString(),
    client_seq: 1,
    funnel_id: FUNNEL,
    funnel_version: s.funnelVersion,
    experiment_id: s.experimentId,
    variant: s.variant,
    step_id: stepId,
    properties,
  };
}

const expandedEvent = (s: SessionResponse['session']) =>
  clientEvent(s, 'recommendation_expanded', 'result', {
    result_id: 'balanced',
    action: 'expand_recommendation',
    source: 'result_cta',
  });

async function sendEvents(a: TestApp, events: unknown[]) {
  const res = await a.app.inject({
    method: 'POST',
    url: '/api/events/batch',
    payload: { events },
  });
  expect(res.statusCode).toBe(200);
  return contract.eventsBatch.response.parse(res.json());
}

describe('the database schema does not change when v3 is published', () => {
  it('sqlite_master and the applied migrations are identical before and after', async () => {
    const a = await app();
    await onV2(a);
    const before = schemaSnapshot(a);
    expect(before.objects.map((o) => o.name)).toContain('events');

    await publishV3(a);
    const s = await newSession(a);
    expect(s.session.funnelVersion).toBe(3);
    await sendEvents(a, [expandedEvent(s.session)]);
    expect((await admin(a, 'POST', '/api/admin/rollback', {})).statusCode).toBe(200);

    expect(schemaSnapshot(a)).toEqual(before);
  });
});

describe('a v2 session survives the publication of v3', () => {
  it('B paused on tool_count finishes on v2; new B sessions get v3 without tool_count', async () => {
    const a = await app();
    await onV2(a);
    const old = await newSession(a, { variantOverride: 'B' });
    expect(old.session.funnelVersion).toBe(2);
    expect(old.funnel.sequence).toContain('tool_count');
    const paused = await walk(a, old, 'tool_count');
    expect(paused.currentStepId).toBe('tool_count');

    await publishV3(a);

    // The session is still pinned to v2 and comes back with v2's funnel.
    const res = await a.app.inject({ method: 'GET', url: `/api/sessions/${old.session.id}` });
    expect(res.statusCode).toBe(200);
    const resumed = contract.getSession.response.parse(res.json());
    expect(resumed.session.funnelVersion).toBe(2);
    expect(resumed.funnel.steps['tool_count']).toBeDefined();
    const events = await sendEvents(a, [
      clientEvent(resumed.session, 'step_viewed', 'tool_count', { step_type: 'number' }),
    ]);
    expect(events.accepted).toBe(1);
    const finished = await walk(a, resumed, 'result', { tool_count: 12 });
    expect(finished.answers['tool_count']).toBe(12);
    // The result is v2's: computed on the pinned funnel, with v2's B wording, not v3's
    // (v3 changes the wording of every B result).
    const { resultId, result } = await complete(a, old.session.id);
    expect(resultId).toBe(computeResult(resumed.funnel, finished.answers));
    expect(result).toEqual(resumed.funnel.results[resultId]);

    // A new session of variant B starts on v3, where B has no tool_count.
    const fresh = await newSession(a, { variantOverride: 'B' });
    expect(fresh.session.funnelVersion).toBe(3);
    expect(fresh.funnel.sequence).not.toContain('tool_count');
    expect(fresh.funnel.results[resultId]).not.toEqual(result);
    const stale = await a.app.inject({
      method: 'PUT',
      url: `/api/sessions/${fresh.session.id}/state`,
      payload: {
        state: { answers: {}, history: ['intro'], currentStepId: 'tool_count' },
        baseRev: fresh.session.stateRev,
      },
    });
    expect(stale.statusCode).toBe(422);
    expect(ErrorBody.parse(stale.json()).error.code).toBe('unprocessable');

    // The v3 session walks the compliance branch to the new result.
    await walk(a, fresh, 'result', {
      priorities: ['compliance'],
      security_constraints: 'regulated',
    });
    expect((await complete(a, fresh.session.id)).resultId).toBe('regulated_scale');
  });
});

describe('recommendation_expanded belongs to v3 only', () => {
  it('is accepted from a v3 session, rejected from a v2 one, and listed in Other events of v3', async () => {
    const a = await app();
    await onV2(a);
    const v2 = (await newSession(a)).session;
    await publishV3(a);
    const v3 = (await newSession(a)).session;

    const [fromV2, fromV3] = [expandedEvent(v2), expandedEvent(v3)];
    expect((await sendEvents(a, [fromV2, fromV3])).results).toEqual([
      { event_id: fromV2.event_id, status: 'rejected', reason: 'unknown_event' },
      { event_id: fromV3.event_id, status: 'accepted' },
    ]);

    const otherEvents = async (version: number) => {
      const summary = await admin(a, 'GET', `/api/analytics/summary?version=${String(version)}`);
      expect(summary.statusCode).toBe(200);
      return AnalyticsSummarySchema.parse(summary.json()).otherEvents;
    };
    expect(await otherEvents(2)).toEqual([]);
    expect(await otherEvents(3)).toEqual([
      // No CTA click in this case, so there is no share of CTA sessions to report.
      { name: 'recommendation_expanded', sessions: 1, shareOfCta: null },
    ]);
  });
});
