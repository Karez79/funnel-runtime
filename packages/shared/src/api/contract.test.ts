import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { v1, v2 } from '../../test/fixtures.ts';
import { diffConfigs } from '../config/diff.ts';
import { lintConfig } from '../config/lint.ts';
import { resolveFunnel } from '../engine/resolve.ts';
import { contract, LIVE_STREAM, type RouteDef } from './contract.ts';

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
        state: {
          answers: { team_size: 4, priorities: ['speed'] },
          history: [],
          currentStepId: 'intro',
        },
        stateRev: 0,
        resultId: null,
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

describe('request schemas', () => {
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
