// Funnel state on the client (CLAUDE.md 3.1, 4.4, 8.1): a pure reducer over the resolved
// funnel that delegates every rule to the shared engine (visible path, next step, back
// stack, validation, progress). Only VALID answers enter `answers`, on Continue: the
// server validates every stored answer on save (DECISIONS.md), so in-progress input
// lives in `draft` until it passes. Errors appear after the first Continue attempt and
// then follow the input live (8.2). The events of a transition (7.5) are derived from
// the state before and after it by `transitionEvents`, so they need no side effects here.
import {
  answerKey,
  answerKind,
  isInteractive,
  nextStep,
  progress,
  stepBack,
  validateAnswer,
  visiblePath,
  type Answers,
  type AnswerValue,
  type EventProperties,
  type Progress,
  type ResolvedFunnel,
  type SessionState,
  type Step,
} from '@funnel/shared';

export interface FunnelState {
  readonly funnel: ResolvedFunnel;
  readonly answers: Answers;
  /** Steps visited before the current one; Back pops it (4.4). */
  readonly history: readonly string[];
  readonly currentStepId: string;
  /** Input of the current step that has not passed validation on Continue yet. */
  readonly draft: AnswerValue | undefined;
  /** Continue was tried on this step: validation messages are shown from now on. */
  readonly attempted: boolean;
}

export type FunnelAction =
  /** Take a state from the server (load, 409 conflict) or from the local mirror. */
  | { readonly type: 'adopt'; readonly state: SessionState }
  | { readonly type: 'change'; readonly value: AnswerValue | undefined }
  | { readonly type: 'continue' }
  /** Back one step, or to `to` deeper in the history (browser Back over several entries). */
  | { readonly type: 'back'; readonly to?: string };

export interface TrackedEvent {
  readonly name: string;
  readonly stepId: string | null;
  readonly properties: EventProperties;
}

function stepOf(state: Pick<FunnelState, 'funnel'>, id: string): Step | undefined {
  return state.funnel.steps[id];
}

function draftFor(
  funnel: ResolvedFunnel,
  answers: Answers,
  stepId: string,
): AnswerValue | undefined {
  const step = funnel.steps[stepId];
  return step && isInteractive(step) ? answers[answerKey(step)] : undefined;
}

export function initialState(funnel: ResolvedFunnel, saved: SessionState): FunnelState {
  return {
    funnel,
    answers: saved.answers,
    history: saved.history,
    currentStepId: saved.currentStepId,
    draft: draftFor(funnel, saved.answers, saved.currentStepId),
    attempted: false,
  };
}

function moveTo(state: FunnelState, answers: Answers, history: readonly string[], to: string) {
  return {
    ...state,
    answers,
    history,
    currentStepId: to,
    draft: draftFor(state.funnel, answers, to),
    attempted: false,
  };
}

function goForward(state: FunnelState): FunnelState {
  const step = stepOf(state, state.currentStepId);
  let answers = state.answers;
  if (step && isInteractive(step)) {
    if (!validateAnswer(step, state.draft).ok) return { ...state, attempted: true };
    const key = answerKey(step);
    // An optional question left empty moves on without an answer, and clears an old one.
    answers =
      state.draft === undefined
        ? Object.fromEntries(Object.entries(state.answers).filter(([k]) => k !== key))
        : { ...state.answers, [key]: state.draft };
  }
  const next = nextStep(state.funnel, answers, state.currentStepId);
  if (next === null) return state;
  return moveTo(state, answers, [...state.history, state.currentStepId], next);
}

function goBack(state: FunnelState, to: string | undefined): FunnelState {
  const back = stepBack(state.history, to);
  return back ? moveTo(state, state.answers, back.history, back.stepId) : state;
}

export function funnelReducer(state: FunnelState, action: FunnelAction): FunnelState {
  switch (action.type) {
    case 'adopt':
      return initialState(state.funnel, action.state);
    case 'change':
      return { ...state, draft: action.value };
    case 'continue':
      return goForward(state);
    case 'back':
      return goBack(state, action.to);
  }
}

// ---------- selectors ----------

export function currentStep(state: FunnelState): Step | undefined {
  return stepOf(state, state.currentStepId);
}

/** What the server stores (6.2): never the draft. */
export function sessionState(state: FunnelState): SessionState {
  return {
    answers: state.answers,
    history: [...state.history],
    currentStepId: state.currentStepId,
  };
}

/** The message to show under the current question, after a Continue attempt only. */
export function stepError(state: FunnelState): string | null {
  const step = currentStep(state);
  if (!state.attempted || !step || !isInteractive(step)) return null;
  const result = validateAnswer(step, state.draft);
  return result.ok ? null : result.message;
}

/** Continue is enabled once a question has some value; the validation still decides. */
export function hasValue(state: FunnelState): boolean {
  const step = currentStep(state);
  if (!step || !isInteractive(step)) return true;
  const { draft } = state;
  return draft !== undefined && !(Array.isArray(draft) && draft.length === 0);
}

/**
 * Answers including a valid draft: a choice that opens or hides later steps changes the
 * progress total right away, before Continue (8.2).
 */
function answersWithDraft(state: FunnelState): Answers {
  const step = currentStep(state);
  if (!step || !isInteractive(step) || state.draft === undefined) return state.answers;
  if (!validateAnswer(step, state.draft).ok) return state.answers;
  return { ...state.answers, [answerKey(step)]: state.draft };
}

export function progressOf(state: FunnelState): Progress {
  return progress(state.funnel, answersWithDraft(state), state.currentStepId);
}

export function visiblePathOf(state: FunnelState): string[] {
  return visiblePath(state.funnel, answersWithDraft(state));
}

/** `step_viewed` of the current step (7.5): its type and place in the visible path. */
export function viewEvent(state: FunnelState): TrackedEvent | null {
  const step = currentStep(state);
  if (!step) return null;
  const path = visiblePath(state.funnel, state.answers);
  return {
    name: 'step_viewed',
    stepId: step.id,
    properties: {
      step_type: step.type,
      visible_step_index: path.indexOf(step.id) + 1,
      visible_step_count: path.length,
    },
  };
}

/**
 * Events of one transition (7.5): a forward move from a question sends `answer_submitted`
 * (only the answer's kind, never its value) and `step_completed`; info and unknown steps
 * send nothing; a move back sends `back_clicked` from the step that was left.
 */
export function transitionEvents(
  before: FunnelState,
  after: FunnelState,
  action: FunnelAction,
): TrackedEvent[] {
  const from = before.currentStepId;
  if (after.currentStepId === from) return [];
  if (action.type === 'back') {
    return [
      {
        name: 'back_clicked',
        stepId: from,
        properties: { destination_step_id: after.currentStepId },
      },
    ];
  }
  if (action.type !== 'continue') return [];
  const step = currentStep(before);
  if (!step || !isInteractive(step)) return [];
  const completed: TrackedEvent = {
    name: 'step_completed',
    stepId: from,
    properties: { next_step_id: after.currentStepId },
  };
  // An optional question left empty submitted no answer.
  if (before.draft === undefined) return [completed];
  const kind = answerKind(step, before.draft);
  return [
    {
      name: 'answer_submitted',
      stepId: from,
      properties: kind === null ? {} : { answer_kind: kind },
    },
    completed,
  ];
}
