import { describe, expect, it } from 'vitest';
import { v1, v2 } from '../../test/fixtures.ts';
import { DomainError } from '../api/errors.ts';
import type { VariantKey } from '../config/schema.ts';
import { resolveFunnel } from '../engine/resolve.ts';
import {
  aggregate,
  type AggregateInput,
  type AnalyticsEvent,
  type AnalyticsSession,
  type AnalyticsVersion,
} from './aggregate.ts';
import { describeCondition } from './condition.ts';
import { AnalyticsFiltersSchema, AnalyticsSummarySchema } from './summary.ts';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const OLD_DAY = '2026-09-29';
const TODAY = '2026-10-01';

const version1: AnalyticsVersion = {
  version: 1,
  active: true,
  funnels: { A: resolveFunnel(v1(), 'A'), B: resolveFunnel(v1(), 'B') },
};
const version2: AnalyticsVersion = {
  version: 2,
  active: false,
  funnels: { A: resolveFunnel(v2(), 'A'), B: resolveFunnel(v2(), 'B') },
};

function session(
  id: string,
  variant: VariantKey,
  day: string,
  extra: Partial<AnalyticsSession> = {},
): AnalyticsSession {
  return {
    id,
    version: 1,
    variant,
    trafficType: 'live',
    utmSource: null,
    utmCampaign: null,
    resultId: null,
    createdAt: `${day}T10:00:00.000Z`,
    ...extra,
  };
}

/** Events of one session, minutes after 10:00 of `day`. */
function journal(sessionId: string, day: string) {
  const list: AnalyticsEvent[] = [];
  let minute = 0;
  const push = (
    name: string,
    stepId: string | null,
    properties: Record<string, unknown> = {},
    flags: Partial<AnalyticsEvent> = {},
  ) => {
    const at = new Date(`${day}T10:00:00.000Z`).getTime() + minute * 60_000;
    minute += 1;
    list.push({
      eventId: `${sessionId}:${String(list.length)}`,
      sessionId,
      name,
      stepId,
      serverTs: new Date(at).toISOString(),
      properties,
      ...flags,
    });
    return api;
  };
  const api = {
    list,
    start: () => push('session_started', null),
    view: (stepId: string) => push('step_viewed', stepId),
    answer: (stepId: string) => push('answer_submitted', stepId, { answer_kind: 'number' }),
    done: (stepId: string) => push('step_completed', stepId),
    /** Viewed, answered, completed. */
    pass: (...stepIds: string[]) => {
      for (const id of stepIds) api.view(id).answer(id).done(id);
      return api;
    },
    back: (from: string, to: string) => push('back_clicked', from, { destination_step_id: to }),
    result: (resultId: string, flags: Partial<AnalyticsEvent> = {}) =>
      push('result_viewed', 'result', { result_id: resultId }, flags),
    cta: (resultId: string, flags: Partial<AnalyticsEvent> = {}) =>
      push(
        'cta_clicked',
        'result',
        { result_id: resultId, action: 'expand_recommendation' },
        flags,
      ),
    raw: push,
    /** Moves the clock of the following events to `minutesBeforeNow` before NOW. */
    at: (minutesBeforeNow: number) => {
      minute =
        (NOW.getTime() - minutesBeforeNow * 60_000 - new Date(`${day}T10:00:00.000Z`).getTime()) /
        60_000;
      return api;
    },
  };
  return api;
}

const A_REMOTE = ['team_size', 'work_mode', 'priorities', 'timezone_span'] as const;
const A_TAIL = ['async_maturity', 'tool_count'] as const;
const B_HEAD = ['work_mode', 'timezone_span', 'team_size', 'async_maturity', 'priorities'] as const;

const linkedin = { utmSource: 'linkedin', utmCampaign: 'spring_launch' };
const newsletter = { utmSource: 'newsletter', utmCampaign: 'partner_webinar' };

/**
 * Ten sessions on v1 (test 5). Each carries one difficulty: repeated views, back, a step
 * known only from `step_completed`, events in shuffled order, exact duplicates, a live
 * session still in progress, a synthetic one that stops recently, a QA override.
 */
function fixture() {
  const sessions: AnalyticsSession[] = [];
  const events: AnalyticsEvent[] = [];
  const add = (s: AnalyticsSession, list: AnalyticsEvent[]) => {
    sessions.push(s);
    events.push(...list);
  };

  // s1 (A, hybrid): the whole path with office_days, a repeated view of team_size, CTA.
  add(
    session('s1', 'A', OLD_DAY, { ...linkedin, resultId: 'hybrid_structured' }),
    journal('s1', OLD_DAY)
      .start()
      .view('intro')
      .view('team_size')
      .pass(...A_REMOTE, 'office_days', ...A_TAIL)
      .result('hybrid_structured')
      .cta('hybrid_structured').list,
  );
  // s2 (A, remote): goes back from work_mode to team_size and passes again; no CTA.
  add(
    session('s2', 'A', OLD_DAY, { ...linkedin, resultId: 'async_native' }),
    journal('s2', OLD_DAY)
      .start()
      .view('intro')
      .pass('team_size')
      .view('work_mode')
      .back('work_mode', 'team_size')
      .pass('team_size', 'work_mode', 'priorities', 'timezone_span', ...A_TAIL)
      .result('async_native').list,
  );
  // s3 (A): leaves on priorities without answering.
  add(
    session('s3', 'A', OLD_DAY, linkedin),
    journal('s3', OLD_DAY).start().view('intro').pass('team_size', 'work_mode').view('priorities')
      .list,
  );
  // s4 (A, remote): no step_viewed for most steps (lost), cta_clicked before result_viewed,
  // and the whole journal shuffled.
  const s4 = journal('s4', OLD_DAY).start();
  for (const id of [...A_REMOTE, ...A_TAIL]) s4.done(id);
  s4.view('priorities').cta('async_native', { outOfOrder: true }).result('async_native', {
    outOfOrder: true,
  });
  add(session('s4', 'A', OLD_DAY, { resultId: 'async_native' }), [...s4.list].reverse());
  // s5 (A): started and never rendered a step.
  add(session('s5', 'A', TODAY), journal('s5', TODAY).start().list);
  // s6 (B, remote): the whole path, one event with a context mismatch.
  add(
    session('s6', 'B', TODAY, { ...newsletter, resultId: 'balanced' }),
    journal('s6', TODAY)
      .start()
      .view('intro')
      .pass(...B_HEAD, 'tool_count')
      .raw('step_viewed', 'tool_count', {}, { contextMismatch: true })
      .result('balanced')
      .cta('balanced').list,
  );
  // s7 (B): views work_mode and leaves; every event delivered twice.
  const s7 = journal('s7', TODAY).start().view('intro').view('work_mode').list;
  add(session('s7', 'B', TODAY, newsletter), [...s7, ...s7]);
  // s8 (B, live): on timezone_span ten minutes ago: in progress, not dropped.
  add(
    session('s8', 'B', TODAY, linkedin),
    journal('s8', TODAY).start().view('intro').pass('work_mode').at(10).view('timezone_span').list,
  );
  // s9 (B, synthetic): stopped on team_size five minutes ago: final, so dropped.
  add(
    session('s9', 'B', TODAY, { ...linkedin, trafficType: 'synthetic' }),
    journal('s9', TODAY)
      .start()
      .view('intro')
      .pass('work_mode', 'timezone_span')
      .at(5)
      .view('team_size').list,
  );
  // s10 (B, QA override): converts; hidden unless includeQa.
  add(
    session('s10', 'B', TODAY, { trafficType: 'qa', resultId: 'balanced' }),
    journal('s10', TODAY)
      .start()
      .view('intro')
      .pass(...B_HEAD, 'tool_count')
      .result('balanced', { outOfOrder: true })
      .cta('balanced').list,
  );
  return { sessions, events };
}

const INGEST = { duplicates: 3, rejected: [{ reason: 'unknown_event' as const, count: 2 }] };

function run(filters: Record<string, string> = {}, input: Partial<AggregateInput> = {}) {
  const { sessions, events } = fixture();
  const summary = aggregate({
    sessions,
    events,
    versions: [version1, version2],
    ingest: INGEST,
    filters: AnalyticsFiltersSchema.parse(filters),
    now: NOW,
    ...input,
  });
  // The output is exactly the API contract.
  AnalyticsSummarySchema.parse(summary);
  return summary;
}

function stepOf(summary: ReturnType<typeof run>, stepId: string) {
  const step = summary.steps.find((s) => s.stepId === stepId);
  if (!step) throw new Error(`no step ${stepId}`);
  return step;
}

describe('test 5: analytics on a fixture with repeats, back, duplicates and shuffled order', () => {
  const summary = run();

  it('counts KPIs by unique sessions per variant', () => {
    expect(summary.kpis.A).toEqual({
      started: 5,
      reachedResult: 3,
      clickedCta: 2,
      inProgress: 0,
      resultRate: 3 / 5,
      ctaCtr: 2 / 3,
      startedToCta: 2 / 5,
      backUsage: 1 / 5,
    });
    expect(summary.kpis.B).toEqual({
      started: 4,
      reachedResult: 1,
      clickedCta: 1,
      inProgress: 1,
      resultRate: 1 / 4,
      ctaCtr: 1,
      startedToCta: 1 / 4,
      backUsage: 0,
    });
    expect(summary.kpis.all).toMatchObject({
      started: 9,
      reachedResult: 4,
      clickedCta: 3,
      inProgress: 1,
      startedToCta: 3 / 9,
    });
  });

  it('counts reached once per session, with implied reach from step_completed', () => {
    const reached = Object.fromEntries(
      summary.steps.map((s) => [
        s.stepId,
        [s.metrics.all.reached, s.metrics.A?.reached, s.metrics.B?.reached],
      ]),
    );
    expect(reached).toEqual({
      intro: [8, 4, 4],
      team_size: [6, 4, 2],
      work_mode: [8, 4, 4],
      priorities: [5, 4, 1],
      timezone_span: [6, 3, 3],
      office_days: [1, 1, 0],
      async_maturity: [4, 3, 1],
      tool_count: [4, 3, 1],
      result: [4, 3, 1],
    });
  });

  it('computes completed and pass rate from step_completed or any later step', () => {
    const pass = Object.fromEntries(
      summary.steps.map((s) => [s.stepId, [s.metrics.all.completed, s.metrics.all.passRate]]),
    );
    expect(pass).toEqual({
      intro: [7, 7 / 8],
      team_size: [5, 5 / 6],
      work_mode: [7, 7 / 8],
      priorities: [4, 4 / 5],
      timezone_span: [5, 5 / 6],
      office_days: [1, 1],
      async_maturity: [4, 1],
      tool_count: [4, 1],
      result: [4, 1],
    });
  });

  it('attributes drop-offs to the furthest step and keeps recent live sessions in progress', () => {
    const dropped = Object.fromEntries(
      summary.steps
        .filter((s) => s.metrics.all.droppedHere > 0)
        .map((s) => [s.stepId, [s.metrics.A?.droppedHere, s.metrics.B?.droppedHere]]),
    );
    // s5 sent no step event: it reached the first step and left there.
    // s9 is synthetic: final at once, although its last event is recent.
    expect(dropped).toEqual({
      intro: [1, 0],
      work_mode: [0, 1],
      priorities: [1, 0],
      team_size: [0, 1],
    });
    const total = summary.steps.reduce((n, s) => n + s.metrics.all.droppedHere, 0);
    expect(total + summary.kpis.all.inProgress + summary.kpis.all.reachedResult).toBe(9);
  });

  it('never drops more sessions on a step than reached it', () => {
    for (const step of summary.steps) {
      expect(step.metrics.all.droppedHere).toBeLessThanOrEqual(
        step.metrics.all.reached - step.metrics.all.completed,
      );
    }
    expect(stepOf(summary, 'intro').metrics.A).toMatchObject({
      reached: 4,
      completed: 3,
      droppedHere: 1,
    });
  });

  it('counts sessions that came back to a step', () => {
    expect(stepOf(summary, 'team_size').metrics.all.cameBack).toBe(1);
    expect(stepOf(summary, 'work_mode').metrics.all.cameBack).toBe(0);
  });

  it('splits results and branches by session', () => {
    expect(summary.results).toEqual([
      { resultId: 'async_native', sessions: { A: 2, B: 0, all: 2 } },
      { resultId: 'hybrid_structured', sessions: { A: 1, B: 0, all: 1 } },
      { resultId: 'office_core', sessions: { A: 0, B: 0, all: 0 } },
      { resultId: 'balanced', sessions: { A: 0, B: 1, all: 1 } },
    ]);
    expect(summary.branches).toEqual([
      {
        stepId: 'office_days',
        parentStepId: 'work_mode',
        seen: 1,
        parentReached: 8,
        share: 1 / 8,
      },
    ]);
    expect(stepOf(summary, 'office_days').condition).toBe('if work_mode in hybrid, office');
    expect(stepOf(summary, 'team_size').condition).toBeNull();
  });

  it('compares A and B on started → CTA with an honest verdict', () => {
    const { experiment } = summary;
    expect(experiment.A).toMatchObject({ sessions: 5, conversions: 2, rate: 0.4 });
    expect(experiment.B).toMatchObject({ sessions: 4, conversions: 1, rate: 0.25 });
    expect(experiment.diffPoints).toBeCloseTo(-15, 10);
    expect(experiment.pValue).toBeCloseTo(0.635, 3);
    expect(experiment.requiredPerVariant).toBe(152);
    expect(experiment.verdict).toBe(
      'A is ahead by 15.0 points, but the difference is not significant yet (p = 0.635).',
    );
  });

  it('reports data quality, daily starts and sources', () => {
    expect(summary.dataQuality).toEqual({
      duplicates: 3,
      outOfOrder: 2,
      contextMismatch: 1,
      rejected: [{ reason: 'unknown_event', count: 2 }],
    });
    expect(summary.daily).toEqual([
      { date: '2026-09-29', started: 4 },
      { date: '2026-09-30', started: 0 },
      { date: '2026-10-01', started: 5 },
    ]);
    expect(summary.sources).toEqual([
      { source: 'linkedin', sessions: 5 },
      { source: 'newsletter', sessions: 2 },
      { source: null, sessions: 2 },
    ]);
  });

  it('does not change when events are duplicated and shuffled', () => {
    const { sessions, events } = fixture();
    const shuffled = [...events, ...events.slice().reverse()].sort((x, y) =>
      (x.name + x.sessionId).localeCompare(y.name + y.sessionId),
    );
    expect(run({}, { sessions, events: shuffled })).toEqual(summary);
  });
});

describe('aggregate filters', () => {
  it('selects one variant and its sequence', () => {
    const a = run({ variant: 'A' });
    expect(a.kpis.B).toBeNull();
    expect(a.kpis.all).toEqual(a.kpis.A);
    expect(a.steps.map((s) => s.stepId)).toEqual(version1.funnels.A.sequence);
    expect(a.steps.every((s) => s.metrics.B === null)).toBe(true);
    const b = run({ variant: 'B' });
    expect(b.steps.map((s) => s.stepId)).toEqual(version1.funnels.B.sequence);
    // The A/B comparison always shows both variants.
    expect(b.experiment.A.sessions).toBe(5);
  });

  it('filters by campaign, source and period', () => {
    expect(run({ campaign: 'partner_webinar' }).kpis.all.started).toBe(2);
    const linked = run({ source: 'linkedin' });
    expect(linked.kpis.all.started).toBe(5);
    expect(linked.sources).toHaveLength(3);
    expect(run({ from: '2026-10-01T00:00:00Z' }).kpis.all.started).toBe(5);
    expect(run({ to: '2026-09-30T00:00:00Z' }).kpis.all.started).toBe(4);
  });

  it('hides QA sessions unless asked', () => {
    const withQa = run({ includeQa: 'true' });
    expect(withQa.kpis.B?.started).toBe(5);
    expect(withQa.kpis.B?.clickedCta).toBe(2);
    expect(withQa.dataQuality.outOfOrder).toBe(3);
  });

  it('turns an in-progress live session into a drop-off after 30 minutes', () => {
    const later = run({}, { now: new Date(NOW.getTime() + 25 * 60_000) });
    expect(later.kpis.all.inProgress).toBe(0);
    expect(stepOf(later, 'timezone_span').metrics.B?.droppedHere).toBe(1);
  });

  it('defaults to the active version and compares versions', () => {
    const { sessions, events } = fixture();
    const onV2 = journal('v2s', TODAY).start().view('intro').list;
    const summary = run(
      {},
      {
        sessions: [...sessions, { ...session('v2s', 'A', TODAY), version: 2 }],
        events: [...events, ...onV2],
      },
    );
    expect(summary.version).toBe(1);
    expect(summary.versions.map((v) => [v.version, v.active, v.kpis.started])).toEqual([
      [1, true, 9],
      [2, false, 1],
    ]);
    const second = run(
      { version: '2' },
      {
        sessions: [...sessions, { ...session('v2s', 'A', TODAY), version: 2 }],
        events: [...events, ...onV2],
      },
    );
    expect(second.kpis.all.started).toBe(1);
    expect(second.experimentId).toBe('question-order-and-result-framing-v2');
    expect(second.steps.map((s) => s.stepId)).toContain('meeting_hours');
  });

  it('rejects an unknown version', () => {
    expect(() => run({ version: '9' })).toThrow(DomainError);
    expect(() => run({}, { versions: [{ ...version1, active: false }] })).toThrow(DomainError);
  });

  it('ignores sessions without session_started and of versions it does not know', () => {
    const summary = run(
      {},
      {
        sessions: [session('lost', 'A', TODAY), { ...session('v9', 'A', TODAY), version: 9 }],
        events: journal('lost', TODAY).view('intro').list,
      },
    );
    expect(summary.kpis.all.started).toBe(0);
    expect(summary.daily).toEqual([]);
    expect(summary.experiment.verdict).toBe('Not enough data yet: both variants need sessions.');
  });
});

describe('aggregate: server-owned facts', () => {
  it('takes the result of a session from its row, not from client events', () => {
    const { sessions, events } = fixture();
    const rows = sessions.map((s) => (s.id === 's4' ? { ...s, resultId: 'office_core' } : s));
    const summary = run({}, { sessions: rows, events });
    const byResult = Object.fromEntries(summary.results.map((r) => [r.resultId, r.sessions.A]));
    expect(byResult).toMatchObject({ async_native: 1, office_core: 1, hybrid_structured: 1 });
  });

  it('splits a branch only among sessions whose variant has the conditional step', () => {
    const b = resolveFunnel(v1(), 'B');
    const version = {
      ...version1,
      funnels: {
        A: version1.funnels.A,
        B: { ...b, sequence: b.sequence.filter((id) => id !== 'office_days') },
      },
    };
    const summary = run({}, { versions: [version] });
    expect(summary.branches).toEqual([
      { stepId: 'office_days', parentStepId: 'work_mode', seen: 1, parentReached: 4, share: 1 / 4 },
    ]);
  });
});

describe('aggregate: catalog events beyond the base seven', () => {
  it('lists each extra catalog event with unique sessions and share of CTA sessions', () => {
    const extra = (variant: VariantKey) => {
      const funnel = resolveFunnel(v1(), variant);
      return {
        ...funnel,
        eventCatalog: [...funnel.eventCatalog, { name: 'plan_shared', properties: ['result_id'] }],
      };
    };
    const version = { version: 1, active: true, funnels: { A: extra('A'), B: extra('B') } };
    const { sessions, events } = fixture();
    const shared = journal('s1', OLD_DAY).raw('plan_shared', 'result').list;
    const summary = run(
      {},
      { versions: [version], sessions, events: [...events, ...shared, ...shared] },
    );
    expect(summary.otherEvents).toEqual([{ name: 'plan_shared', sessions: 1, shareOfCta: 1 / 3 }]);
    expect(run().otherEvents).toEqual([]);
  });
});

describe('aggregate: verdict wording', () => {
  function verdictFor(a: [number, number], b: [number, number]) {
    const sessions: AnalyticsSession[] = [];
    const events: AnalyticsEvent[] = [];
    const add = (variant: VariantKey, [total, converted]: [number, number]) => {
      for (let i = 0; i < total; i += 1) {
        const id = `${variant}${String(i)}`;
        sessions.push(session(id, variant, OLD_DAY));
        const j = journal(id, OLD_DAY).start().view('intro');
        if (i < converted) j.result('balanced').cta('balanced');
        events.push(...j.list);
      }
    };
    add('A', a);
    add('B', b);
    return run({}, { sessions, events }).experiment;
  }

  it('calls a significant difference significant, never "wins"', () => {
    const result = verdictFor([200, 20], [200, 60]);
    expect(result.verdict).toMatch(
      /^B is ahead by 20\.0 points, and the difference is significant \(p < 0\.001\)\.$/,
    );
    expect(result.verdict).not.toMatch(/win/i);
  });

  it('says so when there is no difference', () => {
    expect(verdictFor([10, 3], [10, 3]).verdict).toBe('No difference between A and B yet.');
    expect(verdictFor([10, 0], [10, 0]).requiredPerVariant).toBeNull();
  });
});

describe('describeCondition', () => {
  it('prints every operator and nesting', () => {
    expect(
      describeCondition({
        all: [
          { answer: 'team_size', operator: 'gte', value: 10 },
          {
            any: [
              { answer: 'priorities', operator: 'contains', value: ['focus'] },
              { not: { answer: 'mode', operator: 'eq', value: 'remote' } },
            ],
          },
          { answer: 'tools', operator: 'exists' },
          { answer: 'tools2', operator: 'exists', value: false },
          { answer: 'x', operator: 'weird', value: { a: 1 } },
        ],
      }),
    ).toBe(
      'if team_size ≥ 10 and (priorities includes focus or not mode is remote) and tools is answered and tools2 is not answered and x weird {"a":1}',
    );
  });
});
