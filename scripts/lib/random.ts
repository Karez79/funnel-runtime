// Deterministic randomness for the traffic generator (CLAUDE.md 9.1): mulberry32 seeded
// from `--seed`, and one independent stream per session derived from (seed, index), so
// a session behaves the same whatever order concurrent sessions finish in.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stream of session `index` of a run with `seed`. */
export function sessionRng(seed: number, index: number): Rng {
  return mulberry32(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35));
}

export const chance = (rng: Rng, p: number): boolean => rng() < p;

/** An integer in [min, max]. */
export const int = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** One of `items` with probability proportional to its `weight`. */
export function weighted<T extends { weight: number }>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let left = rng() * total;
  for (const item of items) {
    left -= item.weight;
    if (left < 0) return item;
  }
  return pick(rng, items);
}

/** A shuffled copy (Fisher–Yates). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
