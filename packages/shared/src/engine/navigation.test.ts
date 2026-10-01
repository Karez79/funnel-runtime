import { describe, expect, it } from 'vitest';
import { v1, v2 } from '../../test/fixtures.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers, nextStep, progress, stepBack, visiblePath } from './navigation.ts';
import { resolveFunnel } from './resolve.ts';

const a = resolveFunnel(v1(), 'A');
const remote: Answers = { team_size: 8, work_mode: 'remote', timezone_span: 'global' };
const hybrid: Answers = { team_size: 8, work_mode: 'hybrid', timezone_span: 'same' };

describe('visiblePath', () => {
  it('hides the conditional step for remote and shows it for hybrid', () => {
    expect(visiblePath(a, remote)).not.toContain('office_days');
    expect(visiblePath(a, hybrid)).toEqual(a.sequence);
  });

  it('hides a conditional step until the answer it depends on exists', () => {
    expect(visiblePath(a, {})).not.toContain('office_days');
  });

  it('follows the order of the variant', () => {
    const b = resolveFunnel(v1(), 'B');
    expect(visiblePath(b, hybrid).slice(0, 3)).toEqual(['intro', 'work_mode', 'timezone_span']);
  });

  it('treats the answer of a hidden step as missing for later conditions', () => {
    const config = v1();
    const toolCount = config.steps['tool_count'];
    if (!toolCount) throw new Error('fixture');
    toolCount.visibleWhen = { answer: 'office_days', operator: 'gte', value: 2 };
    const resolved = resolveFunnel(config, 'A');
    const stale = { ...remote, office_days: 3 };
    expect(visiblePath(resolved, { ...hybrid, office_days: 3 })).toContain('tool_count');
    expect(visiblePath(resolved, stale)).not.toContain('tool_count');
    expect(visiblePath(resolved, stale)).not.toContain('office_days');
  });
});

describe('effectiveAnswers', () => {
  it('drops answers of hidden steps but keeps the rest', () => {
    const answers = { ...remote, office_days: 3 };
    expect(effectiveAnswers(a, answers)).toEqual(remote);
    expect(effectiveAnswers(a, { ...hybrid, office_days: 3 })).toEqual({
      ...hybrid,
      office_days: 3,
    });
  });

  it('drops answers that belong to no step of the variant', () => {
    expect(effectiveAnswers(a, { ...remote, stray: 'x' })).toEqual(remote);
  });
});

describe('nextStep', () => {
  it('goes to the next visible step, skipping hidden ones', () => {
    expect(nextStep(a, remote, 'timezone_span')).toBe('async_maturity');
    expect(nextStep(a, hybrid, 'timezone_span')).toBe('office_days');
    expect(nextStep(a, remote, 'intro')).toBe('team_size');
  });

  it('returns null after the result and for an unknown step', () => {
    expect(nextStep(a, remote, 'result')).toBeNull();
    expect(nextStep(a, remote, 'ghost')).toBeNull();
  });

  it('continues from the sequence position when the current step became hidden', () => {
    expect(nextStep(a, remote, 'office_days')).toBe('async_maturity');
  });
});

describe('progress', () => {
  it('counts only visible interactive steps', () => {
    expect(progress(a, remote, 'intro')).toEqual({ index: 0, total: 6 });
    expect(progress(a, remote, 'team_size')).toEqual({ index: 1, total: 6 });
    expect(progress(a, remote, 'async_maturity')).toEqual({ index: 5, total: 6 });
    expect(progress(a, remote, 'result')).toEqual({ index: 6, total: 6 });
  });

  it('changes total when an answer opens a step', () => {
    expect(progress(a, hybrid, 'work_mode')).toEqual({ index: 2, total: 7 });
    expect(progress(a, remote, 'work_mode')).toEqual({ index: 2, total: 6 });
  });

  it('works for a version with more steps', () => {
    const v2a = resolveFunnel(v2(), 'A');
    expect(progress(v2a, hybrid, 'result')).toEqual({ index: 8, total: 8 });
  });

  it('does not count a step of an unknown type', () => {
    const config = v1();
    config.steps['slider'] = { id: 'slider', type: 'slider', content: {} };
    config.experiment.variants.A.stepSequence.splice(1, 0, 'slider');
    const resolved = resolveFunnel(config, 'A');
    expect(visiblePath(resolved, remote)).toContain('slider');
    expect(progress(resolved, remote, 'result')).toEqual({ index: 6, total: 6 });
  });
});

describe('stepBack', () => {
  it('pops the history stack, not the visible path', () => {
    expect(stepBack(['intro', 'team_size', 'work_mode'])).toEqual({
      stepId: 'work_mode',
      history: ['intro', 'team_size'],
    });
  });

  it('returns null on the first step', () => {
    expect(stepBack([])).toBeNull();
  });
});
