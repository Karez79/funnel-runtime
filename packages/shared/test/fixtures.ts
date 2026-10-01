// Test fixtures: the real v1/v2 configs plus a helper to derive variations from them.
// v3 is deliberately not used before Phase 7 (CLAUDE.md 1).
import v1Json from '../../../configs/funnel-v1.json' with { type: 'json' };
import v2Json from '../../../configs/funnel-v2.json' with { type: 'json' };
import { parseConfig, type FunnelConfig } from '../src/config/schema.ts';

export const rawV1: unknown = v1Json;
export const rawV2: unknown = v2Json;

function parsed(raw: unknown): FunnelConfig {
  const result = parseConfig(raw);
  if (!result.ok) throw new Error(`fixture does not parse: ${result.issues.join('; ')}`);
  return result.config;
}

export const v1 = (): FunnelConfig => parsed(structuredClone(rawV1));
export const v2 = (): FunnelConfig => parsed(structuredClone(rawV2));

/** Deep-cloned raw v1 JSON for tests that need to break or extend it. */
export function rawV1Clone(): Record<string, unknown> {
  const clone: unknown = structuredClone(rawV1);
  if (typeof clone !== 'object' || clone === null || Array.isArray(clone)) {
    throw new Error('v1 fixture is not an object');
  }
  return { ...clone };
}
