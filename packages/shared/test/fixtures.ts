// Test fixtures: the real v1/v2/v3 configs plus a helper to derive variations from them.
// v3 was kept out of every test until Phase 7 (CLAUDE.md 1); it is used only by the
// second-iteration tests (src/iteration2.test.ts), which check the existing code against it.
import v1Json from '../../../configs/funnel-v1.json' with { type: 'json' };
import v2Json from '../../../configs/funnel-v2.json' with { type: 'json' };
import v3Json from '../../../configs/funnel-v3.json' with { type: 'json' };
import { parseConfig, type FunnelConfig } from '../src/config/schema.ts';

export const rawV1: unknown = v1Json;
export const rawV2: unknown = v2Json;
const rawV3: unknown = v3Json;

function parsed(raw: unknown): FunnelConfig {
  const result = parseConfig(raw);
  if (!result.ok) throw new Error(`fixture does not parse: ${result.issues.join('; ')}`);
  return result.config;
}

export const v1 = (): FunnelConfig => parsed(structuredClone(rawV1));
export const v2 = (): FunnelConfig => parsed(structuredClone(rawV2));
export const v3 = (): FunnelConfig => parsed(structuredClone(rawV3));

/** Deep-cloned raw v1 JSON for tests that need to break or extend it. */
export function rawV1Clone(): Record<string, unknown> {
  const clone: unknown = structuredClone(rawV1);
  if (typeof clone !== 'object' || clone === null || Array.isArray(clone)) {
    throw new Error('v1 fixture is not an object');
  }
  return { ...clone };
}
