// "Receiving events" in the top bar (CLAUDE.md 10): it pulses only while ingest results
// actually arrive on the live stream (one in the last minute), says "Listening" when the
// stream is open but quiet and "Offline" when it is not. The pulse is the one ambient
// animation the design allows; reduced motion stops it.
import { LIVE_STREAM, LiveEntrySchema } from '@funnel/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import styles from './AdminLayout.module.css';

const RECENT_MS = 60_000;
/** Below this width the top bar has no room for the indicator (reference: ≤860px). */
const NARROW = '(width <= 860px)';

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

/** Not even mounted on narrow screens, so no stream is held open for a hidden label. */
export function LiveIndicator() {
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches);
  return narrow ? null : <Indicator />;
}

function Indicator() {
  const [open, setOpen] = useState(false);
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const source = new EventSource(LIVE_STREAM.path);
    source.onopen = () => {
      setOpen(true);
    };
    source.onerror = () => {
      setOpen(false);
    };
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        const entry = LiveEntrySchema.safeParse(JSON.parse(message.data));
        // The replayed backlog carries old receive times, so it does not count as "now".
        if (entry.success) setLastAt((t) => Math.max(t, Date.parse(entry.data.receivedAt)));
      } catch {
        // Not JSON: ignore, the stream only sends entries.
      }
    };
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 10_000);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, []);

  const receiving = open && now - lastAt < RECENT_MS;
  const label = receiving ? 'Receiving events' : open ? 'Listening' : 'Offline';
  return (
    <Link to="/admin/live" className={styles.live} viewTransition>
      <span className={receiving ? `${styles.dot} ${styles.pulse}` : styles.dot} />
      {label}
    </Link>
  );
}
