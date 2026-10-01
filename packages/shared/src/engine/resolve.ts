// Applying a variant to a config (CLAUDE.md 4.3). The server resolves the pinned version
// for the session's variant and sends only that to the client, so the other variant
// never leaves the server. Overrides are deep-merged (objects merge, arrays and scalars
// replace) and the merged step or result is parsed again, so an override can never
// produce a step the renderer does not understand. Lint resolves both variants before a
// version is published, which is why a failure here is an error, not a fallback.
import type { ZodType } from 'zod';
import { DomainError } from '../api/errors.ts';
import {
  formatIssues,
  ResultSchema,
  StepSchema,
  type EventDefinition,
  type FunnelConfig,
  type Result,
  type ResultRule,
  type Step,
  type VariantKey,
} from '../config/schema.ts';

export interface ResolvedFunnel {
  readonly meta: {
    readonly funnelId: string;
    readonly version: number;
    readonly title: string;
    readonly experimentId: string;
    readonly variant: VariantKey;
    readonly progressExcludeTypes: readonly string[];
  };
  /** Step ids in the variant's order; the last one is the result step. */
  readonly sequence: readonly string[];
  readonly steps: Readonly<Record<string, Step>>;
  readonly results: Readonly<Record<string, Result>>;
  readonly resultRules: readonly ResultRule[];
  readonly defaultResultId: string;
  readonly eventCatalog: readonly EventDefinition[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) merged[key] = deepMerge(base[key], value);
  return merged;
}

function parseMerged<T>(schema: ZodType<T>, base: unknown, patch: unknown, what: string): T {
  const parsed = schema.safeParse(deepMerge(base, patch ?? {}));
  if (parsed.success) return parsed.data;
  const issues = formatIssues(parsed.error).join('; ');
  throw new DomainError('unprocessable', `${what} is invalid after overrides: ${issues}`);
}

export function resolveFunnel(config: FunnelConfig, variant: VariantKey): ResolvedFunnel {
  const { stepSequence, stepOverrides, resultOverrides } = config.experiment.variants[variant];

  const steps: Record<string, Step> = {};
  for (const id of stepSequence) {
    const base = config.steps[id];
    if (!base) {
      throw new DomainError('unprocessable', `step "${id}" of variant ${variant} does not exist`);
    }
    steps[id] = parseMerged(StepSchema, base, stepOverrides[id], `step "${id}"`);
  }

  const results: Record<string, Result> = {};
  for (const [id, base] of Object.entries(config.results)) {
    results[id] = parseMerged(ResultSchema, base, resultOverrides[id], `result "${id}"`);
  }

  return {
    meta: {
      funnelId: config.funnelId,
      version: config.version,
      title: config.title,
      experimentId: config.experiment.id,
      variant,
      progressExcludeTypes: [...config.progress.excludeTypes],
    },
    sequence: [...stepSequence],
    steps,
    results,
    resultRules: config.resultRules,
    defaultResultId: config.defaultResultId,
    eventCatalog: config.events.allowed,
  };
}
