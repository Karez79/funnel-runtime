// The funnel aggregator (CLAUDE.md 11.2): one pure function from session and event rows
// to the dashboard summary. The server feeds it rows from SQLite, the generator feeds it
// its own journal of intentions to produce the ground truth, and `verify` compares the
// two, so the definition of every metric lives here and nowhere else.
//
// The unit is the unique session. Each session is folded into a profile of sets (steps
// reached, steps completed, flags), so duplicates and the arrival order of events cannot
// change any number. Version, variant and UTM always come from the session row, never
// from an event. Time is a parameter (`now`), which keeps the function pure.
import { DomainError } from '../api/errors.ts';
import type { TRAFFIC_TYPES } from '../api/domain.ts';
import { answerKey, isInteractive, VARIANTS, type VariantKey } from '../config/schema.ts';
import { conditionAnswers } from '../engine/conditions.ts';
import type { ResolvedFunnel } from '../engine/resolve.ts';
import { BASE_EVENTS } from '../events/catalog.ts';
import type { REJECT_REASONS } from '../events/schema.ts';
import { describeCondition } from './condition.ts';
import { compareProportions, isSignificant, requiredPerVariant, wilsonInterval } from './stats.ts';
import type { AnalyticsFilters, AnalyticsSummary } from './summary.ts';

/**
 * A live session without a result counts as dropped only after this much inactivity;
 * until then it is "in progress". Synthetic and QA sessions are final at once.
 */
export const IN_PROGRESS_WINDOW_MS = 30 * 60 * 1000;

export interface AnalyticsSession {
  readonly id: string;
  readonly version: number;
  readonly variant: VariantKey;
  readonly trafficType: (typeof TRAFFIC_TYPES)[number];
  readonly utmSource: string | null;
  readonly utmCampaign: string | null;
  /** Computed and stored by the server on complete (6.3); never taken from an event. */
  readonly resultId: string | null;
  /** ISO timestamp. */
  readonly createdAt: string;
}

export interface AnalyticsEvent {
  /** Flags are counted per distinct event, so a repeated row cannot inflate them. */
  readonly eventId: string;
  readonly sessionId: string;
  readonly name: string;
  readonly stepId: string | null;
  /** ISO timestamp of receipt; drives "in progress" and nothing else. */
  readonly serverTs: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly outOfOrder?: boolean;
  readonly contextMismatch?: boolean;
}

export interface AnalyticsVersion {
  readonly version: number;
  readonly active: boolean;
  readonly funnels: Readonly<Record<VariantKey, ResolvedFunnel>>;
}

/** Ingest-level counts that belong to no session (CLAUDE.md 11.2, data quality). */
export interface IngestQuality {
  readonly duplicates: number;
  readonly rejected: readonly { reason: (typeof REJECT_REASONS)[number]; count: number }[];
}

export interface AggregateInput {
  readonly sessions: readonly AnalyticsSession[];
  readonly events: readonly AnalyticsEvent[];
  readonly versions: readonly AnalyticsVersion[];
  readonly ingest: IngestQuality;
  readonly filters: AnalyticsFilters;
  readonly now: Date;
}

type Summary = AnalyticsSummary;
type Kpis = Summary['kpis']['all'];
type StepMetrics = Summary['steps'][number]['metrics']['all'];

/** Steps that count as "reached" when an event names them (implied reach). */
const REACH_EVENTS = new Set(['step_viewed', 'answer_submitted', 'step_completed']);
const RESULT_EVENTS = new Set(['result_viewed', 'cta_clicked']);
const BASE = new Set<string>(BASE_EVENTS);

interface Profile {
  readonly session: AnalyticsSession;
  /** The session's own variant sequence: indexes are positions in it. */
  readonly sequence: readonly string[];
  readonly reached: Set<string>;
  readonly stepCompleted: Set<string>;
  readonly cameBackTo: Set<string>;
  readonly names: Set<string>;
  started: boolean;
  reachedResult: boolean;
  clickedCta: boolean;
  backed: boolean;
  lastSeen: number;
  readonly outOfOrder: Set<string>;
  readonly contextMismatch: Set<string>;
}

const rate = (part: number, whole: number) => (whole === 0 ? null : part / whole);
const stringProp = (event: AnalyticsEvent, key: string) => {
  const value = Object.hasOwn(event.properties, key) ? event.properties[key] : undefined;
  return typeof value === 'string' ? value : null;
};

function newProfile(session: AnalyticsSession, sequence: readonly string[]): Profile {
  return {
    session,
    sequence,
    reached: new Set(),
    stepCompleted: new Set(),
    cameBackTo: new Set(),
    names: new Set(),
    started: false,
    reachedResult: false,
    clickedCta: false,
    backed: false,
    lastSeen: Date.parse(session.createdAt),
    outOfOrder: new Set(),
    contextMismatch: new Set(),
  };
}

function fold(profile: Profile, event: AnalyticsEvent): void {
  profile.names.add(event.name);
  profile.lastSeen = Math.max(profile.lastSeen, Date.parse(event.serverTs));
  if (event.outOfOrder) profile.outOfOrder.add(event.eventId);
  if (event.contextMismatch) profile.contextMismatch.add(event.eventId);
  if (event.name === 'session_started') profile.started = true;
  if (event.stepId !== null && REACH_EVENTS.has(event.name)) profile.reached.add(event.stepId);
  if (event.stepId !== null && event.name === 'step_completed') {
    profile.stepCompleted.add(event.stepId);
  }
  if (RESULT_EVENTS.has(event.name)) {
    profile.reachedResult = true;
  }
  if (event.name === 'cta_clicked') profile.clickedCta = true;
  if (event.name === 'back_clicked') {
    profile.backed = true;
    const destination = stringProp(event, 'destination_step_id');
    if (destination !== null) profile.cameBackTo.add(destination);
  }
}

/** Position of the furthest step reached in the session's own sequence (-1: none). */
function furthestIndex(profile: Profile): number {
  if (profile.reachedResult) return profile.sequence.length - 1;
  let furthest = -1;
  profile.sequence.forEach((id, index) => {
    if (profile.reached.has(id)) furthest = index;
  });
  return furthest;
}

const isResultStep = (profile: Profile, stepId: string) => profile.sequence.at(-1) === stepId;

function reachedStep(profile: Profile, stepId: string): boolean {
  return isResultStep(profile, stepId) ? profile.reachedResult : profile.reached.has(stepId);
}

/** Reached and then left forward: `step_completed` or any later step reached. */
function completedStep(profile: Profile, stepId: string): boolean {
  if (!reachedStep(profile, stepId)) return false;
  if (isResultStep(profile, stepId) || profile.stepCompleted.has(stepId)) return true;
  return furthestIndex(profile) > profile.sequence.indexOf(stepId);
}

/** Final = cannot come back as "in progress": not live, or inactive past the window. */
function isFinal(profile: Profile, now: number): boolean {
  return profile.session.trafficType !== 'live' || now - profile.lastSeen > IN_PROGRESS_WINDOW_MS;
}

/** Where a finished session without a result left. */
function droppedAt(profile: Profile, now: number): string | null {
  if (profile.reachedResult || !isFinal(profile, now)) return null;
  return profile.sequence[furthestIndex(profile)] ?? null;
}

function kpis(profiles: readonly Profile[], now: number): Kpis {
  const started = profiles.length;
  const reachedResult = profiles.filter((p) => p.reachedResult).length;
  const clickedCta = profiles.filter((p) => p.clickedCta).length;
  const inProgress = profiles.filter((p) => !p.reachedResult && !isFinal(p, now)).length;
  return {
    started,
    reachedResult,
    clickedCta,
    inProgress,
    resultRate: rate(reachedResult, started),
    ctaCtr: rate(clickedCta, reachedResult),
    startedToCta: rate(clickedCta, started),
    backUsage: rate(profiles.filter((p) => p.backed).length, started),
  };
}

function stepMetrics(profiles: readonly Profile[], stepId: string, now: number): StepMetrics {
  const reached = profiles.filter((p) => reachedStep(p, stepId));
  const completed = reached.filter((p) => completedStep(p, stepId)).length;
  return {
    reached: reached.length,
    completed,
    passRate: rate(completed, reached.length),
    droppedHere: profiles.filter((p) => droppedAt(p, now) === stepId).length,
    cameBack: profiles.filter((p) => p.cameBackTo.has(stepId)).length,
  };
}

/** Per-variant value, null for variants outside the filter. */
function byVariant<T>(
  variants: readonly VariantKey[],
  profiles: readonly Profile[],
  compute: (subset: readonly Profile[], variant: VariantKey | 'all') => T | null,
): { A: T | null; B: T | null; all: T } {
  const pick = (variant: VariantKey) =>
    variants.includes(variant)
      ? compute(
          profiles.filter((p) => p.session.variant === variant),
          variant,
        )
      : null;
  const all = compute(profiles, 'all');
  if (all === null) throw new DomainError('internal', 'aggregate: "all" has no value');
  return { A: pick('A'), B: pick('B'), all };
}

function inPeriod(session: AnalyticsSession, filters: AnalyticsFilters): boolean {
  const created = Date.parse(session.createdAt);
  if (filters.from !== undefined && created < Date.parse(filters.from)) return false;
  return filters.to === undefined || created <= Date.parse(filters.to);
}

/** Every filter except version, variant and source (those are applied per section). */
function matchesBase(session: AnalyticsSession, filters: AnalyticsFilters): boolean {
  if (session.trafficType === 'qa' && !filters.includeQa) return false;
  if (filters.campaign !== undefined && session.utmCampaign !== filters.campaign) return false;
  return inPeriod(session, filters);
}

function stepOrder(funnels: AnalyticsVersion['funnels'], variants: readonly VariantKey[]) {
  const order: string[] = [];
  for (const variant of variants) {
    for (const id of funnels[variant].sequence) if (!order.includes(id)) order.push(id);
  }
  return order;
}

function verdict(summary: Pick<Summary['experiment'], 'A' | 'B' | 'diffPoints' | 'pValue'>) {
  const { A, B, diffPoints, pValue } = summary;
  if (A.sessions === 0 || B.sessions === 0 || diffPoints === null) {
    return 'Not enough data yet: both variants need sessions.';
  }
  if (diffPoints === 0 || pValue === null) return 'No difference between A and B yet.';
  const leader = diffPoints > 0 ? 'B' : 'A';
  const points = Math.abs(diffPoints).toFixed(1);
  const p = pValue < 0.001 ? 'p < 0.001' : `p = ${pValue.toFixed(3)}`;
  if (isSignificant(pValue))
    return `${leader} is ahead by ${points} points, and the difference is significant (${p}).`;
  return `${leader} is ahead by ${points} points, but the difference is not significant yet (${p}).`;
}

function experiment(profiles: readonly Profile[]): Summary['experiment'] {
  const proportion = (variant: VariantKey) => {
    const subset = profiles.filter((p) => p.session.variant === variant);
    const conversions = subset.filter((p) => p.clickedCta).length;
    return {
      sessions: subset.length,
      conversions,
      rate: rate(conversions, subset.length),
      ci: wilsonInterval(conversions, subset.length),
    };
  };
  const A = proportion('A');
  const B = proportion('B');
  const { diffPoints, pValue } = compareProportions(
    { sessions: A.sessions, conversions: A.conversions },
    { sessions: B.sessions, conversions: B.conversions },
  );
  const required = A.rate === null || B.rate === null ? null : requiredPerVariant(A.rate, B.rate);
  return {
    metric: 'started_to_cta',
    A,
    B,
    diffPoints,
    pValue,
    requiredPerVariant: required,
    verdict: verdict({ A, B, diffPoints, pValue }),
  };
}

function branches(
  funnels: AnalyticsVersion['funnels'],
  order: readonly string[],
  profiles: readonly Profile[],
): Summary['branches'] {
  const steps = { ...funnels.B.steps, ...funnels.A.steps };
  const result: Summary['branches'] = [];
  for (const stepId of order) {
    const condition = steps[stepId]?.visibleWhen;
    if (!condition) continue;
    const keys = conditionAnswers(condition);
    const parentStepId = order.find((id) => {
      const step = steps[id];
      return step !== undefined && isInteractive(step) && keys.includes(answerKey(step));
    });
    if (parentStepId === undefined) continue;
    // Only sessions whose variant has both steps can split between them.
    const parents = profiles.filter(
      (p) =>
        p.sequence.includes(stepId) &&
        p.sequence.includes(parentStepId) &&
        reachedStep(p, parentStepId),
    );
    const seen = parents.filter((p) => reachedStep(p, stepId)).length;
    result.push({
      stepId,
      parentStepId,
      seen,
      parentReached: parents.length,
      share: rate(seen, parents.length),
    });
  }
  return result;
}

function daily(profiles: readonly Profile[]): Summary['daily'] {
  const counts = new Map<string, number>();
  for (const p of profiles) {
    const date = new Date(p.session.createdAt).toISOString().slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const dates = [...counts.keys()].sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined) return [];
  const result: Summary['daily'] = [];
  const DAY = 24 * 60 * 60 * 1000;
  for (let t = Date.parse(first); t <= Date.parse(last); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    result.push({ date, started: counts.get(date) ?? 0 });
  }
  return result;
}

function sources(profiles: readonly Profile[]): Summary['sources'] {
  const counts = new Map<string | null, number>();
  for (const p of profiles) {
    counts.set(p.session.utmSource, (counts.get(p.session.utmSource) ?? 0) + 1);
  }
  return [...counts]
    .map(([source, sessions]) => ({ source, sessions }))
    .sort(
      (x, y) =>
        y.sessions - x.sessions ||
        (x.source === null ? 1 : 0) - (y.source === null ? 1 : 0) ||
        (x.source ?? '').localeCompare(y.source ?? ''),
    );
}

export function aggregate(input: AggregateInput): Summary {
  const { filters } = input;
  const now = input.now.getTime();
  const variants: readonly VariantKey[] = filters.variant === 'all' ? VARIANTS : [filters.variant];
  const versionNumber = filters.version ?? input.versions.find((v) => v.active)?.version;
  const selected = input.versions.find((v) => v.version === versionNumber);
  if (versionNumber === undefined || !selected) {
    throw new DomainError('not_found', `Version ${String(versionNumber ?? 'active')} not found`);
  }
  const funnelsByVersion = new Map(input.versions.map((v) => [v.version, v.funnels]));

  // Profiles of every session that passes the base filters, in any version.
  const profiles = new Map<string, Profile>();
  for (const session of input.sessions) {
    const funnels = funnelsByVersion.get(session.version);
    if (!funnels || !matchesBase(session, filters)) continue;
    profiles.set(session.id, newProfile(session, funnels[session.variant].sequence));
  }
  for (const event of input.events) {
    const profile = profiles.get(event.sessionId);
    if (profile) fold(profile, event);
  }
  // Started = has the server's `session_started`; anything else is not a session start.
  const started = [...profiles.values()].filter((p) => p.started);
  // A session is created when the funnel renders its first step, so a started session
  // with no step event at all reached that step (implied reach) and left there.
  for (const p of started) {
    const first = p.sequence[0];
    if (first !== undefined && p.reached.size === 0 && !p.reachedResult) p.reached.add(first);
  }
  const inSource = (p: Profile) =>
    filters.source === undefined || p.session.utmSource === filters.source;
  const inVariant = (p: Profile) => variants.includes(p.session.variant);

  const versionAll = started.filter((p) => p.session.version === selected.version);
  const versionSourced = versionAll.filter(inSource);
  const scope = versionSourced.filter(inVariant);

  const { funnels } = selected;
  const order = stepOrder(funnels, variants);
  const allSteps = { ...funnels.B.steps, ...funnels.A.steps };
  const steps = order.map((stepId) => {
    const step = allSteps[stepId];
    const visibleWhen = step?.visibleWhen;
    return {
      stepId,
      type: step?.type ?? 'unknown',
      condition: visibleWhen ? describeCondition(visibleWhen) : null,
      metrics: byVariant(variants, scope, (subset, variant) =>
        variant !== 'all' && !funnels[variant].sequence.includes(stepId)
          ? null
          : stepMetrics(
              subset.filter((p) => p.sequence.includes(stepId)),
              stepId,
              now,
            ),
      ),
    };
  });

  const results = Object.keys(funnels.A.results).map((resultId) => ({
    resultId,
    sessions: byVariant(
      variants,
      scope,
      (subset) => subset.filter((p) => p.reachedResult && p.session.resultId === resultId).length,
    ),
  }));

  const clicked = scope.filter((p) => p.clickedCta);
  const otherEvents = funnels.A.eventCatalog
    .filter((definition) => !BASE.has(definition.name))
    .map(({ name }) => ({
      name,
      sessions: scope.filter((p) => p.names.has(name)).length,
      shareOfCta: rate(clicked.filter((p) => p.names.has(name)).length, clicked.length),
    }));

  const versions = [...input.versions]
    .sort((x, y) => x.version - y.version)
    .map((v) => ({
      version: v.version,
      active: v.active,
      kpis: kpis(
        started.filter((p) => p.session.version === v.version && inSource(p) && inVariant(p)),
        now,
      ),
    }));

  const sum = (pick: (p: Profile) => number) => scope.reduce((total, p) => total + pick(p), 0);

  return {
    funnelId: funnels.A.meta.funnelId,
    version: selected.version,
    experimentId: funnels.A.meta.experimentId,
    kpis: byVariant(variants, scope, (subset) => kpis(subset, now)),
    sequences: { A: [...funnels.A.sequence], B: [...funnels.B.sequence] },
    steps,
    results,
    branches: branches(funnels, order, scope),
    // A/B always compares both variants of the version, whatever the variant filter.
    experiment: experiment(versionSourced),
    versions,
    otherEvents,
    dataQuality: {
      duplicates: input.ingest.duplicates,
      outOfOrder: sum((p) => p.outOfOrder.size),
      contextMismatch: sum((p) => p.contextMismatch.size),
      rejected: input.ingest.rejected.map(({ reason, count }) => ({ reason, count })),
    },
    daily: daily(scope),
    // The source notch filters by source, so it lists every source of the selection.
    sources: sources(versionAll.filter(inVariant)),
    groundTruthMatches: null,
  };
}
