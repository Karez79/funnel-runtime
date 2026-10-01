// Applying a variant to a config (CLAUDE.md 4.3). The server resolves the pinned version
// for the session's variant and sends only that to the client, so the other variant
// never leaves the server. Overrides are deep-merged (objects merge, arrays and scalars
// replace) and the merged step or result is parsed again, so an override can never
// produce a step the renderer does not understand. Lint resolves both variants before a
// version is published, which is why a failure here is an error, not a fallback.
import { z } from 'zod';
import { DomainError } from '../api/errors.ts';
import {
  EventDefinitionSchema,
  formatIssues,
  ParsedStepSchema,
  ResultRuleSchema,
  ResultSchema,
  StepSchema,
  VARIANTS,
  type FunnelConfig,
  type Result,
  type Step,
  type VariantKey,
} from '../config/schema.ts';
import { own } from '../own.ts';

/** Also the wire shape of the session response (6.2), hence a zod schema. */
export const ResolvedFunnelSchema = z.object({
  meta: z.object({
    funnelId: z.string(),
    version: z.number().int(),
    title: z.string(),
    experimentId: z.string(),
    variant: z.enum(VARIANTS),
    progressExcludeTypes: z.array(z.string()),
  }),
  /** Step ids in the variant's order; the last one is the result step. */
  sequence: z.array(z.string()),
  steps: z.record(z.string(), ParsedStepSchema),
  results: z.record(z.string(), ResultSchema),
  resultRules: z.array(ResultRuleSchema),
  defaultResultId: z.string(),
  eventCatalog: z.array(EventDefinitionSchema),
});
export type ResolvedFunnel = z.infer<typeof ResolvedFunnelSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) merged[key] = deepMerge(own(base, key), value);
  return merged;
}

function parseMerged<T>(schema: z.ZodType<T>, base: unknown, patch: unknown, what: string): T {
  const parsed = schema.safeParse(deepMerge(base, patch ?? {}));
  if (parsed.success) return parsed.data;
  const issues = formatIssues(parsed.error).join('; ');
  throw new DomainError('unprocessable', `${what} is invalid after overrides: ${issues}`);
}

export function resolveFunnel(config: FunnelConfig, variant: VariantKey): ResolvedFunnel {
  const { stepSequence, stepOverrides, resultOverrides } = config.experiment.variants[variant];

  const steps: Record<string, Step> = {};
  for (const id of stepSequence) {
    const base = own(config.steps, id);
    if (!base) {
      throw new DomainError('unprocessable', `step "${id}" of variant ${variant} does not exist`);
    }
    const step = parseMerged(StepSchema, base, own(stepOverrides, id), `step "${id}"`);
    // Events and answers are keyed by the step's id and shaped by its type.
    if (step.id !== base.id || step.type !== base.type) {
      throw new DomainError('unprocessable', `step "${id}": an override cannot change id or type`);
    }
    steps[id] = step;
  }

  const results: Record<string, Result> = {};
  for (const [id, base] of Object.entries(config.results)) {
    const result = parseMerged(ResultSchema, base, own(resultOverrides, id), `result "${id}"`);
    if (result.id !== base.id) {
      throw new DomainError('unprocessable', `result "${id}": an override cannot change id`);
    }
    results[id] = result;
  }

  // Parsing the result copies every array and object it knows, so a caller that mutates
  // the resolved funnel never reaches the (possibly cached) config.
  return ResolvedFunnelSchema.parse({
    meta: {
      funnelId: config.funnelId,
      version: config.version,
      title: config.title,
      experimentId: config.experiment.id,
      variant,
      progressExcludeTypes: config.progress.excludeTypes,
    },
    sequence: stepSequence,
    steps,
    results,
    resultRules: config.resultRules,
    defaultResultId: config.defaultResultId,
    eventCatalog: config.events.allowed,
  });
}
