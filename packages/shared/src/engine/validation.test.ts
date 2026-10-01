import { describe, expect, it, vi } from 'vitest';
import { v1 } from '../../test/fixtures.ts';
import { isKnownStep, type Step } from '../config/schema.ts';
import type { Answers } from './conditions.ts';
import { resolveFunnel } from './resolve.ts';
import { validateAnswer, validateCompletion } from './validation.ts';

const config = v1();
const step = (id: string): Step => {
  const s = config.steps[id];
  if (!s) throw new Error(`fixture has no ${id}`);
  return s;
};
const known = (id: string) => {
  const s = step(id);
  if (!isKnownStep(s)) throw new Error(`${id} is not a known step`);
  return s;
};
const teamSize = known('team_size');
const workMode = known('work_mode');
const priorities = known('priorities');
if (teamSize.type !== 'number' || priorities.type !== 'multi-select') throw new Error('fixture');

describe('validateAnswer: number', () => {
  it('accepts a value in range', () => {
    expect(validateAnswer(teamSize, 12)).toEqual({ ok: true });
    expect(validateAnswer(teamSize, 1)).toEqual({ ok: true });
    expect(validateAnswer(teamSize, 200)).toEqual({ ok: true });
  });

  it('uses messages from the config', () => {
    expect(validateAnswer(teamSize, undefined)).toEqual({
      ok: false,
      code: 'required',
      message: 'Enter the team size.',
    });
    expect(validateAnswer(teamSize, 0)).toEqual({
      ok: false,
      code: 'min',
      message: 'The team must have at least one person.',
    });
    expect(validateAnswer(teamSize, 201)).toMatchObject({ ok: false, code: 'max' });
  });

  it('requires an integer when input.step is 1', () => {
    expect(validateAnswer(teamSize, 2.5)).toEqual({
      ok: false,
      code: 'integer',
      message: 'Enter a whole number.',
    });
  });

  it('allows fractions when input.step is not 1', () => {
    const halfSteps = { ...teamSize, input: { ...teamSize.input, step: 0.5 } };
    expect(validateAnswer(halfSteps, 2.5)).toEqual({ ok: true });
  });

  it('rejects a value of the wrong type or not finite', () => {
    expect(validateAnswer(teamSize, '12')).toMatchObject({ ok: false, code: 'invalidType' });
    expect(validateAnswer(teamSize, Number.NaN)).toMatchObject({ ok: false, code: 'invalidType' });
    expect(validateAnswer(teamSize, Infinity)).toMatchObject({ ok: false, code: 'invalidType' });
  });
});

describe('validateAnswer: single-select', () => {
  it('accepts an existing option', () => {
    expect(validateAnswer(workMode, 'hybrid')).toEqual({ ok: true });
  });

  it('rejects a missing value and an unknown option', () => {
    expect(validateAnswer(workMode, undefined)).toEqual({
      ok: false,
      code: 'required',
      message: "Select the team's main work mode.",
    });
    expect(validateAnswer(workMode, 'moon')).toEqual({
      ok: false,
      code: 'invalidOption',
      message: 'Choose one of the listed options.',
    });
    expect(validateAnswer(workMode, ['hybrid'])).toMatchObject({ ok: false, code: 'invalidType' });
  });
});

describe('validateAnswer: multi-select', () => {
  it('accepts between min and max selections', () => {
    expect(validateAnswer(priorities, ['speed'])).toEqual({ ok: true });
    expect(validateAnswer(priorities, ['speed', 'focus', 'cost'])).toEqual({ ok: true });
  });

  it('reports an empty selection as minSelections when a minimum is set', () => {
    for (const value of [undefined, []]) {
      expect(validateAnswer(priorities, value)).toEqual({
        ok: false,
        code: 'minSelections',
        message: 'Choose at least one priority.',
      });
    }
  });

  it('rejects too many selections, unknown and repeated options', () => {
    expect(validateAnswer(priorities, ['speed', 'focus', 'cost', 'culture'])).toEqual({
      ok: false,
      code: 'maxSelections',
      message: 'Choose no more than three priorities.',
    });
    expect(validateAnswer(priorities, ['speed', 'moon'])).toMatchObject({
      ok: false,
      code: 'invalidOption',
    });
    expect(validateAnswer(priorities, ['speed', 'speed'])).toMatchObject({
      ok: false,
      code: 'invalidOption',
    });
    expect(validateAnswer(priorities, 'speed')).toMatchObject({ ok: false, code: 'invalidType' });
  });
});

describe('validateAnswer: defaults and non-interactive steps', () => {
  it('falls back to default English messages', () => {
    const bare = { ...teamSize, validation: { required: true } };
    expect(validateAnswer(bare, undefined)).toMatchObject({ message: 'This field is required.' });
    expect(validateAnswer(bare, 0)).toMatchObject({ message: 'Enter a value of at least 1.' });
    expect(validateAnswer(bare, 500)).toMatchObject({ message: 'Enter a value of at most 200.' });
    const multi = { ...priorities, validation: { minSelections: 2, maxSelections: 2 } };
    expect(validateAnswer(multi, ['speed'])).toMatchObject({ message: 'Choose at least 2.' });
    expect(validateAnswer(multi, ['speed', 'focus', 'cost'])).toMatchObject({
      message: 'Choose no more than 2.',
    });
  });

  it('accepts no answer only when the step opts out with required: false', () => {
    const optional = { ...workMode, validation: { required: false } };
    expect(validateAnswer(optional, undefined)).toEqual({ ok: true });
    const optionalMulti = { ...priorities, validation: { required: false, minSelections: 1 } };
    expect(validateAnswer(optionalMulti, [])).toEqual({ ok: true });
    expect(validateAnswer(optionalMulti, undefined)).toEqual({ ok: true });
  });

  it('treats a step without a validation block as required', () => {
    const bareNumber: Step = { id: 'n', type: 'number', content: {}, input: { name: 'n' } };
    expect(validateAnswer(bareNumber, undefined)).toMatchObject({ ok: false, code: 'required' });
    const bareMulti = { ...priorities, validation: {} };
    expect(validateAnswer(bareMulti, [])).toMatchObject({ ok: false, code: 'required' });
  });

  it('an empty array is a wrong shape for number and single-select, required or not', () => {
    for (const s of [teamSize, workMode]) {
      expect(validateAnswer(s, [])).toMatchObject({ ok: false, code: 'invalidType' });
      const optional = { ...s, validation: { required: false } };
      expect(validateAnswer(optional, [])).toMatchObject({ ok: false, code: 'invalidType' });
    }
  });

  it('accepts anything for info, result and unknown steps', () => {
    expect(validateAnswer(step('intro'), undefined)).toEqual({ ok: true });
    expect(validateAnswer(step('result'), 'x')).toEqual({ ok: true });
    expect(validateAnswer({ id: 's', type: 'slider', content: {} }, 3)).toEqual({ ok: true });
  });
});

describe('validateCompletion', () => {
  const a = resolveFunnel(config, 'A');
  const complete: Answers = {
    team_size: 8,
    work_mode: 'remote',
    priorities: ['speed'],
    timezone_span: 'global',
    async_maturity: 'high',
    tool_count: 5,
  };

  it('is ok when every visible interactive step has a valid answer', () => {
    expect(validateCompletion(a, complete)).toEqual({ ok: true });
  });

  it('ignores a hidden step and its stale answer', () => {
    expect(validateCompletion(a, { ...complete, office_days: 99 })).toEqual({ ok: true });
  });

  it('passes the warn callback to visibility conditions', () => {
    const config = v1();
    const office = config.steps['office_days'];
    if (!office) throw new Error('fixture');
    office.visibleWhen = { answer: 'work_mode', operator: 'matches', value: 'x' };
    const warn = vi.fn();
    expect(validateCompletion(resolveFunnel(config, 'A'), complete, { warn })).toEqual({
      ok: true,
    });
    expect(warn).toHaveBeenCalled();
  });

  it('reports an unanswered step keyed by a built-in name as required', () => {
    const config = v1();
    const tools = config.steps['tool_count'];
    if (!tools || !isKnownStep(tools) || tools.type !== 'number') throw new Error('fixture');
    tools.input.name = 'constructor';
    const rest = Object.fromEntries(Object.entries(complete).filter(([k]) => k !== 'tool_count'));
    expect(validateCompletion(resolveFunnel(config, 'A'), rest)).toMatchObject({
      ok: false,
      stepId: 'tool_count',
      code: 'required',
    });
  });

  it('names the first visible step that is missing or invalid', () => {
    expect(validateCompletion(a, { ...complete, work_mode: 'hybrid' })).toMatchObject({
      ok: false,
      stepId: 'office_days',
      code: 'required',
    });
    expect(validateCompletion(a, { ...complete, team_size: 0 })).toMatchObject({
      ok: false,
      stepId: 'team_size',
      code: 'min',
    });
  });
});
