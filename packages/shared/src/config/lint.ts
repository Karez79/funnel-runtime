// Config lint (CLAUDE.md 4.7): what the schema cannot see, because it needs the whole
// config or the versions already stored. Errors block publishing; warnings are shown in
// the admin before publishing but do not block. Per-variant checks run on the resolved
// funnel, so a `visibleWhen` added or changed by a step override is checked as well.
import { z } from 'zod';
import { DomainError } from '../api/errors.ts';
import { conditionLeaves } from '../engine/conditions.ts';
import { resolveFunnel, type ResolvedFunnel } from '../engine/resolve.ts';
import { BASE_EVENTS } from '../events/catalog.ts';
import { diffConfigs, type ChangeKind } from './diff.ts';
import {
  answerKey,
  isInteractive,
  isKnownStep,
  KNOWN_OPERATORS,
  VARIANTS,
  type Condition,
  type ConditionLeaf,
  type FunnelConfig,
  type Step,
} from './schema.ts';

const LINT_ERROR_CODES = [
  'schema_version',
  'funnel_id',
  'version_order',
  'missing_step',
  'duplicate_step',
  'result_position',
  'step_id_mismatch',
  'result_id_mismatch',
  'duplicate_answer_key',
  'condition_order',
  'unknown_operator',
  'unknown_result',
  'unknown_override',
  'invalid_override',
  'variant_weight',
  'missing_base_event',
  'privacy',
] as const;
export type LintErrorCode = (typeof LINT_ERROR_CODES)[number];

const LINT_WARNING_CODES = [
  'unknown_step_type',
  'unused_step',
  'unknown_answer',
  'operator_type',
  'config_change',
] as const;
export type LintWarningCode = (typeof LINT_WARNING_CODES)[number];

/** Also the wire shape returned by upload and diff (6.1). */
export const LintReportSchema = z.object({
  errors: z.array(z.object({ code: z.enum(LINT_ERROR_CODES), message: z.string() })),
  warnings: z.array(z.object({ code: z.enum(LINT_WARNING_CODES), message: z.string() })),
});
export type LintReport = z.infer<typeof LintReportSchema>;
type LintIssue<C extends string> = { code: C; message: string };

export interface LintContext {
  /**
   * Versions already stored. Passed on upload only: a new version must be numbered above
   * every stored one. On publish the draft was already checked on upload, and drafts
   * uploaded after it must not block it, so the server lints without `existing` there.
   */
  readonly existing?: readonly { readonly funnelId: string; readonly version: number }[];
  /** The active version: changes against it that deserve a second look become warnings. */
  readonly previous?: FunnelConfig;
}

/** Changes that are allowed but change what users see or what analytics can compare. */
const WARN_ON_CHANGE: ReadonlySet<ChangeKind> = new Set([
  'step_removed',
  'result_added',
  'result_removed',
  'event_added',
  'event_removed',
  'event_changed',
  'privacy_changed',
]);

const SUPPORTED_SCHEMA_MAJOR = '1';

class Collector {
  readonly errors: LintIssue<LintErrorCode>[] = [];
  readonly warnings: LintIssue<LintWarningCode>[] = [];
  error(code: LintErrorCode, message: string): void {
    this.errors.push({ code, message });
  }
  warn(code: LintWarningCode, message: string): void {
    this.warnings.push({ code, message });
  }
}

function lintVersioning(config: FunnelConfig, context: LintContext, out: Collector): void {
  const major = config.schemaVersion.split('.')[0];
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    out.error(
      'schema_version',
      `schemaVersion ${config.schemaVersion} is not supported (expected ${SUPPORTED_SCHEMA_MAJOR}.x)`,
    );
  }
  const existing = context.existing ?? [];
  const funnelIds = new Set(existing.map((v) => v.funnelId));
  if (funnelIds.size > 0 && !funnelIds.has(config.funnelId)) {
    out.error('funnel_id', `funnelId "${config.funnelId}" does not match existing versions`);
  }
  const latest = Math.max(
    0,
    ...existing.filter((v) => v.funnelId === config.funnelId).map((v) => v.version),
  );
  if (config.version <= latest) {
    out.error('version_order', `version ${String(config.version)} must be above ${String(latest)}`);
  }
}

function lintDefinitions(config: FunnelConfig, out: Collector): void {
  for (const [key, step] of Object.entries(config.steps)) {
    if (step.id !== key) out.error('step_id_mismatch', `step "${key}" has id "${step.id}"`);
    if (!isKnownStep(step)) {
      out.warn('unknown_step_type', `step "${key}" has unknown type "${step.type}"`);
    }
  }
  for (const [key, result] of Object.entries(config.results)) {
    if (result.id !== key) out.error('result_id_mismatch', `result "${key}" has id "${result.id}"`);
  }
  for (const [i, rule] of config.resultRules.entries()) {
    if (!(rule.resultId in config.results)) {
      out.error(
        'unknown_result',
        `resultRules[${String(i)}] points to unknown result "${rule.resultId}"`,
      );
    }
  }
  if (!(config.defaultResultId in config.results)) {
    out.error('unknown_result', `defaultResultId "${config.defaultResultId}" does not exist`);
  }
  if (config.events.privacy.storeRawAnswers) {
    out.error(
      'privacy',
      'events.privacy.storeRawAnswers must be false: raw answers never go into events',
    );
  }
  const catalog = new Set(config.events.allowed.map((e) => e.name));
  const missing = BASE_EVENTS.filter((name) => !catalog.has(name));
  if (missing.length > 0) {
    out.error('missing_base_event', `events.allowed lacks base events: ${missing.join(', ')}`);
  }
  const used = new Set(VARIANTS.flatMap((v) => config.experiment.variants[v].stepSequence));
  for (const key of Object.keys(config.steps)) {
    if (!used.has(key)) out.warn('unused_step', `step "${key}" is in no variant's sequence`);
  }
}

function lintSequence(config: FunnelConfig, variant: (typeof VARIANTS)[number], out: Collector) {
  const { stepSequence, weight, stepOverrides, resultOverrides } =
    config.experiment.variants[variant];
  if (!(weight > 0)) out.error('variant_weight', `variant ${variant} has weight ${String(weight)}`);
  for (const key of Object.keys(stepOverrides)) {
    if (!(key in config.steps)) {
      out.error('unknown_override', `variant ${variant} overrides unknown step "${key}"`);
    }
  }
  for (const key of Object.keys(resultOverrides)) {
    if (!(key in config.results)) {
      out.error('unknown_override', `variant ${variant} overrides unknown result "${key}"`);
    }
  }
  const seen = new Set<string>();
  for (const id of stepSequence) {
    if (seen.has(id)) out.error('duplicate_step', `variant ${variant} lists "${id}" twice`);
    seen.add(id);
    if (!(id in config.steps)) {
      out.error('missing_step', `variant ${variant} uses unknown step "${id}"`);
    }
  }
  const resultSteps = stepSequence.filter((id) => config.steps[id]?.type === 'result');
  const last = stepSequence.at(-1);
  if (resultSteps.length !== 1 || last === undefined || resultSteps[0] !== last) {
    out.error(
      'result_position',
      `variant ${variant} must end with exactly one step of type "result"`,
    );
  }
}

/** Steps of a resolved variant that store answers, by answer key. */
function answerSteps(resolved: ResolvedFunnel): Map<string, Step> {
  const byAnswer = new Map<string, Step>();
  for (const id of resolved.sequence) {
    const step = resolved.steps[id];
    if (step && isInteractive(step) && !byAnswer.has(answerKey(step))) {
      byAnswer.set(answerKey(step), step);
    }
  }
  return byAnswer;
}

/**
 * Per resolved variant (overrides included; a session only ever sees one variant):
 * every answer a `visibleWhen` reads is given by an earlier step, and no two steps
 * store the same answer key, which would silently overwrite one answer with another.
 */
function lintVariantAnswers(resolved: ResolvedFunnel, out: Collector): void {
  const variant = resolved.meta.variant;
  const answered = new Map<string, string>();
  for (const id of resolved.sequence) {
    const step = resolved.steps[id];
    if (!step) continue;
    for (const leaf of step.visibleWhen ? conditionLeaves(step.visibleWhen) : []) {
      if (!answered.has(leaf.answer)) {
        out.error(
          'condition_order',
          `variant ${variant}: step "${id}" shows on "${leaf.answer}", which is not answered before it`,
        );
      }
    }
    if (!isInteractive(step)) continue;
    const key = answerKey(step);
    const owner = answered.get(key);
    if (owner !== undefined) {
      out.error(
        'duplicate_answer_key',
        `variant ${variant}: steps "${owner}" and "${id}" both store the answer "${key}"`,
      );
    }
    answered.set(key, id);
  }
}

/** Values a leaf compares the answer with (`in` lists are spread). */
function comparedValues(leaf: ConditionLeaf): unknown[] {
  return Array.isArray(leaf.value) ? leaf.value : [leaf.value];
}

function leafTypeProblem(leaf: ConditionLeaf, step: Step): string | null {
  if (!isInteractive(step)) return null;
  const values = comparedValues(leaf);
  switch (leaf.operator) {
    case 'contains':
      if (step.type !== 'multi-select') return 'contains needs a multi-select answer';
      if (values.length === 0) return 'contains needs at least one option value';
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return step.type === 'number' && typeof leaf.value === 'number'
        ? null
        : `${leaf.operator} needs a number answer and a number value`;
    case 'eq':
    case 'ne':
    case 'in':
    case 'not_in':
      if (step.type === 'multi-select') {
        return `${leaf.operator} never matches a multi-select answer, use contains`;
      }
      if ((leaf.operator === 'in' || leaf.operator === 'not_in') && !Array.isArray(leaf.value)) {
        return `${leaf.operator} needs a list of values`;
      }
      break;
    default:
      return null;
  }
  if (step.type === 'number') {
    return values.every((v) => typeof v === 'number')
      ? null
      : 'compares a number with a non-number';
  }
  const options = new Set(step.input.options.map((o) => o.value));
  const unknown = values.filter((v) => typeof v !== 'string' || !options.has(v));
  return unknown.length === 0
    ? null
    : `${unknown.map((v) => JSON.stringify(v)).join(', ')} is not an option`;
}

function lintConditions(config: FunnelConfig, resolved: readonly ResolvedFunnel[], out: Collector) {
  // A visibility condition is checked against its own variant. A result rule runs in every
  // variant, so it is checked against each variant that asks the answer and flagged only
  // when it cannot match in any of them (B may add an option that A does not have).
  const perVariant = resolved.map(answerSteps);
  const conditions: { where: string; condition: Condition; sources: Map<string, Step>[] }[] = [];
  resolved.forEach((r, i) => {
    const sources = perVariant.slice(i, i + 1);
    for (const id of r.sequence) {
      const when = r.steps[id]?.visibleWhen;
      if (when) {
        conditions.push({
          where: `step "${id}" (variant ${r.meta.variant})`,
          condition: when,
          sources,
        });
      }
    }
  });
  for (const [i, rule] of config.resultRules.entries()) {
    conditions.push({
      where: `resultRules[${String(i)}]`,
      condition: rule.when,
      sources: perVariant,
    });
  }

  const operators: readonly string[] = KNOWN_OPERATORS;
  const reported = new Set<string>();
  const once = (message: string, report: () => void) => {
    if (reported.has(message)) return;
    reported.add(message);
    report();
  };
  for (const { where, condition, sources } of conditions) {
    for (const leaf of conditionLeaves(condition)) {
      if (!operators.includes(leaf.operator)) {
        const message = `${where} uses unknown operator "${leaf.operator}"`;
        once(message, () => {
          out.error('unknown_operator', message);
        });
        continue;
      }
      const steps = sources.flatMap((byAnswer) => byAnswer.get(leaf.answer) ?? []);
      if (steps.length === 0) {
        const message = `${where} reads "${leaf.answer}", which no step asks`;
        // Visibility conditions are already errors (condition_order); rules only warn.
        if (where.startsWith('resultRules')) {
          once(message, () => {
            out.warn('unknown_answer', message);
          });
        }
        continue;
      }
      const problems = steps.map((step) => leafTypeProblem(leaf, step));
      const [problem] = problems;
      if (problem && problems.every((p) => p !== null)) {
        const message = `${where}: ${problem} ("${leaf.answer}")`;
        once(message, () => {
          out.warn('operator_type', message);
        });
      }
    }
  }
}

export function lintConfig(config: FunnelConfig, context: LintContext = {}): LintReport {
  const out = new Collector();
  lintVersioning(config, context, out);
  lintDefinitions(config, out);

  const resolved: ResolvedFunnel[] = [];
  for (const variant of VARIANTS) {
    const before = out.errors.length;
    lintSequence(config, variant, out);
    if (out.errors.length > before) continue;
    try {
      resolved.push(resolveFunnel(config, variant));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      out.error('invalid_override', `variant ${variant}: ${error.message}`);
    }
  }
  for (const r of resolved) lintVariantAnswers(r, out);
  lintConditions(config, resolved, out);
  if (context.previous && resolved.length === VARIANTS.length) {
    for (const change of diffConfigs(context.previous, config)) {
      if (WARN_ON_CHANGE.has(change.kind)) out.warn('config_change', change.message);
    }
  }
  return { errors: out.errors, warnings: out.warnings };
}
