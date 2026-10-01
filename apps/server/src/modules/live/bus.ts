// In-memory feed of ingest results for the Live events page (CLAUDE.md 11.1). It keeps
// only the last few entries so a page that (re)connects sees recent traffic at once;
// the durable record is the events, rejected_events and ingest_log tables. Memory is
// enough because there is exactly one server instance (CLAUDE.md 2).
import type { LiveEntry } from '@funnel/shared';

type Listener = (entry: LiveEntry) => void;

export function createLiveBus(capacity: number) {
  const recent: LiveEntry[] = [];
  const listeners = new Set<Listener>();
  return {
    publish(entries: readonly LiveEntry[]): void {
      for (const entry of entries) {
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
