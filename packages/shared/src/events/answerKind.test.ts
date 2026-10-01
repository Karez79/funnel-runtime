import { describe, expect, it } from 'vitest';
import { v1 } from '../../test/fixtures.ts';
import type { Step } from '../config/schema.ts';
import { answerKind, isAnswerKind } from './answerKind.ts';

const steps = v1().steps;
const step = (id: string): Step => {
  const s = steps[id];
  if (!s) throw new Error(`fixture has no ${id}`);
  return s;
};

describe('answerKind', () => {
  it('describes the shape of an answer, never its value', () => {
    expect(answerKind(step('work_mode'), 'remote')).toBe('single_select');
    expect(answerKind(step('priorities'), ['speed', 'focus'])).toBe('multi_select:2');
    expect(answerKind(step('team_size'), 12)).toBe('number');
  });

  it('is null for steps without answers', () => {
    expect(answerKind(step('intro'), undefined)).toBeNull();
    expect(answerKind(step('result'), 'x')).toBeNull();
  });

  it('counts zero for a non-array multi-select value', () => {
    expect(answerKind(step('priorities'), 'speed')).toBe('multi_select:0');
  });
});

describe('isAnswerKind', () => {
  it('accepts exactly what answerKind produces', () => {
    for (const id of ['work_mode', 'priorities', 'team_size']) {
      expect(isAnswerKind(answerKind(step(id), ['a', 'b']))).toBe(true);
    }
    for (const value of ['remote', 'multi_select:', 'multi_select:x', 'number ', 3, null]) {
      expect(isAnswerKind(value)).toBe(false);
    }
  });
});
