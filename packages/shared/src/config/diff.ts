// Human-readable difference between two config versions (CLAUDE.md 4.7), shown in the
// admin before publishing. Steps and results are compared per variant on the resolved
// funnels, because that is what users of each variant actually see (an override can
// change a text in B only). Lint turns the risky kinds of change into warnings, so the
// list of changes is defined here once.
import { conditionAnswers } from '../engine/conditions.ts';
import type { ResultRule } from './schema.ts';
import { resolveFunnel, type ResolvedFunnel } from '../engine/resolve.ts';
import { VARIANTS, type FunnelConfig, type VariantKey } from './schema.ts';

export type ChangeKind =
  | 'experiment_changed'
  | 'weight_changed'
  | 'step_added'
  | 'step_removed'
  | 'step_order'
  | 'step_changed'
  | 'condition_changed'
  | 'result_added'
  | 'result_removed'
  | 'result_changed'
  | 'rule_added'
  | 'rule_removed'
  | 'rule_changed'
  | 'rule_order'
  | 'default_result_changed'
  | 'event_added'
  | 'event_removed'
  | 'event_changed'
  | 'privacy_changed'
  | 'config_changed';

export interface ConfigChange {
  readonly kind: ChangeKind;
  readonly variant?: VariantKey;
  /** Step, result, event or rule the change is about. */
  readonly subject: string;
  readonly message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Dotted paths whose values differ, descending into objects `depth` levels deep. */
function changedPaths(a: unknown, b: unknown, depth: number, prefix = ''): string[] {
  if (same(a, b)) return [];
  if (depth === 0 || !isPlainObject(a) || !isPlainObject(b)) return [prefix || '(value)'];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.flatMap((key) =>
    changedPaths(a[key], b[key], depth - 1, prefix ? `${prefix}.${key}` : key),
  );
}

function omit(value: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function diffVariant(a: ResolvedFunnel, b: ResolvedFunnel, out: ConfigChange[]): void {
  const variant = b.meta.variant;
  const before = new Set(a.sequence);
  const after = new Set(b.sequence);
  const push = (kind: ChangeKind, subject: string, message: string) =>
    out.push({ kind, variant, subject, message: `Variant ${variant}: ${message}` });

  for (const id of b.sequence) {
    if (!before.has(id)) push('step_added', id, `step "${id}" added`);
  }
  for (const id of a.sequence) {
    if (!after.has(id)) push('step_removed', id, `step "${id}" removed`);
  }
  const keptBefore = a.sequence.filter((id) => after.has(id));
  const keptAfter = b.sequence.filter((id) => before.has(id));
  if (!same(keptBefore, keptAfter)) {
    push('step_order', 'sequence', `step order changed to ${keptAfter.join(' → ')}`);
  }

  for (const id of keptAfter) {
    const stepA = a.steps[id];
    const stepB = b.steps[id];
    if (!stepA || !stepB) continue;
    const paths = changedPaths(omit(stepA, ['visibleWhen']), omit(stepB, ['visibleWhen']), 2);
    if (paths.length > 0) push('step_changed', id, `step "${id}": ${paths.join(', ')} changed`);
    if (!same(stepA.visibleWhen, stepB.visibleWhen)) {
      const on = stepB.visibleWhen ? conditionAnswers(stepB.visibleWhen) : [];
      const now = on.length > 0 ? `now depends on ${on.join(', ')}` : 'now always shown';
      push('condition_changed', id, `step "${id}": visibility condition changed, ${now}`);
    }
  }

  for (const [id, resultB] of Object.entries(b.results)) {
    const resultA = a.results[id];
    if (!resultA) continue;
    const paths = changedPaths(resultA, resultB, 2);
    if (paths.length > 0) push('result_changed', id, `result "${id}": ${paths.join(', ')} changed`);
  }
}

const dependsOn = (rule: ResultRule) => conditionAnswers(rule.when).join(', ') || 'nothing';

function diffRules(a: FunnelConfig, b: FunnelConfig, out: ConfigChange[]): void {
  const keysA = a.resultRules.map((r) => JSON.stringify(r));
  const keysB = b.resultRules.map((r) => JSON.stringify(r));
  const added = b.resultRules.flatMap((rule, i) =>
    keysA.includes(keysB[i] ?? '') ? [] : [{ rule, number: i + 1 }],
  );
  const removed = a.resultRules.flatMap((rule, i) =>
    keysB.includes(keysA[i] ?? '') ? [] : [{ rule, number: i + 1 }],
  );
  // A rule for the same result that left and came back is an edit, not two unrelated lines.
  for (const { rule, number } of added) {
    const before = removed.findIndex((r) => r.rule.resultId === rule.resultId);
    if (before !== -1) {
      removed.splice(before, 1);
      out.push({
        kind: 'rule_changed',
        subject: rule.resultId,
        message: `Result rule #${String(number)} for "${rule.resultId}" changed, now depends on ${dependsOn(rule)}`,
      });
    } else {
      out.push({
        kind: 'rule_added',
        subject: rule.resultId,
        message: `Result rule #${String(number)} for "${rule.resultId}" added, depends on ${dependsOn(rule)}`,
      });
    }
  }
  for (const { rule, number } of removed) {
    out.push({
      kind: 'rule_removed',
      subject: rule.resultId,
      message: `Result rule #${String(number)} for "${rule.resultId}" removed`,
    });
  }
  const kept = (from: string[], other: string[]) => from.filter((k) => other.includes(k));
  if (!same(kept(keysA, keysB), kept(keysB, keysA))) {
    out.push({ kind: 'rule_order', subject: 'resultRules', message: 'Result rule order changed' });
  }
  if (a.defaultResultId !== b.defaultResultId) {
    out.push({
      kind: 'default_result_changed',
      subject: b.defaultResultId,
      message: `Default result changed from "${a.defaultResultId}" to "${b.defaultResultId}"`,
    });
  }
}

function diffEvents(a: FunnelConfig, b: FunnelConfig, out: ConfigChange[]): void {
  const eventsA = new Map(a.events.allowed.map((e) => [e.name, e]));
  const eventsB = new Map(b.events.allowed.map((e) => [e.name, e]));
  for (const [name, event] of eventsB) {
    const before = eventsA.get(name);
    if (!before) {
      out.push({ kind: 'event_added', subject: name, message: `Event "${name}" added` });
    } else {
      const plus = event.properties.filter((p) => !before.properties.includes(p));
      const minus = before.properties.filter((p) => !event.properties.includes(p));
      const parts = [
        ...(plus.length > 0 ? [`added ${plus.join(', ')}`] : []),
        ...(minus.length > 0 ? [`removed ${minus.join(', ')}`] : []),
      ];
      if (parts.length > 0) {
        out.push({
          kind: 'event_changed',
          subject: name,
          message: `Event "${name}": properties ${parts.join('; ')}`,
        });
      }
    }
  }
  for (const name of eventsA.keys()) {
    if (!eventsB.has(name)) {
      out.push({ kind: 'event_removed', subject: name, message: `Event "${name}" removed` });
    }
  }
}

/**
 * Everything not compared above (title, session TTL, progress, privacy, schemaVersion,
 * fields unknown to this engine), so no change is ever silently missing from the list.
 */
function rest(config: FunnelConfig): Record<string, unknown> {
  // Release notes describe each version and differ by design.
  const top = [
    'version',
    'status',
    'releaseNote',
    'steps',
    'results',
    'resultRules',
    'defaultResultId',
  ];
  return {
    ...omit(config, [...top, 'experiment', 'events']),
    experiment: omit(config.experiment, ['id', 'variants']),
    events: omit(config.events, ['allowed']),
  };
}

function diffRest(a: FunnelConfig, b: FunnelConfig, out: ConfigChange[]): void {
  for (const path of changedPaths(rest(a), rest(b), 3)) {
    const privacy = path.startsWith('events.privacy');
    out.push({
      kind: privacy ? 'privacy_changed' : 'config_changed',
      subject: path,
      message: `${privacy ? 'Privacy setting' : 'Setting'} "${path}" changed`,
    });
  }
}

/**
 * Changes from `a` (usually the active version) to `b`. Both configs must resolve, which
 * lint guarantees for anything stored; a config that does not resolve throws.
 */
export function diffConfigs(a: FunnelConfig, b: FunnelConfig): ConfigChange[] {
  const out: ConfigChange[] = [];
  if (a.experiment.id !== b.experiment.id) {
    out.push({
      kind: 'experiment_changed',
      subject: b.experiment.id,
      message: `Experiment id changed to "${b.experiment.id}": A/B results start over`,
    });
  }
  for (const variant of VARIANTS) {
    const weightA = a.experiment.variants[variant].weight;
    const weightB = b.experiment.variants[variant].weight;
    if (weightA !== weightB) {
      out.push({
        kind: 'weight_changed',
        variant,
        subject: variant,
        message: `Variant ${variant}: weight ${String(weightA)} → ${String(weightB)}`,
      });
    }
  }
  for (const id of Object.keys(b.results)) {
    if (!(id in a.results)) {
      out.push({ kind: 'result_added', subject: id, message: `Result "${id}" added` });
    }
  }
  for (const id of Object.keys(a.results)) {
    if (!(id in b.results)) {
      out.push({ kind: 'result_removed', subject: id, message: `Result "${id}" removed` });
    }
  }
  diffRules(a, b, out);
  diffEvents(a, b, out);
  diffRest(a, b, out);
  for (const variant of VARIANTS) {
    diffVariant(resolveFunnel(a, variant), resolveFunnel(b, variant), out);
  }
  return out;
}
