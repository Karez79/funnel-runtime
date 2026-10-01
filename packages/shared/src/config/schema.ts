// Funnel config format (CLAUDE.md 4.1): the single zod definition used by the server
// (upload, lint), the web client (types) and the generator. Strict about known fields,
// tolerant of unknown ones (`z.looseObject`), so configs written for a newer engine
// still load. Steps of an unknown type are accepted as `UnknownStep`; the client renders
// a fallback for them instead of crashing (8.2).
import { z } from 'zod';

// ---------- conditions (4.2) ----------

export const KNOWN_OPERATORS = [
  'eq',
  'ne',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'exists',
] as const;

// Strict objects: a node with an extra key (`{ all, any }`, a leaf with a stray `not`)
// is an authoring error, and stripping the key would silently change the condition.
const ConditionLeafSchema = z.strictObject({
  answer: z.string().min(1),
  /** A string, so an unknown operator parses; lint rejects it on publish (4.2). */
  operator: z.string().min(1),
  value: z.unknown().optional(),
});
export type ConditionLeaf = z.infer<typeof ConditionLeafSchema>;

const ConditionSchema = z.union([
  ConditionLeafSchema,
  z.strictObject({
    get all() {
      return z.array(ConditionSchema);
    },
  }),
  z.strictObject({
    get any() {
      return z.array(ConditionSchema);
    },
  }),
  z.strictObject({
    get not() {
      return ConditionSchema;
    },
  }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

// ---------- steps ----------

export const KNOWN_STEP_TYPES = [
  'info',
  'single-select',
  'multi-select',
  'number',
  'result',
] as const;

const StepContent = z.looseObject({
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  helperText: z.string().optional(),
  primaryActionLabel: z.string().optional(),
  loadingTitle: z.string().optional(),
  errorTitle: z.string().optional(),
  retryLabel: z.string().optional(),
});

const Option = z.looseObject({ value: z.string().min(1), label: z.string() });
export type Option = z.infer<typeof Option>;

const Validation = z.looseObject({
  required: z.boolean().optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
  messages: z.record(z.string(), z.string()).optional(),
});

const stepBase = {
  id: z.string().min(1),
  content: StepContent.default({}),
  visibleWhen: ConditionSchema.optional(),
};

const ChoiceInput = z.looseObject({ name: z.string().min(1), options: z.array(Option).min(1) });

const InfoStep = z.looseObject({ ...stepBase, type: z.literal('info') });
const SingleSelectStep = z.looseObject({
  ...stepBase,
  type: z.literal('single-select'),
  input: ChoiceInput,
  validation: Validation.optional(),
});
const MultiSelectStep = z.looseObject({
  ...stepBase,
  type: z.literal('multi-select'),
  input: ChoiceInput,
  validation: Validation.optional(),
});
const NumberStep = z.looseObject({
  ...stepBase,
  type: z.literal('number'),
  input: z.looseObject({
    name: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().optional(),
  }),
  validation: Validation.optional(),
});
const ResultStep = z.looseObject({
  ...stepBase,
  type: z.literal('result'),
  resultSource: z.string().optional(),
});
const UnknownStep = z.looseObject({ ...stepBase, type: z.string() });

const KNOWN_STEP_SCHEMAS = {
  info: InfoStep,
  'single-select': SingleSelectStep,
  'multi-select': MultiSelectStep,
  number: NumberStep,
  result: ResultStep,
} as const satisfies Record<(typeof KNOWN_STEP_TYPES)[number], z.ZodType>;

type KnownStepSchema = (typeof KNOWN_STEP_SCHEMAS)[keyof typeof KNOWN_STEP_SCHEMAS];
export type KnownStep = z.infer<KnownStepSchema>;
export type Step = KnownStep | z.infer<typeof UnknownStep>;

function isKnownType(type: string): type is keyof typeof KNOWN_STEP_SCHEMAS {
  return Object.hasOwn(KNOWN_STEP_SCHEMAS, type);
}

// The schema is chosen by `type` before parsing, so issues of a broken known step point
// at the broken field, and a step of an unknown type falls back to UnknownStep (8.2).
const StepSchema = z.looseObject({ type: z.string() }).transform((raw, ctx): Step => {
  const schema: z.ZodType<Step> = isKnownType(raw.type)
    ? KNOWN_STEP_SCHEMAS[raw.type]
    : UnknownStep;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
  return z.NEVER;
});

export type SingleSelectStep = z.infer<typeof SingleSelectStep>;
export type MultiSelectStep = z.infer<typeof MultiSelectStep>;
export type NumberStep = z.infer<typeof NumberStep>;
export type InteractiveStep = SingleSelectStep | MultiSelectStep | NumberStep;

/** Parsing guarantees a known `type` matched its own schema (see UnknownStep). */
export function isKnownStep(step: Step): step is KnownStep {
  return isKnownType(step.type);
}

export function isInteractive(step: Step): step is InteractiveStep {
  return step.type === 'single-select' || step.type === 'multi-select' || step.type === 'number';
}

/** Answers are stored under `input.name` (4.1); steps without input use their id. */
export function answerKey(step: Step): string {
  return isInteractive(step) ? step.input.name : step.id;
}

// ---------- results, experiment, events ----------

const Cta = z.looseObject({ label: z.string(), action: z.string() });

const Result = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  recommendations: z.array(z.string()),
  cta: Cta,
});
export type Result = z.infer<typeof Result>;

const PlainObject = z.record(z.string(), z.unknown());

const Variant = z.looseObject({
  weight: z.number(),
  stepSequence: z.array(z.string().min(1)).min(1),
  stepOverrides: z.record(z.string(), PlainObject).default({}),
  resultOverrides: z.record(z.string(), PlainObject).default({}),
});

export const VARIANTS = ['A', 'B'] as const;
export type VariantKey = (typeof VARIANTS)[number];

const Experiment = z.looseObject({
  id: z.string().min(1),
  variants: z.strictObject({ A: Variant, B: Variant }),
});

const EventDefinition = z.looseObject({
  name: z.string().min(1),
  trigger: z.string().optional(),
  properties: z.array(z.string()).default([]),
});
export type EventDefinition = z.infer<typeof EventDefinition>;

const Events = z.looseObject({
  baseProperties: z.array(z.string()).default([]),
  allowed: z.array(EventDefinition),
  privacy: z.looseObject({
    storeRawAnswers: z.boolean(),
    allowAnswerKinds: z.boolean().optional(),
  }),
});

const ResultRule = z.looseObject({ resultId: z.string().min(1), when: ConditionSchema });
export type ResultRule = z.infer<typeof ResultRule>;

const FunnelConfigSchema = z.looseObject({
  schemaVersion: z.string().min(1),
  funnelId: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string(),
  description: z.string().optional(),
  locale: z.string().optional(),
  releaseNote: z.string().optional(),
  session: z.looseObject({ ttlHours: z.number().positive() }),
  progress: z
    .looseObject({ excludeTypes: z.array(z.string()).default(['info', 'result']) })
    .default({ excludeTypes: ['info', 'result'] }),
  experiment: Experiment,
  steps: z.record(z.string(), StepSchema),
  resultRules: z.array(ResultRule).default([]),
  defaultResultId: z.string().min(1),
  results: z.record(z.string(), Result),
  events: Events,
});

export type FunnelConfig = z.infer<typeof FunnelConfigSchema>;

export type ParseConfigResult =
  { ok: true; config: FunnelConfig } | { ok: false; issues: string[] };

export function parseConfig(raw: unknown): ParseConfigResult {
  const res = FunnelConfigSchema.safeParse(raw);
  if (res.success) return { ok: true, config: res.data };
  return {
    ok: false,
    issues: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
