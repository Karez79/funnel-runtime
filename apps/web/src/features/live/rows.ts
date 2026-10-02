// Rows of the Live events table: newest first, one row per ingest result, identified by
// the server's `seq`. A reconnect replays the server's backlog, which is merged away.
import type { LiveEntry } from '@funnel/shared';

export const KEEP_ROWS = 200;

/** `incoming` in arrival order; the result is newest first and capped. */
export function mergeRows(rows: readonly LiveEntry[], incoming: readonly LiveEntry[]): LiveEntry[] {
  const seen = new Set(rows.map((r) => r.seq));
  const fresh: LiveEntry[] = [];
  for (const entry of incoming) {
    if (seen.has(entry.seq)) continue;
    seen.add(entry.seq);
    fresh.push(entry);
  }
  return [...rows, ...fresh].sort((a, b) => b.seq - a.seq).slice(0, KEEP_ROWS);
}

/**
 * Whether a `hello` naming `boot` starts the rows over: only a reconnect to another server
 * process does (a redeploy), whose backlog carries new `seq` numbers for old results.
 */
export const isNewProcess = (previousBoot: string | null, boot: string): boolean =>
  previousBoot !== null && previousBoot !== boot;

/**
 * Rows after Resume: the buffer merged onto what was on screen, or onto nothing when the
 * server process changed during the pause (the frozen rows stay until then).
 */
export const resumeRows = (
  rows: readonly LiveEntry[],
  buffer: readonly LiveEntry[],
  newProcess: boolean,
): LiveEntry[] => mergeRows(newProcess ? [] : rows, buffer);
