// Shape of `GET /api/analytics/summary` (CLAUDE.md 11.2): the output of the aggregator,
// the ground truth file of the generator and what `verify` compares field by field, so
// all three agree on one definition. Every count is a number of unique sessions.
import { z } from 'zod';
import { VARIANTS } from '../config/schema.ts';
import { REJECT_REASONS } from '../events/schema.ts';

const count = z.number().int().nonnegative();
/** A share in 0..1; `null` when the denominator is 0. */
const rate = z.number().min(0).max(1).nullable();

export const VariantFilterSchema = z.enum([...VARIANTS, 'all']);

export const AnalyticsFiltersSchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  variant: VariantFilterSchema.default('all'),
  campaign: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  includeQa: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * `generator`: only rows written with a valid GENERATOR_KEY (its sessions, QA overrides
   * included with includeQa, and the duplicates and rejections of its batches). The
   * generator's ground-truth checks set it so that real visitors during a run on the
   * public URL do not change the numbers; the dashboard does not offer it. Applied by
   * the server when it selects rows: the aggregator never sees anyone else's.
   */
  traffic: z.enum(['generator']).optional(),
});
export type AnalyticsFilters = z.output<typeof AnalyticsFiltersSchema>;

const Kpis = z.object({
  started: count,
  reachedResult: count,
  clickedCta: count,
  inProgress: count,
  resultRate: rate,
  ctaCtr: rate,
  startedToCta: rate,
  backUsage: rate,
});

const StepMetrics = z.object({
  reached: count,
  completed: count,
  passRate: rate,
  droppedHere: count,
  cameBack: count,
});

const ByVariant = <T extends z.ZodType>(schema: T) =>
  z.object({ A: schema.nullable(), B: schema.nullable(), all: schema });

const Proportion = z.object({
  sessions: count,
  conversions: count,
  rate,
  /** 95% Wilson interval. */
  ci: z.tuple([z.number(), z.number()]).nullable(),
});

export const AnalyticsSummarySchema = z.object({
  funnelId: z.string(),
  version: z.number().int().positive(),
  experimentId: z.string(),
  kpis: ByVariant(Kpis),
  /**
   * Step order of each variant. `steps` follows the selected variant's sequence; for
   * `variant=all` it is A's sequence followed by steps only B has, in B's order.
   */
  sequences: z.object({ A: z.array(z.string()), B: z.array(z.string()) }),
  steps: z.array(
    z.object({
      stepId: z.string(),
      type: z.string(),
      /** Human-readable `visibleWhen`, e.g. "if work_mode in hybrid, office"; null if always shown. */
      condition: z.string().nullable(),
      metrics: ByVariant(StepMetrics),
    }),
  ),
  results: z.array(z.object({ resultId: z.string(), sessions: ByVariant(count) })),
  branches: z.array(
    z.object({
      stepId: z.string(),
      parentStepId: z.string(),
      seen: count,
      parentReached: count,
      share: rate,
    }),
  ),
  experiment: z.object({
    metric: z.literal('started_to_cta'),
    A: Proportion,
    B: Proportion,
    diffPoints: z.number().nullable(),
    pValue: z.number().min(0).max(1).nullable(),
    requiredPerVariant: z.number().int().positive().nullable(),
    verdict: z.string(),
  }),
  versions: z.array(
    z.object({ version: z.number().int().positive(), active: z.boolean(), kpis: Kpis }),
  ),
  otherEvents: z.array(z.object({ name: z.string(), sessions: count, shareOfCta: rate })),
  dataQuality: z.object({
    duplicates: count,
    outOfOrder: count,
    contextMismatch: count,
    rejected: z.array(z.object({ reason: z.enum(REJECT_REASONS), count })),
  }),
  daily: z.array(z.object({ date: z.iso.date(), started: count })),
  sources: z.array(z.object({ source: z.string().nullable(), sessions: count })),
  /** Present when the generator's ground truth file exists. */
  groundTruthMatches: z.boolean().nullable(),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;
