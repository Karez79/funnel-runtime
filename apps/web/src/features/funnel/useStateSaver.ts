// Saving the session state (CLAUDE.md 8.1). Every step change is saved at once; answers
// only change on a step change (valid answers only), so there is nothing to debounce.
// Saves of one session run one after another (a TanStack mutation scope), each with the
// revision of the previous success as `baseRev`. A 409 means another tab or device moved
// on: the server state is adopted and saves queued before it are dropped. A network
// failure leaves the mirror dirty, so the next save or the next visit sends it again.
import { DomainError, type SessionState } from '@funnel/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { call, errorDetails } from '../../lib/api.ts';
import { clearMirror, writeMirror } from './session.ts';

const NETWORK_RETRIES = 2;

interface SaverOptions {
  readonly funnelId: string;
  readonly sessionId: string;
  readonly stateRev: number;
  /** The server has a newer state (409): show it instead of ours. */
  readonly onConflict: (state: SessionState) => void;
  /** The server rejected the state or lost the session: reload it from the server. */
  readonly onRejected: () => void;
}

export function useStateSaver({
  funnelId,
  sessionId,
  stateRev,
  onConflict,
  onRejected,
}: SaverOptions) {
  const rev = useRef(stateRev);
  /** Bumped by a conflict: queued saves of an older epoch are dropped. */
  const epoch = useRef(0);
  const latest = useRef<SessionState | null>(null);

  const mutation = useMutation({
    scope: { id: `session-state:${sessionId}` },
    retry: (count, error) =>
      count < NETWORK_RETRIES && error instanceof DomainError && error.code === 'unavailable',
    mutationFn: ({ state, at }: { state: SessionState; at: number }) =>
      at === epoch.current
        ? call('saveState', { params: { id: sessionId }, body: { state, baseRev: rev.current } })
        : Promise.resolve(null),
    onSuccess: (saved, { state }) => {
      if (!saved || !latest.current) return;
      rev.current = saved.stateRev;
      // A newer state may already be queued behind this one: it stays dirty until saved.
      writeMirror(funnelId, {
        sessionId,
        state: latest.current,
        stateRev: saved.stateRev,
        dirty: latest.current !== state,
      });
    },
    onError: (error) => {
      const conflict = errorDetails('saveState', 'conflict', error);
      if (conflict) {
        epoch.current += 1;
        rev.current = conflict.stateRev;
        latest.current = conflict.state;
        writeMirror(funnelId, {
          sessionId,
          state: conflict.state,
          stateRev: conflict.stateRev,
          dirty: false,
        });
        onConflict(conflict.state);
        return;
      }
      if (error instanceof DomainError && error.code !== 'unavailable') {
        epoch.current += 1;
        clearMirror(funnelId);
        onRejected();
      }
    },
  });

  function save(state: SessionState) {
    latest.current = state;
    writeMirror(funnelId, { sessionId, state, stateRev: rev.current, dirty: true });
    mutation.mutate({ state, at: epoch.current });
  }

  return save;
}
