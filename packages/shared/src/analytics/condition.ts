// Human-readable `visibleWhen` for the dashboard badge and the step table ("if work_mode
// in hybrid, office"). Built from the config, so a new condition in a new version needs
// no dashboard change. Operators the engine does not know are printed as written.
import type { Condition } from '../config/schema.ts';
import { own } from '../own.ts';

const OPERATOR_TEXT: Readonly<Record<string, string>> = {
  eq: 'is',
  ne: 'is not',
  in: 'in',
  not_in: 'not in',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'includes',
};

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // undefined (a leaf without value) stringifies to undefined, not to a string.
  return value === undefined ? '' : JSON.stringify(value);
}

function nodeText(condition: Condition, nested: boolean): string {
  if ('all' in condition || 'any' in condition) {
    const [parts, joiner] = 'all' in condition ? [condition.all, ' and '] : [condition.any, ' or '];
    const text = parts.map((part) => nodeText(part, true)).join(joiner);
    return nested && parts.length > 1 ? `(${text})` : text;
  }
  if ('not' in condition) return `not ${nodeText(condition.not, true)}`;
  if (condition.operator === 'exists') {
    return `${condition.answer} is ${condition.value === false ? 'not answered' : 'answered'}`;
  }
  const operator = own(OPERATOR_TEXT, condition.operator) ?? condition.operator;
  return `${condition.answer} ${operator} ${valueText(condition.value)}`;
}

export function describeCondition(condition: Condition): string {
  return `if ${nodeText(condition, false)}`;
}
