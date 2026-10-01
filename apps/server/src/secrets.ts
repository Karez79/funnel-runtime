// Constant-time comparison of secrets (admin password, generator key, CLAUDE.md 6.0).
// Both sides are hashed first so the buffers have equal length and the comparison
// leaks neither the content nor the length of the expected value.
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}
