// Deterministic A/B assignment (CLAUDE.md 6.2): the bucket is a hash of the session id
// and the experiment id, so the same pair always lands in the same variant and a new
// experiment (every version has its own id) reshuffles independently. The result is
// stored on the session row and never recomputed; these functions are pure so the
// distribution can be tested on any number of ids.
import { VARIANTS, type VariantKey } from '@funnel/shared';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const BUCKETS = 100;
const encoder = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `input`, as an unsigned integer. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(input)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * `bucket = fnv1a32(sessionId + ':' + experimentId) % 100`, compared with cumulative
 * weights in VARIANTS order. Weights that do not sum to 100 are scaled by their sum
 * (lint guarantees every weight is positive).
 */
export function assignVariant(
  sessionId: string,
  experimentId: string,
  variants: Readonly<Record<VariantKey, { readonly weight: number }>>,
): VariantKey {
  const bucket = fnv1a32(`${sessionId}:${experimentId}`) % BUCKETS;
  const total = VARIANTS.reduce((sum, v) => sum + variants[v].weight, 0);
  let cumulative = 0;
  for (const variant of VARIANTS) {
    cumulative += variants[variant].weight;
    if (bucket < (cumulative / total) * BUCKETS) return variant;
  }
  // Unreachable with positive weights: the last threshold is exactly 100.
  return VARIANTS[VARIANTS.length - 1] ?? 'A';
}
