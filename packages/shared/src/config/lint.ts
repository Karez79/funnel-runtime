// Config lint (CLAUDE.md 4.7): what the schema cannot see, because it needs the whole
// config or the versions already stored. Errors block publishing; warnings are shown in
// the admin before publishing but do not block. Per-variant checks run on the resolved
// funnel, so a `visibleWhen` added or changed by a step override is checked as well.
import { DomainError } from '../api/errors.ts';
import { conditionLeaves } from '../engine/conditions.ts';
import { resolveFunnel, type ResolvedFunnel } from '../engine/resolve.ts';
import { BASE_EVENTS } from '../events/catalog.ts';
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

export type LintErrorCode =
  | 'schema_version'
  | 'funnel_id'
  | 'version_order'
  | 'missing_step'
  | 'duplicate_step'
  | 'result_position'
  | 'step_id_mismatch'
  | 'result_id_mismatch'
  | 'duplicate_answer_key'
  | 'condition_order'
  | 'unknown_operator'
  | 'unknown_result'
  | 'unknown_override'
  | 'invalid_override'
  | 'variant_weight'
  | 'missing_base_event';

export type LintWarningCode =
  'unknown_step_type' | 'unused_step' | 'unknown_answer' | 'operator_type';

export interface LintIssue<C extends string> {
  readonly code: C;
  readonly message: string;
}

export interface LintReport {
  readonly errors: LintIssue<LintErrorCode>[];
  readonly warnings: LintIssue<LintWarningCode>[];
}

export interface LintContext {
  /**
   * Versions already stored, without the one being linted. The server passes all
   * versions on upload, so a new version must be numbered above every existing one.
   */
  readonly existing?: readonly { readonly funnelId: string; readonly version: number }[];
}

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
  const answerOwners = new Map<string, string>();
  for (const [key, step] of Object.entries(config.steps)) {
    if (step.id !== key) out.error('step_id_mismatch', `step "${key}" has id "${step.id}"`);
    if (!isKnownStep(step)) {
      out.warn('unknown_step_type', `step "${key}" has unknown type "${step.type}"`);
    }
    if (!isInteractive(step)) continue;
    const owner = answerOwners.get(answerKey(step));
    if (owner !== undefined) {
      out.error(
        'duplicate_answer_key',
        `steps "${owner}" and "${key}" both store the answer "${answerKey(step)}"`,
      );
    }
    answerOwners.set(answerKey(step), key);
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

/** Every answer a step's `visibleWhen` reads must be given by an earlier step of the variant. */
function lintConditionOrder(resolved: ResolvedFunnel, out: Collector): void {
  const answered = new Set<string>();
  for (const id of resolved.sequence) {
    const step = resolved.steps[id];
    if (!step) continue;
    for (const leaf of step.visibleWhen ? conditionLeaves(step.visibleWhen) : []) {
      if (!answered.has(leaf.answer)) {
        out.error(
          'condition_order',
          `variant ${resolved.meta.variant}: step "${id}" shows on "${leaf.answer}", which is not answered before it`,
        );
      }
    }
    if (isInteractive(step)) answered.add(answerKey(step));
  }
}

function leafTypeProblem(leaf: ConditionLeaf, step: Step): string | null {
  const multi = step.type === 'multi-select';
  switch (leaf.operator) {
    case 'contains': {
      const values: unknown[] = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
      if (!multi) return 'contains needs a multi-select answer';
      if (values.length === 0 || values.some((v) => typeof v !== 'string')) {
        return 'contains needs a non-empty list of option values';
      }
      return null;
    }
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
      return multi ? `${leaf.operator} never matches a multi-select answer, use contains` : null;
    default:
      return null;
  }
}

function lintConditions(config: FunnelConfig, resolved: readonly ResolvedFunnel[], out: Collector) {
  const byAnswer = new Map<string, Step>();
  for (const step of Object.values(config.steps)) {
    if (isInteractive(step)) byAnswer.set(answerKey(step), step);
  }
  const conditions: { where: string; condition: Condition }[] = [];
  for (const r of resolved) {
    for (const id of r.sequence) {
      const when = r.steps[id]?.visibleWhen;
      if (when)
        conditions.push({ where: `step "${id}" (variant ${r.meta.variant})`, condition: when });
    }
  }
  for (const [i, rule] of config.resultRules.entries()) {
    conditions.push({ where: `resultRules[${String(i)}]`, condition: rule.when });
  }

  const operators: readonly string[] = KNOWN_OPERATORS;
  const reported = new Set<string>();
  const once = (message: string, report: () => void) => {
    if (reported.has(message)) return;
    reported.add(message);
    report();
  };
  for (const { where, condition } of conditions) {
    for (const leaf of conditionLeaves(condition)) {
      if (!operators.includes(leaf.operator)) {
        const message = `${where} uses unknown operator "${leaf.operator}"`;
        once(message, () => {
          out.error('unknown_operator', message);
        });
        continue;
      }
      const step = byAnswer.get(leaf.answer);
      if (!step) {
        const message = `${where} reads "${leaf.answer}", which no step asks`;
        // Visibility conditions are already errors (condition_order); rules only warn.
        if (where.startsWith('resultRules'))
          once(message, () => {
            out.warn('unknown_answer', message);
          });
        continue;
      }
      const problem = leafTypeProblem(leaf, step);
      if (problem) {
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
  for (const r of resolved) lintConditionOrder(r, out);
  lintConditions(config, resolved, out);
  return { errors: out.errors, warnings: out.warnings };
}
