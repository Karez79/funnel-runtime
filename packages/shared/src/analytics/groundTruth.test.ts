import { describe, expect, it } from 'vitest';
import { v1 } from '../../test/fixtures.ts';
import { resolveFunnel } from '../engine/resolve.ts';
import { aggregate, type AggregateInput } from './aggregate.ts';
import { compareSummaries, GroundTruthSchema } from './groundTruth.ts';
import { AnalyticsFiltersSchema, type AnalyticsSummary } from './summary.ts';

const funnels = { A: resolveFunnel(v1(), 'A'), B: resolveFunnel(v1(), 'B') };

function summary(patch: Partial<AggregateInput> = {}): AnalyticsSummary {
  return aggregate({
    sessions: [
      {
        id: 's1',
        version: 1,
        variant: 'A',
        trafficType: 'synthetic',
        utmSource: 'linkedin',
        utmCampaign: 'spring_launch',
        resultId: 'balanced',
        createdAt: '2026-10-01T12:00:00.000Z',
      },
    ],
    events: [
      {
        eventId: 'e0',
        sessionId: 's1',
        name: 'session_started',
        stepId: null,
        serverTs: '2026-10-01T12:00:00.000Z',
        properties: {},
      },
      {
        eventId: 'e1',
        sessionId: 's1',
        name: 'result_viewed',
        stepId: 'result',
        serverTs: '2026-10-01T12:00:01.000Z',
        properties: { result_id: 'balanced' },
      },
    ],
    versions: [{ version: 1, active: true, funnels }],
    ingest: { duplicates: 2, rejected: [{ reason: 'unknown_event', count: 1 }] },
    filters: AnalyticsFiltersSchema.parse({}),
    now: new Date('2026-10-01T13:00:00.000Z'),
    ...patch,
  });
}

describe('compareSummaries', () => {
  it('finds no difference between equal summaries', () => {
    expect(compareSummaries(summary(), summary())).toEqual([]);
  });

  it('lists every differing field with its path and both values', () => {
    const expected = summary();
    const actual = summary({ ingest: { duplicates: 3, rejected: [] } });
    expect(compareSummaries(expected, actual)).toEqual([
      'dataQuality.duplicates: expected 2, got 3',
      'dataQuality.rejected: expected 1 items, got 0',
    ]);
  });

  it('tolerates floating point noise in rates but not real differences', () => {
    const expected = summary();
    const noisy = structuredClone(expected);
    noisy.kpis.all.resultRate = 1 - 1e-12;
    expect(compareSummaries(expected, noisy)).toEqual([]);
    noisy.kpis.all.resultRate = 0.5;
    expect(compareSummaries(expected, noisy)).toEqual(['kpis.all.resultRate: expected 1, got 0.5']);
  });

  it('reports a value that is null on one side', () => {
    const expected = summary();
    const actual = structuredClone(expected);
    actual.kpis.all.ctaCtr = null;
    expect(compareSummaries(expected, actual)).toEqual(['kpis.all.ctaCtr: expected 0, got null']);
  });

  it('ignores the match flag, the active flag and versions published after the run', () => {
    const expected = summary();
    const actual = structuredClone(expected);
    actual.groundTruthMatches = true;
    const [first] = actual.versions;
    if (!first) throw new Error('fixture has version 1');
    actual.versions = [
      { ...first, active: false },
      { version: 2, active: true, kpis: first.kpis },
    ];
    expect(compareSummaries(expected, actual)).toEqual([]);
  });

  it('reports a version the run knew about that the server lost', () => {
    const expected = summary();
    const actual = structuredClone(expected);
    actual.versions = [];
    expect(compareSummaries(expected, actual)).toEqual(['versions[v1]: missing']);
  });

  it('reports a field present on one side only', () => {
    const expected = summary();
    const actual: Record<string, unknown> = { ...structuredClone(expected) };
    delete actual.daily;
    expect(compareSummaries(expected, actual)).toEqual([
      'daily: expected [1 items], got undefined',
    ]);
  });
});

describe('GroundTruthSchema', () => {
  it('accepts a generator file with a summary per check', () => {
    const file = {
      generatedAt: '2026-10-01T12:00:00.000Z',
      seed: 42,
      sessions: 120,
      checks: [{ name: 'v1', query: { version: '1' }, expected: summary() }],
    };
    expect(GroundTruthSchema.parse(file)).toEqual(file);
  });

  it('rejects a file without checks', () => {
    const file = { generatedAt: '2026-10-01T12:00:00.000Z', seed: 1, sessions: 1, checks: [] };
    expect(GroundTruthSchema.safeParse(file).success).toBe(false);
  });
});
