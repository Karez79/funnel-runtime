// The Live events feed (CLAUDE.md 11.1) over server-sent events from LIVE_STREAM.path.
// EventSource reconnects by itself; on every (re)connect the server first replays its
// last entries, so rows are keyed and merged rather than appended blindly. Pausing keeps
// receiving into a buffer, and resuming shows what arrived meanwhile.
import { LIVE_STREAM, LiveEntrySchema, type LiveEntry } from '@funnel/shared';
import { useEffect, useRef, useState } from 'react';

const KEEP = 200;

export type Connection = 'connecting' | 'open' | 'reconnecting';

export interface LiveRow extends LiveEntry {
  readonly key: string;
}

const keyOf = (e: LiveEntry) =>
  [e.receivedAt, e.eventId ?? '', e.sessionId ?? '', e.name ?? '', e.status, e.reason ?? ''].join(
    '|',
  );

/** Newest first, without rows already shown, capped. */
function merge(rows: readonly LiveRow[], incoming: readonly LiveRow[]): LiveRow[] {
  const seen = new Set(rows.map((r) => r.key));
  const fresh = incoming.filter((r) => !seen.has(r.key)).reverse();
  return [...fresh, ...rows].slice(0, KEEP);
}

export function useLiveStream() {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [buffer, setBuffer] = useState<LiveRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [connection, setConnection] = useState<Connection>('connecting');
  // Read by the EventSource listener, which is set up once.
  const pausedRef = useRef(false);

  const togglePause = () => {
    pausedRef.current = !paused;
    if (paused) {
      setRows((current) => merge(current, buffer));
      setBuffer([]);
    }
    setPaused(!paused);
  };

  useEffect(() => {
    const source = new EventSource(LIVE_STREAM.path);
    source.onopen = () => {
      setConnection('open');
    };
    source.onerror = () => {
      setConnection('reconnecting');
    };
    source.onmessage = (message: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = LiveEntrySchema.safeParse(data);
      if (!parsed.success) return;
      const row = { ...parsed.data, key: keyOf(parsed.data) };
      if (pausedRef.current) setBuffer((b) => [...b, row].slice(-KEEP));
      else setRows((current) => merge(current, [row]));
    };
    return () => {
      source.close();
    };
  }, []);

  return { rows, buffered: buffer.length, connection, paused, togglePause };
}
