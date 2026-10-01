import { describe, expect, it } from 'vitest';
import { v1, v2 } from '../../test/fixtures.ts';
import { DomainError } from '../api/errors.ts';
import { isInteractive } from '../config/schema.ts';
import { ResolvedFunnelSchema, resolveFunnel } from './resolve.ts';

describe('resolveFunnel', () => {
  it('uses the step order of the requested variant', () => {
    const config = v1();
    expect(resolveFunnel(config, 'A').sequence).toEqual(config.experiment.variants.A.stepSequence);
    expect(resolveFunnel(config, 'B').sequence).toEqual([
      'intro',
      'work_mode',
      'timezone_span',
      'team_size',
      'async_maturity',
      'priorities',
      'office_days',
      'tool_count',
      'result',
    ]);
  });

  it('contains only the steps of its sequence', () => {
    const resolved = resolveFunnel(v2(), 'A');
    expect(Object.keys(resolved.steps).sort()).toEqual([...resolved.sequence].sort());
  });

  it('deep-merges step overrides and keeps the fields they do not mention', () => {
    const config = v1();
    const a = resolveFunnel(config, 'A').steps['intro'];
    const b = resolveFunnel(config, 'B').steps['intro'];
    expect(a?.content.title).toBe('Build a work model your team can actually follow');
    expect(b?.content.title).toBe('How should your team really work?');
    expect(b?.type).toBe('info');

    const priorities = resolveFunnel(config, 'B').steps['priorities'];
    expect(priorities?.content.helperText).toBe('Choose up to three outcomes.');
    expect(priorities && isInteractive(priorities) && priorities.input.options).toHaveLength(5);
  });

  it('merges a partial nested override key by key', () => {
    const config = v1();
    config.experiment.variants.B.stepOverrides['priorities'] = { content: { title: 'X' } };
    config.experiment.variants.B.resultOverrides['balanced'] = { cta: { label: 'L' } };
    const resolved = resolveFunnel(config, 'B');
    expect(resolved.steps['priorities']?.content).toEqual({
      title: 'X',
      helperText: 'Choose between one and three priorities.',
    });
    expect(resolved.results['balanced']?.cta).toEqual({
      label: 'L',
      action: 'expand_recommendation',
    });
  });

  it.each([
    ['step id', 'stepOverrides', 'priorities', { id: 'ghost' }],
    ['step type', 'stepOverrides', 'priorities', { type: 'single-select' }],
    ['result id', 'resultOverrides', 'balanced', { id: 'other' }],
  ] as const)('rejects an override of the %s', (_name, kind, key, patch) => {
    const config = v1();
    config.experiment.variants.B[kind][key] = patch;
    expect(() => resolveFunnel(config, 'B')).toThrow(/cannot change/);
  });

  it('produces a value that matches its own wire schema', () => {
    const resolved = resolveFunnel(v1(), 'B');
    expect(ResolvedFunnelSchema.parse(resolved)).toEqual(resolved);
  });

  it('deep-merges result overrides', () => {
    const config = v1();
    const a = resolveFunnel(config, 'A').results['async_native'];
    const b = resolveFunnel(config, 'B').results['async_native'];
    expect(a?.title).toBe('Async-native');
    expect(b?.title).toBe('Your team is ready to reduce meetings');
    expect(b?.cta).toEqual({
      label: 'See the 30-day action list',
      action: 'expand_recommendation',
    });
    expect(b?.summary).toBe(a?.summary);
  });

  it('replaces arrays instead of merging them', () => {
    const config = v1();
    config.experiment.variants.B.resultOverrides['balanced'] = { recommendations: ['Only one.'] };
    expect(resolveFunnel(config, 'B').results['balanced']?.recommendations).toEqual(['Only one.']);
  });

  it('does not mutate the config', () => {
    const config = v1();
    const before = structuredClone(config);
    resolveFunnel(config, 'B');
    expect(config).toEqual(before);
  });

  it('carries the event catalog, result rules and meta of the version', () => {
    const config = v2();
    const resolved = resolveFunnel(config, 'B');
    expect(resolved.eventCatalog.map((e) => e.name)).toContain('cta_clicked');
    expect(resolved.resultRules).toEqual(config.resultRules);
    expect(resolved.defaultResultId).toBe('balanced');
    expect(resolved.meta).toMatchObject({
      funnelId: 'workstyle-planner',
      version: 2,
      experimentId: config.experiment.id,
      variant: 'B',
      progressExcludeTypes: ['info', 'result'],
    });
  });

  it('throws a domain error for a sequence step that does not exist', () => {
    const config = v1();
    config.experiment.variants.A.stepSequence.splice(1, 0, 'ghost');
    expect(() => resolveFunnel(config, 'A')).toThrow(DomainError);
    expect(() => resolveFunnel(config, 'A')).toThrow(/ghost/);
  });

  it('throws a domain error when an override breaks the step schema', () => {
    const config = v1();
    config.experiment.variants.B.stepOverrides['work_mode'] = { input: { options: 'none' } };
    expect(() => resolveFunnel(config, 'B')).toThrow(/work_mode/);
  });
});
