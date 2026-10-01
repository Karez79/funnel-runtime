// Event catalog rules (CLAUDE.md 7.2). The catalog itself comes from `events.allowed` of
// each version; the seven base events are the floor every version must keep, because
// the analytics (11.2) is defined in terms of them.
import type { EventDefinition, FunnelConfig } from '../config/schema.ts';
import type { EventProperties } from './schema.ts';

export const BASE_EVENTS = [
  'session_started',
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
] as const;

/** Created by the server with the session; a client copy is rejected as `server_only`. */
const SERVER_ONLY = new Set<string>(['session_started']);

export function isServerOnly(name: string): boolean {
  return SERVER_ONLY.has(name);
}

/** The definition of `name` in a version's catalog (own entries only). */
export function catalogEvent(
  catalog: readonly EventDefinition[],
  name: string,
): EventDefinition | undefined {
  return catalog.find((event) => event.name === name);
}

type Privacy = FunnelConfig['events']['privacy'];

/**
 * Property values with a known format. `answer_kind` is the one property derived from an
 * answer, so anything but a kind (a raw value sent under that key) is dropped.
 */
const PROPERTY_FORMATS: Readonly<Record<string, RegExp>> = {
  answer_kind: /^(single_select|multi_select:\d+|number)$/,
};

const isScalar = (value: unknown): value is EventProperties[string] =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * Keeps only properties the catalog lists for the event, with flat values of the expected
 * format. This is the privacy guard of 7.2: a raw answer has no whitelisted key to travel
 * under. Dropped keys are reported so ingest can flag them (`flags_json.dropped_props`)
 * instead of rejecting the event. `allowAnswerKinds: false` drops `answer_kind` too.
 */
export function filterProperties(
  definition: EventDefinition,
  properties: Readonly<Record<string, unknown>>,
  privacy?: Privacy,
): { properties: EventProperties; dropped: string[] } {
  const allowed = new Set(definition.properties);
  if (privacy?.allowAnswerKinds === false) allowed.delete('answer_kind');
  const kept: EventProperties = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const format = Object.hasOwn(PROPERTY_FORMATS, key) ? PROPERTY_FORMATS[key] : undefined;
    const valid = isScalar(value) && (!format || (typeof value === 'string' && format.test(value)));
    if (allowed.has(key) && valid) kept[key] = value;
    else dropped.push(key);
  }
  return { properties: kept, dropped };
}
