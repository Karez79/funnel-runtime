// One synthetic visitor walking the funnel (CLAUDE.md 9.1) through the public API, the
// way the web client does: the server creates the session and picks the variant, the
// state is saved on every move, the result comes from `complete`, events carry an id and
// a `client_seq`. Where to go next, what counts as a valid answer, the progress numbers
// and the expected result all come from the shared engine; nothing here restates a rule.
//
// Personas are synthetic test data for this funnel (answer keys of its configs), not
// product content: a preferred value is used only if the version has that step and the
// value is valid there, otherwise the answer is random. Together with random personas
// this walks every branch of every version without knowing which steps a version has.
import {
  answerKey,
  answerKind,
  computeResult,
  isInteractive,
  nextStep,
  progress,
  stepBack,
  validateAnswer,
  type AnswerValue,
  type ClientEvent,
  type InteractiveStep,
  type ResolvedFunnel,
  type SessionResponse,
  type SessionState,
  type VariantKey,
} from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import type { Copy, Delivery, Outgoing } from './delivery.ts';
import type { Client } from './http.ts';
import { chance, int, pick, shuffle, type Rng } from './random.ts';

export interface Utm {
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
}

export interface Persona {
  readonly name: string;
  readonly weight: number;
  readonly answers: Readonly<Record<string, AnswerValue>>;
}

export const PERSONAS: readonly Persona[] = [
  { name: 'remote, global', weight: 2, answers: { work_mode: 'remote', timezone_span: 'global' } },
  {
    name: 'remote, same zone',
    weight: 2,
    answers: {
      work_mode: 'remote',
      timezone_span: 'same',
      async_maturity: 'low',
      meeting_hours: 6,
    },
  },
  {
    name: 'hybrid',
    weight: 2,
    answers: { work_mode: 'hybrid', async_maturity: 'medium', meeting_hours: 10 },
  },
  {
    name: 'office',
    weight: 1.5,
    answers: { work_mode: 'office', async_maturity: 'medium', meeting_hours: 8 },
  },
  { name: 'high async maturity', weight: 1.5, answers: { async_maturity: 'high' } },
  { name: 'meeting heavy', weight: 1, answers: { meeting_hours: 25 } },
  { name: 'random', weight: 2, answers: {} },
];

/**
 * The synthetic effect of the experiment (README, EXPERIMENT.md): B asks easy questions
 * first, so fewer visitors leave on the first two questions, and its result converts
 * better. The numbers are invented; the dashboard only has to show them faithfully.
 */
const BEHAVIOUR = {
  dropOnInfo: 0.03,
  dropEarly: { A: 0.12, B: 0.03 },
  dropLater: 0.06,
  earlyQuestions: 2,
  cta: { A: 0.38, B: 0.62 },
  backChance: 0.45,
  copySame: 0.075,
  copyNext: 0.075,
} as const;

export interface Plan {
  readonly index: number;
  readonly rng: Rng;
  readonly persona: Persona;
  readonly utm: Utm | null;
  readonly override: VariantKey | null;
  /** Events reach the server in a shuffled order (9.1). */
  readonly shuffled: boolean;
  /** How many times the visitor goes back. */
  readonly backs: number;
  /** One event claims the other variant (context_mismatch). */
  readonly mismatch: boolean;
  /** Before publishing the next version: stop after this many answers, finish later. */
  readonly pauseAfter: number | null;
}

export interface Visitor {
  readonly plan: Plan;
  readonly id: string;
  readonly version: number;
  readonly experimentId: string;
  readonly variant: VariantKey;
  readonly funnelId: string;
  /** Server time of creation, from the answer's Date header. */
  readonly createdAt: string;
  funnel: ResolvedFunnel;
  state: SessionState;
  rev: number;
  seq: number;
  backsLeft: number;
  mismatchLeft: boolean;
  answered: number;
  readonly seen: Set<string>;
  buffer: Outgoing[];
  /** Computed by the engine; the server's answer must agree. */
  resultId: string | null;
  outcome: 'paused' | 'dropped' | 'result' | null;
  /** Came back after the next version was published. */
  resumed: boolean;
}

export interface Context {
  readonly call: Client;
  readonly delivery: Delivery;
  readonly funnelId: string;
  readonly onDate: (date: Date) => void;
}

function answerFor(step: InteractiveStep, persona: Persona, rng: Rng): AnswerValue {
  const preferred = persona.answers[answerKey(step)];
  if (preferred !== undefined && validateAnswer(step, preferred).ok) return preferred;
  let value: AnswerValue;
  if (step.type === 'single-select') {
    value = pick(rng, step.input.options).value;
  } else if (step.type === 'multi-select') {
    const options = step.input.options.map((o) => o.value);
    const min = Math.max(1, step.validation?.minSelections ?? 1);
    const max = Math.min(options.length, step.validation?.maxSelections ?? options.length);
    value = shuffle(rng, options).slice(0, int(rng, min, max));
  } else {
    // Small numbers are more common than large ones (team sizes, hours, tools).
    const min = step.input.min ?? 0;
    const max = step.input.max ?? min + 100;
    value = min + Math.floor((max - min + 1) * rng() ** 2);
  }
  const valid = validateAnswer(step, value);
  if (!valid.ok) throw new Error(`generator made an invalid answer for ${step.id}: ${valid.code}`);
  return value;
}

function emit(
  visitor: Visitor,
  name: string,
  stepId: string | null,
  properties: ClientEvent['properties'],
): Outgoing {
  const { plan } = visitor;
  visitor.seq += 1;
  const mismatch = visitor.mismatchLeft && name === 'step_viewed';
  if (mismatch) visitor.mismatchLeft = false;
  const claimed: VariantKey = mismatch ? (visitor.variant === 'A' ? 'B' : 'A') : visitor.variant;
  const roll = plan.rng();
  const copy: Copy =
    roll < BEHAVIOUR.copySame
      ? 'same'
      : roll < BEHAVIOUR.copySame + BEHAVIOUR.copyNext
        ? 'next'
        : 'none';
  return {
    event: {
      event_id: uuidv7(),
      session_id: visitor.id,
      name,
      client_timestamp: new Date().toISOString(),
      client_seq: visitor.seq,
      funnel_id: visitor.funnelId,
      funnel_version: visitor.version,
      experiment_id: visitor.experimentId,
      variant: claimed,
      step_id: stepId,
      ...(plan.utm
        ? {
            utm_source: plan.utm.source,
            utm_medium: plan.utm.medium,
            utm_campaign: plan.utm.campaign,
          }
        : {}),
      properties,
    },
    copy,
    mismatch,
  };
}

async function track(
  ctx: Context,
  visitor: Visitor,
  name: string,
  stepId: string | null,
  properties: ClientEvent['properties'],
): Promise<void> {
  // Like the web client, only events of the session's own catalog are sent (8.4).
  if (!visitor.funnel.eventCatalog.some((e) => e.name === name)) return;
  const outgoing = emit(visitor, name, stepId, properties);
  if (visitor.plan.shuffled) visitor.buffer.push(outgoing);
  else await ctx.delivery.enqueue([outgoing]);
}

/** Shuffled sessions release their events in one burst when they stop. */
async function release(ctx: Context, visitor: Visitor): Promise<void> {
  if (visitor.buffer.length === 0) return;
  const events = shuffle(visitor.plan.rng, visitor.buffer);
  visitor.buffer = [];
  await ctx.delivery.enqueue(events);
}

async function save(ctx: Context, visitor: Visitor): Promise<void> {
  const { data, date } = await ctx.call('saveState', {
    params: { id: visitor.id },
    body: { state: visitor.state, baseRev: visitor.rev },
  });
  ctx.onDate(date);
  visitor.rev = data.stateRev;
}

function adopt(visitor: Visitor, response: SessionResponse): void {
  visitor.funnel = response.funnel;
  visitor.state = response.session.state;
  visitor.rev = response.session.stateRev;
}

export async function startVisitor(ctx: Context, plan: Plan): Promise<Visitor> {
  const { data, date } = await ctx.call('createSession', {
    body: {
      funnelId: ctx.funnelId,
      utm: plan.utm ?? {},
      trafficType: 'synthetic',
      ...(plan.override ? { variantOverride: plan.override } : {}),
    },
  });
  ctx.onDate(date);
  const { session, funnel } = data;
  return {
    plan,
    id: session.id,
    version: session.funnelVersion,
    experimentId: session.experimentId,
    variant: session.variant,
    funnelId: funnel.meta.funnelId,
    createdAt: date.toISOString(),
    funnel,
    state: session.state,
    rev: session.stateRev,
    seq: 0,
    backsLeft: plan.backs,
    mismatchLeft: plan.mismatch,
    answered: 0,
    seen: new Set(),
    buffer: [],
    resultId: null,
    outcome: null,
    resumed: false,
  };
}

/** A paused visitor comes back: the server answers with the PINNED version (6.2). */
export async function resumeVisitor(ctx: Context, visitor: Visitor): Promise<void> {
  const { data, date } = await ctx.call('getSession', { params: { id: visitor.id } });
  ctx.onDate(date);
  if (data.session.funnelVersion !== visitor.version) {
    throw new Error(
      `session ${visitor.id} moved from v${String(visitor.version)} to v${String(data.session.funnelVersion)}`,
    );
  }
  adopt(visitor, data);
  visitor.resumed = true;
}

async function finish(ctx: Context, visitor: Visitor, stepId: string): Promise<void> {
  const { plan } = visitor;
  const expected = computeResult(visitor.funnel, visitor.state.answers);
  const { data, date } = await ctx.call('completeSession', { params: { id: visitor.id } });
  ctx.onDate(date);
  if (data.resultId !== expected) {
    throw new Error(`session ${visitor.id}: server result ${data.resultId}, engine ${expected}`);
  }
  visitor.resultId = expected;
  await track(ctx, visitor, 'result_viewed', stepId, { result_id: expected });
  if (chance(plan.rng, BEHAVIOUR.cta[visitor.variant])) {
    await track(ctx, visitor, 'cta_clicked', stepId, {
      result_id: expected,
      action: data.result.cta.action,
    });
  }
  visitor.outcome = 'result';
}

/**
 * Walks from the current step until the result, a drop-off, or the pause point. A
 * resumed visitor (`mayDrop: false`) always finishes: it came back to finish.
 */
export async function walk(ctx: Context, visitor: Visitor, mayDrop = true): Promise<void> {
  const { plan } = visitor;
  for (;;) {
    const { state, funnel } = visitor;
    const stepId = state.currentStepId;
    const step = funnel.steps[stepId];
    if (!step) throw new Error(`session ${visitor.id}: step ${stepId} is not in its funnel`);
    const shown = progress(funnel, state.answers, stepId);
    await track(ctx, visitor, 'step_viewed', stepId, {
      step_type: step.type,
      visible_step_index: shown.index,
      visible_step_count: shown.total,
    });
    if (step.type === 'result') {
      await finish(ctx, visitor, stepId);
      break;
    }
    const firstVisit = !visitor.seen.has(stepId);
    visitor.seen.add(stepId);
    if (plan.pauseAfter !== null && mayDrop && visitor.answered >= plan.pauseAfter) {
      visitor.outcome = 'paused';
      break;
    }
    if (mayDrop && firstVisit && chance(plan.rng, dropChance(visitor, isInteractive(step)))) {
      visitor.outcome = 'dropped';
      break;
    }
    const back = stepBack(state.history);
    if (
      back &&
      isInteractive(step) &&
      visitor.answered > 0 &&
      visitor.backsLeft > 0 &&
      chance(plan.rng, BEHAVIOUR.backChance)
    ) {
      visitor.backsLeft -= 1;
      await track(ctx, visitor, 'back_clicked', stepId, { destination_step_id: back.stepId });
      visitor.state = { ...state, currentStepId: back.stepId, history: back.history };
      await save(ctx, visitor);
      continue;
    }
    let answers = state.answers;
    if (isInteractive(step)) {
      const value = answerFor(step, plan.persona, plan.rng);
      answers = { ...answers, [answerKey(step)]: value };
      await track(ctx, visitor, 'answer_submitted', stepId, {
        answer_kind: answerKind(step, value),
      });
      visitor.answered += 1;
    }
    const next = nextStep(funnel, answers, stepId);
    if (next === null) throw new Error(`session ${visitor.id}: no step after ${stepId}`);
    if (isInteractive(step))
      await track(ctx, visitor, 'step_completed', stepId, { next_step_id: next });
    visitor.state = { answers, history: [...state.history, stepId], currentStepId: next };
    await save(ctx, visitor);
  }
  await release(ctx, visitor);
}

function dropChance(visitor: Visitor, question: boolean): number {
  if (!question) return BEHAVIOUR.dropOnInfo;
  return visitor.answered < BEHAVIOUR.earlyQuestions
    ? BEHAVIOUR.dropEarly[visitor.variant]
    : BEHAVIOUR.dropLater;
}
