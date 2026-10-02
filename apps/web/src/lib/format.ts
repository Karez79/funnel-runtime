// Number and time formatting for the admin, in one place so every screen writes
// "41.2%", "Oct 1, 10:42" and "+3.1 pts" the same way. English UI (CLAUDE.md 10).
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const integer = new Intl.NumberFormat('en-US');

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatCount = (n: number) => integer.format(n);

/** A 0..1 share as a percentage; a dash when there is no denominator. */
export function formatPercent(rate: number | null, digits = 0): string {
  return rate === null ? '–' : `${(rate * 100).toFixed(digits)}%`;
}

/** Difference of two shares in percentage points, signed: "+3.1 pts". */
export function formatPoints(points: number, digits = 1): string {
  const sign = points > 0 ? '+' : points < 0 ? '−' : '';
  return `${sign}${Math.abs(points).toFixed(digits)} pts`;
}
