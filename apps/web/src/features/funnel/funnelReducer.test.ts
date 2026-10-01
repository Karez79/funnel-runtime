import { parseConfig, resolveFunnel, type VariantKey } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import v1Json from '../../../../../configs/funnel-v1.json' with { type: 'json' };
import {
  currentStep,
  funnelReducer,
  hasValue,
  initialState,
  progressOf,
  sessionState,
  stepError,
  transitionEvents,
  viewEvent,
  visiblePathOf,
  type FunnelAction,
  type FunnelState,
} from './funnelReducer.ts';

function funnel(variant: VariantKey = 'A') {
  const parsed = parseConfig(v1Json);
  if (!parsed.ok) throw new Error(parsed.issues.join('; '));
  return resolveFunnel(parsed.config, variant);
}

function start(variant: VariantKey = 'A'): FunnelState {
  return initialState(funnel(variant), { answers: {}, history: [], currentStepId: 'intro' });
}

function run(state: FunnelState, ...actions: FunnelAction[]): FunnelState {
  return actions.reduce(funnelReducer, state);
}

const answer = (value: string | number | string[]): FunnelAction[] => [
  { type: 'change', value },
  { type: 'continue' },
];

describe('funnelReducer', () => {
  it('walks variant A forward through valid answers only', () => {
    const s = run(start(), { type: 'continue' }, ...answer(14), ...answer('hybrid'));
    expect(s.currentStepId).toBe('priorities');
    expect(s.history).toEqual(['intro', 'team_size', 'work_mode']);
    expect(s.answers).toEqual({ team_size: 14, work_mode: 'hybrid' });
  });

  it('keeps an invalid draft out of the answers and shows the error after the attempt', () => {
    let s = run(start(), { type: 'continue' }, { type: 'change', value: 500 });
    expect(stepError(s)).toBeNull();
    s = run(s, { type: 'continue' });
    expect(s.currentStepId).toBe('team_size');
    expect(s.answers).toEqual({});
    expect(stepError(s)).toBe('For this demo, enter a value up to 200.');
    // Live once attempted: fixing the value clears the message without another Continue.
    s = run(s, { type: 'change', value: 20 });
    expect(stepError(s)).toBeNull();
    s = run(s, { type: 'change', value: undefined });
    expect(stepError(s)).toBe('Enter the team size.');
  });

  it('has no value for an empty multi-select and enables Continue once something is chosen', () => {
    let s = run(start(), { type: 'continue' }, ...answer(5), ...answer('remote'));
    expect(currentStep(s)?.id).toBe('priorities');
    expect(hasValue(s)).toBe(false);
    s = run(s, { type: 'change', value: [] });
    expect(hasValue(s)).toBe(false);
    s = run(s, { type: 'change', value: ['speed'] });
    expect(hasValue(s)).toBe(true);
    expect(hasValue(start())).toBe(true);
  });

  it('skips a step hidden by the answers and resumes the draft of a revisited step', () => {
    let s = run(start(), { type: 'continue' }, ...answer(5), ...answer('remote'));
    s = run(s, ...answer(['speed']), ...answer('global'));
    expect(s.currentStepId).toBe('async_maturity');
    s = run(s, { type: 'back' });
    expect(s.currentStepId).toBe('timezone_span');
    expect(s.draft).toBe('global');
    expect(s.history).toEqual(['intro', 'team_size', 'work_mode', 'priorities']);
  });

  it('goes back by history, deeper with `to`, and ignores unknown targets', () => {
    const s = run(start(), { type: 'continue' }, ...answer(5), ...answer('office'));
    expect(run(s, { type: 'back', to: 'team_size' })).toMatchObject({
      currentStepId: 'team_size',
      history: ['intro'],
      draft: 5,
    });
    expect(run(s, { type: 'back', to: 'office_days' })).toBe(s);
    expect(run(start(), { type: 'back' })).toEqual(start());
  });

  it('adopts a server state and drops the draft of the old step', () => {
    const s = run(start(), { type: 'continue' }, { type: 'change', value: 3 });
    const adopted = run(s, {
      type: 'adopt',
      state: { answers: { team_size: 9 }, history: ['intro'], currentStepId: 'team_size' },
    });
    expect(adopted).toMatchObject({ draft: 9, attempted: false, currentStepId: 'team_size' });
    expect(sessionState(adopted)).toEqual({
      answers: { team_size: 9 },
      history: ['intro'],
      currentStepId: 'team_size',
    });
  });

  it('keeps the answer of a step that became hidden', () => {
    let s = run(start(), { type: 'continue' }, ...answer(5), ...answer('hybrid'));
    s = run(s, ...answer(['speed']), ...answer('same'), ...answer(2));
    expect(s.answers.office_days).toBe(2);
    s = run(s, { type: 'back', to: 'work_mode' }, ...answer('remote'));
    expect(s.answers.office_days).toBe(2);
    expect(visiblePathOf(s)).not.toContain('office_days');
  });

  it('does not move past the last step', () => {
    const s = initialState(funnel(), { answers: {}, history: [], currentStepId: 'result' });
    expect(run(s, { type: 'continue' })).toBe(s);
  });
});

describe('progress', () => {
  it('counts visible questions and reacts to a valid draft before Continue', () => {
    let s = run(start(), { type: 'continue' }, ...answer(5));
    expect(currentStep(s)?.id).toBe('work_mode');
    // office_days is hidden until hybrid/office is chosen: 6 questions.
    expect(progressOf(s)).toEqual({ index: 2, total: 6 });
    s = run(s, { type: 'change', value: 'hybrid' });
    expect(progressOf(s)).toEqual({ index: 2, total: 7 });
    expect(visiblePathOf(s)).toContain('office_days');
    s = run(s, { type: 'change', value: 'remote' });
    expect(progressOf(s).total).toBe(6);
    expect(progressOf(start())).toEqual({ index: 0, total: 6 });
  });
});

describe('optional question', () => {
  function optional(): FunnelState {
    const base = funnel();
    const step = base.steps.team_size;
    if (!step) throw new Error('fixture: team_size is missing');
    const relaxed = { ...step, validation: { required: false } };
    return initialState(
      { ...base, steps: { ...base.steps, team_size: relaxed } },
      { answers: { team_size: 4 }, history: ['intro'], currentStepId: 'team_size' },
    );
  }

  it('cleared and continued drops the old answer and submits nothing', () => {
    const before = run(optional(), { type: 'change', value: undefined });
    const action: FunnelAction = { type: 'continue' };
    const after = funnelReducer(before, action);
    expect(after.currentStepId).toBe('work_mode');
    expect(after.answers).toEqual({});
    expect(transitionEvents(before, after, action)).toEqual([
      { name: 'step_completed', stepId: 'team_size', properties: { next_step_id: 'work_mode' } },
    ]);
  });
});

describe('events', () => {
  it('a question sends answer_submitted with the kind only and step_completed', () => {
    const before = run(start(), { type: 'continue' }, ...answer(5), ...answer('hybrid'), {
      type: 'change',
      value: ['speed', 'focus'],
    });
    const action: FunnelAction = { type: 'continue' };
    const after = funnelReducer(before, action);
    expect(transitionEvents(before, after, action)).toEqual([
      {
        name: 'answer_submitted',
        stepId: 'priorities',
        properties: { answer_kind: 'multi_select:2' },
      },
      {
        name: 'step_completed',
        stepId: 'priorities',
        properties: { next_step_id: 'timezone_span' },
      },
    ]);
  });

  it('an info step and a failed Continue send nothing', () => {
    const intro = start();
    const action: FunnelAction = { type: 'continue' };
    expect(transitionEvents(intro, funnelReducer(intro, action), action)).toEqual([]);
    const invalid = run(intro, action);
    expect(transitionEvents(invalid, funnelReducer(invalid, action), action)).toEqual([]);
  });

  it('back sends back_clicked from the step that was left', () => {
    const before = run(start(), { type: 'continue' });
    const action: FunnelAction = { type: 'back' };
    expect(transitionEvents(before, funnelReducer(before, action), action)).toEqual([
      { name: 'back_clicked', stepId: 'team_size', properties: { destination_step_id: 'intro' } },
    ]);
  });

  it('step_viewed carries the type and the place in the visible path', () => {
    const s = run(start('B'), { type: 'continue' });
    expect(viewEvent(s)).toEqual({
      name: 'step_viewed',
      stepId: 'work_mode',
      properties: { step_type: 'single-select', visible_step_index: 2, visible_step_count: 8 },
    });
  });
});
