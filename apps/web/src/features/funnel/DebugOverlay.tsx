// Debug overlay (CLAUDE.md 8.5): `?debug=1` or Shift+D. Shows what the server pinned to
// this session and what the client derived from it, plus the event outbox length, and
// can throw the session away. It never shows answer values.
import type { SessionResponse } from '@funnel/shared';
import { useEffect, useEffectEvent, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import styles from './DebugOverlay.module.css';
import type { EventSink } from './tracking.ts';

const POLL_MS = 1000;

interface DebugOverlayProps {
  readonly session: SessionResponse['session'];
  readonly visiblePath: readonly string[];
  readonly currentStepId: string;
  readonly stateRev: number;
  readonly sink: EventSink;
  readonly onReset: () => void;
}

export function DebugOverlay({
  session,
  visiblePath,
  currentStepId,
  stateRev,
  sink,
  onReset,
}: DebugOverlayProps) {
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get('debug') === '1',
  );
  const [outbox, setOutbox] = useState(() => sink.pending());

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!event.shiftKey || event.key.toLowerCase() !== 'd' || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    setOpen((was) => !was);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onKey(event);
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      setOutbox(sink.pending());
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, sink]);

  if (!open) return null;
  return (
    <aside className={styles.overlay} aria-label="Debug">
      <dl className={styles.list}>
        <dt>Session</dt>
        <dd title={session.id}>{session.id}</dd>
        <dt>Version</dt>
        <dd>{session.funnelVersion}</dd>
        <dt>Variant</dt>
        <dd>
          {session.variant} ({session.variantSource})
        </dd>
        <dt>Path</dt>
        <dd>
          {visiblePath.map((id) => (
            <span key={id} className={id === currentStepId ? styles.current : undefined}>
              {id}
            </span>
          ))}
        </dd>
        <dt>stateRev</dt>
        <dd>{stateRev}</dd>
        <dt>Outbox</dt>
        <dd>{outbox}</dd>
      </dl>
      <Button size="sm" variant="ghost" onClick={onReset}>
        Reset session
      </Button>
    </aside>
  );
}
