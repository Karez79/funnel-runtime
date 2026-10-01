// Event catalog rules (CLAUDE.md 7.2). The catalog itself comes from `events.allowed` of
// each version; the seven base events are the floor every version must keep, because
// the analytics (11.2) is defined in terms of them.
import type { EventDefinition } from '../config/schema.ts';
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

/**
 * Keeps only properties the catalog lists for the event. This is the privacy guard of
 * 7.2: a raw answer has no whitelisted key to travel under. Dropped keys are reported so
 * ingest can flag them (`flags_json.dropped_props`).
 */
export function filterProperties(
  definition: EventDefinition,
  properties: EventProperties,
): { properties: EventProperties; dropped: string[] } {
  const allowed = new Set(definition.properties);
  const kept: EventProperties = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (allowed.has(key)) kept[key] = value;
    else dropped.push(key);
  }
  return { properties: kept, dropped };
}
