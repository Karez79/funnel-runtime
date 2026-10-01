// In-memory feed of ingest results for the Live events page (CLAUDE.md 11.1). It keeps
// only the last few entries so a page that (re)connects sees recent traffic at once;
// the durable record is the events, rejected_events and ingest_log tables. Memory is
// enough because there is exactly one server instance (CLAUDE.md 2).
import type { LiveEntry, LiveEntryDraft } from '@funnel/shared';

type Listener = (entry: LiveEntry) => void;

/**
 * `seq` is the row identity on the Live page. It starts from the current time in
 * microseconds and only grows, so numbers stay unique across server restarts and a page
 * that reconnects can tell the replayed backlog from new entries.
 */
export function createLiveBus(capacity: number, now: () => number = Date.now) {
  const recent: LiveEntry[] = [];
  const listeners = new Set<Listener>();
  let seq = 0;
  return {
    publish(drafts: readonly LiveEntryDraft[]): void {
      for (const draft of drafts) {
        seq = Math.max(seq + 1, now() * 1000);
        const entry: LiveEntry = { seq, ...draft };
        recent.push(entry);
        if (recent.length > capacity) recent.shift();
        for (const listener of listeners) listener(entry);
      }
    },
    /** The last `capacity` entries, oldest first. */
    recent(): LiveEntry[] {
      return [...recent];
    },
    /** Open subscriptions (a closed stream must not leave one behind). */
    subscribers(): number {
      return listeners.size;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type LiveBus = ReturnType<typeof createLiveBus>;
