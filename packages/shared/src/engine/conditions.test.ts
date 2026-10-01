import { describe, expect, it, vi } from 'vitest';
import type { Condition } from '../config/schema.ts';
import { conditionAnswers, evaluateCondition, type Answers } from './conditions.ts';

const answers: Answers = {
  work_mode: 'hybrid',
  team_size: 12,
  priorities: ['speed', 'focus'],
};

const leaf = (answer: string, operator: string, value?: unknown): Condition =>
  value === undefined ? { answer, operator } : { answer, operator, value };

const evalLeaf = (answer: string, operator: string, value?: unknown) =>
  evaluateCondition(leaf(answer, operator, value), answers);

describe('evaluateCondition: operators', () => {
  it('eq / ne', () => {
    expect(evalLeaf('work_mode', 'eq', 'hybrid')).toBe(true);
    expect(evalLeaf('work_mode', 'eq', 'remote')).toBe(false);
    expect(evalLeaf('team_size', 'eq', 12)).toBe(true);
    expect(evalLeaf('team_size', 'eq', '12')).toBe(false);
    expect(evalLeaf('work_mode', 'ne', 'remote')).toBe(true);
    expect(evalLeaf('work_mode', 'ne', 'hybrid')).toBe(false);
  });

  it('in / not_in', () => {
    expect(evalLeaf('work_mode', 'in', ['hybrid', 'office'])).toBe(true);
    expect(evalLeaf('work_mode', 'in', ['remote'])).toBe(false);
    expect(evalLeaf('work_mode', 'not_in', ['remote'])).toBe(true);
    expect(evalLeaf('work_mode', 'not_in', ['hybrid'])).toBe(false);
  });

  it('in / not_in with a non-array value is false', () => {
    expect(evalLeaf('work_mode', 'in', 'hybrid')).toBe(false);
    expect(evalLeaf('work_mode', 'not_in', 'remote')).toBe(false);
  });

  it('gt / gte / lt / lte compare numbers only', () => {
    expect(evalLeaf('team_size', 'gt', 11)).toBe(true);
    expect(evalLeaf('team_size', 'gt', 12)).toBe(false);
    expect(evalLeaf('team_size', 'gte', 12)).toBe(true);
    expect(evalLeaf('team_size', 'gte', 13)).toBe(false);
    expect(evalLeaf('team_size', 'lt', 13)).toBe(true);
    expect(evalLeaf('team_size', 'lt', 12)).toBe(false);
    expect(evalLeaf('team_size', 'lte', 12)).toBe(true);
    expect(evalLeaf('team_size', 'lte', 11)).toBe(false);
    expect(evalLeaf('work_mode', 'gt', 1)).toBe(false);
    expect(evalLeaf('team_size', 'gt', '1')).toBe(false);
  });

  it('contains checks multi-select arrays for one value or all of several', () => {
    expect(evalLeaf('priorities', 'contains', 'speed')).toBe(true);
    expect(evalLeaf('priorities', 'contains', 'cost')).toBe(false);
    expect(evalLeaf('priorities', 'contains', ['speed', 'focus'])).toBe(true);
    expect(evalLeaf('priorities', 'contains', ['speed', 'cost'])).toBe(false);
    expect(evalLeaf('work_mode', 'contains', 'hybrid')).toBe(false);
    expect(evalLeaf('priorities', 'contains', [])).toBe(false);
    expect(evalLeaf('priorities', 'contains', 1)).toBe(false);
  });

  it('exists is true for a present answer; value false asks for absence', () => {
    expect(evalLeaf('work_mode', 'exists')).toBe(true);
    expect(evalLeaf('work_mode', 'exists', true)).toBe(true);
    expect(evalLeaf('missing', 'exists')).toBe(false);
    expect(evalLeaf('missing', 'exists', false)).toBe(true);
    expect(evalLeaf('work_mode', 'exists', false)).toBe(false);
  });

  it('an empty multi-select is no answer', () => {
    const empty: Answers = { priorities: [] };
    expect(evaluateCondition(leaf('priorities', 'exists'), empty)).toBe(false);
    expect(evaluateCondition(leaf('priorities', 'exists', false), empty)).toBe(true);
    expect(evaluateCondition({ not: leaf('priorities', 'contains', 'speed') }, empty)).toBe(true);
  });

  it('single-value operators never match a multi-select answer', () => {
    for (const [op, value] of [
      ['eq', 'speed'],
      ['ne', 'speed'],
      ['in', ['speed']],
      ['not_in', ['cost']],
    ] as const) {
      expect(evalLeaf('priorities', op, value)).toBe(false);
    }
  });

  it('a missing answer makes every other operator false', () => {
    for (const op of ['eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains']) {
      expect(evalLeaf('missing', op, op.endsWith('in') ? ['x'] : 1)).toBe(false);
    }
  });

  it('an unknown operator is false and reported through the warn callback', () => {
    const warn = vi.fn();
    const cond = leaf('work_mode', 'matches', 'hy.*');
    expect(evaluateCondition(cond, answers, { warn })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('matches'));
  });

  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'an inherited name like %s is an unknown operator',
    (operator) => {
      const warn = vi.fn();
      expect(evaluateCondition(leaf('work_mode', operator, 'x'), answers, { warn })).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it('an inherited name is never an answer', () => {
    expect(evalLeaf('constructor', 'exists')).toBe(false);
    expect(evalLeaf('constructor', 'ne', 'x')).toBe(false);
    expect(evalLeaf('toString', 'exists', false)).toBe(true);
  });

  it('an unknown operator without a warn callback is still false', () => {
    expect(evalLeaf('work_mode', 'matches', 'x')).toBe(false);
  });
});

describe('evaluateCondition: groups', () => {
  const t = leaf('work_mode', 'eq', 'hybrid');
  const f = leaf('work_mode', 'eq', 'remote');

  it('all / any / not', () => {
    expect(evaluateCondition({ all: [t, t] }, answers)).toBe(true);
    expect(evaluateCondition({ all: [t, f] }, answers)).toBe(false);
    expect(evaluateCondition({ any: [f, t] }, answers)).toBe(true);
    expect(evaluateCondition({ any: [f, f] }, answers)).toBe(false);
    expect(evaluateCondition({ not: f }, answers)).toBe(true);
    expect(evaluateCondition({ not: t }, answers)).toBe(false);
  });

  it('empty all is true, empty any is false', () => {
    expect(evaluateCondition({ all: [] }, answers)).toBe(true);
    expect(evaluateCondition({ any: [] }, answers)).toBe(false);
  });

  it('not over a missing answer is true', () => {
    expect(evaluateCondition({ not: leaf('missing', 'eq', 'x') }, answers)).toBe(true);
  });

  it('nests', () => {
    const cond: Condition = { any: [{ all: [t, { not: f }] }, f] };
    expect(evaluateCondition(cond, answers)).toBe(true);
  });
});

describe('conditionAnswers', () => {
  it('collects every referenced answer key once, in order', () => {
    const cond: Condition = {
      all: [
        leaf('work_mode', 'eq', 'remote'),
        { not: { any: [leaf('timezone_span', 'in', ['wide']), leaf('work_mode', 'exists')] } },
      ],
    };
    expect(conditionAnswers(cond)).toEqual(['work_mode', 'timezone_span']);
  });
});
