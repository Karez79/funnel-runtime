// The Live events feed (CLAUDE.md 11.1) over server-sent events from LIVE_STREAM.path.
// EventSource reconnects by itself and the server replays its backlog on every connect;
// rows are identified by the server's `seq`, so the replay merges away while repeated
// results of one event stay separate rows. Pausing keeps receiving into a buffer (merged
// the same way), and resuming shows what arrived meanwhile. A reconnect to another server
// process (its `hello` names a new boot, as after a redeploy) starts the rows over: the new
// process numbers its backlog afresh, so merging would show those results twice.
import { LIVE_STREAM, type LiveEntry } from '@funnel/shared';
import { useEffect, useRef, useState } from 'react';
import { parseLiveBoot, parseLiveEntry } from '../../lib/liveEntry.ts';
import { isNewProcess, mergeRows } from './rows.ts';

export type Connection = 'connecting' | 'open' | 'reconnecting';

export function useLiveStream() {
  const [rows, setRows] = useState<LiveEntry[]>([]);
  const [buffer, setBuffer] = useState<LiveEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [connection, setConnection] = useState<Connection>('connecting');
  // Read by the EventSource listener, which is set up once.
  const pausedRef = useRef(false);
  const bootRef = useRef<string | null>(null);

  const togglePause = () => {
    pausedRef.current = !paused;
    if (paused) {
      setRows((current) => mergeRows(current, buffer));
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
    source.addEventListener(LIVE_STREAM.helloEvent, (message: MessageEvent<string>) => {
      const boot = parseLiveBoot(message.data);
      if (boot === null) return;
      if (isNewProcess(bootRef.current, boot)) {
        setRows([]);
        setBuffer([]);
      }
      bootRef.current = boot;
    });
    source.onmessage = (message: MessageEvent<string>) => {
      const entry = parseLiveEntry(message.data);
      if (!entry) return;
      if (pausedRef.current) setBuffer((b) => mergeRows(b, [entry]));
      else setRows((current) => mergeRows(current, [entry]));
    };
    return () => {
      source.close();
    };
  }, []);

  // Rows already on screen (a backlog replayed while paused) do not count as new.
  const buffered = buffer.filter((b) => !rows.some((r) => r.seq === b.seq)).length;
  return { rows, buffered, connection, paused, togglePause };
}
