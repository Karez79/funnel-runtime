import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { v1, v2 } from '../../test/fixtures.ts';
import { diffConfigs } from '../config/diff.ts';
import { lintConfig } from '../config/lint.ts';
import { resolveFunnel } from '../engine/resolve.ts';
import { AnalyticsSummarySchema } from '../analytics/summary.ts';
import { contract, LiveEntrySchema, LIVE_STREAM, type RouteDef } from './contract.ts';

const routes: [string, RouteDef][] = Object.entries(contract);

describe('contract', () => {
  it('has one definition per method and path', () => {
    const keys = routes.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('protects exactly the admin, analytics and live paths (6)', () => {
    for (const [name, r] of routes) {
      const adminPath = /^\/api\/(admin|analytics)\//.test(r.path);
      expect({ name, auth: r.auth }).toEqual({ name, auth: adminPath ? 'admin' : 'public' });
    }
    expect(LIVE_STREAM.auth).toBe('admin');
  });

  it('caps the event batch at 256 KB and session state at 64 KB (6.0)', () => {
    expect(contract.eventsBatch.bodyLimit).toBe(256 * 1024);
    expect(contract.saveState.bodyLimit).toBe(64 * 1024);
  });
});

// The server serialises responses with z.encode, which fails on transforms.
const encodes = (schema: z.ZodType, value: unknown) => z.safeEncode(schema, value).success;

describe('response schemas encode real values', () => {
  it('session response with a resolved funnel of each variant', () => {
    for (const variant of ['A', 'B'] as const) {
      const funnel = resolveFunnel(v1(), variant);
      const session = {
        id: '01928f5e-7b3a-7c4d-9e2f-0123456789ac',
        funnelVersion: 1,
        experimentId: funnel.meta.experimentId,
        variant,
        variantSource: 'hash',
        state: {
          answers: { team_size: 4, priorities: ['speed'] },
          history: [],
          currentStepId: 'intro',
        },
        stateRev: 0,
        resultId: null,
        createdAt: '2026-10-01T10:00:00.000Z',
        expiresAt: '2026-10-04T10:00:00.000Z',
      };
      expect(encodes(contract.getSession.response, { session, funnel })).toBe(true);
      expect(encodes(contract.createSession.response, { session, funnel })).toBe(true);
    }
  });

  it('diff and lint report of v1 → v2', () => {
    const body = {
      version: 2,
      against: 1,
      changes: diffConfigs(v1(), v2()),
      lint: lintConfig(v2(), { previous: v1() }),
    };
    expect(encodes(contract.versionDiff.response, body)).toBe(true);
  });

  it('complete response carries a result with overrides', () => {
    const result = resolveFunnel(v1(), 'B').results['async_native'];
    expect(encodes(contract.completeSession.response, { resultId: 'async_native', result })).toBe(
      true,
    );
  });
});

describe('response schemas encode the remaining shapes', () => {
  const kpis = {
    started: 10,
    reachedResult: 6,
    clickedCta: 3,
    inProgress: 1,
    resultRate: 0.6,
    ctaCtr: 0.5,
    startedToCta: 0.3,
    backUsage: null,
  };
  const step = { reached: 10, completed: 9, passRate: 0.9, droppedHere: 1, cameBack: 2 };
  const proportion = { sessions: 5, conversions: 2, rate: 0.4, ci: [0.12, 0.77] };

  it('analytics summary', () => {
    const summary = {
      funnelId: 'workstyle-planner',
      version: 2,
      experimentId: 'e',
      kpis: { A: kpis, B: null, all: kpis },
      sequences: { A: ['intro', 'result'], B: ['intro', 'result'] },
      steps: [
        {
          stepId: 'office_days',
          type: 'number',
          condition: 'if work_mode in hybrid, office',
          metrics: { A: step, B: step, all: step },
        },
      ],
      results: [{ resultId: 'balanced', sessions: { A: 1, B: 2, all: 3 } }],
      branches: [
        {
          stepId: 'office_days',
          parentStepId: 'work_mode',
          seen: 4,
          parentReached: 9,
          share: 0.44,
        },
      ],
      experiment: {
        metric: 'started_to_cta',
        A: proportion,
        B: proportion,
        diffPoints: 0,
        pValue: 1,
        requiredPerVariant: null,
        verdict: 'No difference yet.',
      },
      versions: [{ version: 2, active: true, kpis }],
      otherEvents: [{ name: 'plan_opened', sessions: 1, shareOfCta: 0.33 }],
      dataQuality: {
        duplicates: 3,
        outOfOrder: 2,
        contextMismatch: 0,
        rejected: [{ reason: 'unknown_event', count: 1 }],
      },
      daily: [{ date: '2026-10-01', started: 10 }],
      sources: [{ source: null, sessions: 1 }],
      groundTruthMatches: true,
    };
    expect(encodes(AnalyticsSummarySchema, summary)).toBe(true);
    expect(encodes(contract.analyticsSummary.response, summary)).toBe(true);
  });

  it('versions list, live entry, batch response', () => {
    const version = {
      funnelId: 'workstyle-planner',
      version: 1,
      title: 't',
      state: 'published',
      releaseNote: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      activatedAt: '2026-10-01T10:00:00.000Z',
      active: true,
      activeSessions: 2,
      totalSessions: 5,
    };
    const activation = {
      id: 1,
      version: 1,
      action: 'publish',
      fromVersion: null,
      note: null,
      createdAt: version.createdAt,
    };
    expect(
      encodes(contract.listVersions.response, { versions: [version], activations: [activation] }),
    ).toBe(true);
    const live = {
      seq: 1_759_312_800_000_000,
      receivedAt: version.createdAt,
      eventId: 'e',
      sessionId: 's',
      name: 'step_viewed',
      stepId: 'intro',
      version: 1,
      variant: 'A',
      status: 'duplicate',
      reason: null,
    };
    expect(encodes(LiveEntrySchema, live)).toBe(true);
    // Without seq a row has no identity on the Live page.
    expect(encodes(LiveEntrySchema, { ...live, seq: undefined })).toBe(false);
    const batch = {
      results: [
        { event_id: 'e', status: 'accepted' },
        { event_id: null, status: 'rejected', reason: 'invalid_event' },
      ],
      accepted: 1,
      duplicates: 0,
      rejected: 1,
    };
    expect(encodes(contract.eventsBatch.response, batch)).toBe(true);
  });
});

describe('error details', () => {
  it('saveState conflict carries the server state; publish carries the lint report', () => {
    const details = { state: { answers: {}, history: [], currentStepId: 'intro' }, stateRev: 4 };
    expect(contract.saveState.errorDetails.conflict.safeParse(details).success).toBe(true);
    const lint = lintConfig(v1());
    expect(contract.publishVersion.errorDetails.unprocessable.safeParse(lint).success).toBe(true);
  });
});

describe('request schemas', () => {
  it('activation note is optional and the body may be absent', () => {
    expect(contract.rollback.body.parse(undefined)).toEqual({});
    expect(contract.publishVersion.body.parse({ note: 'Ship it' })).toEqual({ note: 'Ship it' });
    expect(contract.uploadVersion.query.parse({ releaseNote: 'Adds meetings' })).toEqual({
      releaseNote: 'Adds meetings',
    });
  });

  it('session creation defaults utm and accepts only synthetic as traffic type', () => {
    const body = contract.createSession.body;
    expect(body.parse({ funnelId: 'workstyle-planner' })).toEqual({
      funnelId: 'workstyle-planner',
      utm: {},
    });
    expect(body.safeParse({ funnelId: 'f', trafficType: 'qa' }).success).toBe(false);
    expect(body.safeParse({ funnelId: 'f', variantOverride: 'C' }).success).toBe(false);
  });

  it('saveState requires a state and a base revision', () => {
    const body = contract.saveState.body;
    const state = { answers: { work_mode: 'remote' }, history: ['intro'], currentStepId: 'x' };
    expect(body.safeParse({ state, baseRev: 2 }).success).toBe(true);
    expect(body.safeParse({ state }).success).toBe(false);
    expect(
      body.safeParse({ state: { ...state, answers: { a: { b: 1 } } }, baseRev: 0 }).success,
    ).toBe(false);
  });

  it('version params and diff query coerce from strings', () => {
    expect(contract.publishVersion.params.parse({ v: '3' })).toEqual({ v: 3 });
    expect(contract.versionDiff.query.parse({})).toEqual({ against: 'active' });
    expect(contract.versionDiff.query.parse({ against: '1' })).toEqual({ against: 1 });
    expect(contract.publishVersion.params.safeParse({ v: 'x' }).success).toBe(false);
  });

  it('analytics filters parse query strings', () => {
    expect(
      contract.analyticsSummary.query.parse({
        version: '2',
        campaign: 'spring_launch',
        includeQa: 'true',
      }),
    ).toEqual({ version: 2, variant: 'all', campaign: 'spring_launch', includeQa: true });
    expect(contract.analyticsSummary.query.parse({})).toEqual({ variant: 'all', includeQa: false });
    expect(contract.analyticsSummary.query.safeParse({ variant: 'C' }).success).toBe(false);
  });
});
