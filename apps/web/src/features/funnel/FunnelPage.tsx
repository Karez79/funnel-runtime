// The live funnel (CLAUDE.md 8.1): loads or starts the session through TanStack Query,
// then runs it. The step is mirrored in the URL (`/s/:stepId`) with real history
// entries, so the browser's Back goes to the previous step and counts as `back_clicked`;
// a URL the state does not lead to is replaced by the current step.
import { initialState, sessionState } from './funnelReducer.ts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from 'react-router';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Toast, type ToastMessage } from '../../ui/Toast.tsx';
import styles from './FunnelPage.module.css';
import { FunnelView } from './FunnelView.tsx';
import {
  DEFAULT_FUNNEL_ID,
  loadSession,
  readMirror,
  startingState,
  type LoadedSession,
} from './session.ts';
import { createEventSink, createTracker } from './tracking.ts';
import { useFunnelMachine } from './useFunnelMachine.ts';
import { useStateSaver } from './useStateSaver.ts';

const EXPIRED_NOTICE = 'Your previous answers expired, starting over';

const sessionQueryKey = (variant: string | null) => ['funnel-session', DEFAULT_FUNNEL_ID, variant];

function LiveFunnel({ loaded, onReload }: { loaded: LoadedSession; onReload: () => void }) {
  const { session, funnel } = loaded.response;
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const location = useLocation();
  const { stepId: urlStepId } = useParams();
  const [start] = useState(() => startingState(session, readMirror(DEFAULT_FUNNEL_ID)));
  const [sink] = useState(() => createEventSink(loaded.response));
  const track = createTracker(sink, funnel.eventCatalog);

  const toStep = (stepId: string, replace: boolean) => {
    void navigate({ pathname: `/s/${stepId}`, search: location.search }, { replace });
  };

  const save = useStateSaver({
    funnelId: DEFAULT_FUNNEL_ID,
    sessionId: session.id,
    stateRev: session.stateRev,
    onConflict: (state) => {
      machine.dispatch({ type: 'adopt', state });
      toStep(state.currentStepId, true);
    },
    onRejected: onReload,
  });

  const machine = useFunnelMachine(() => initialState(funnel, start.state), {
    track,
    onMove: (next, { fromHistory }) => {
      save(sessionState(next));
      if (!fromHistory) toStep(next.currentStepId, false);
    },
  });
  const { state } = machine;

  // A state that was never saved (offline, tab closed mid-save) is sent once on load.
  const saveUnsaved = useEffectEvent(() => {
    if (start.unsaved) save(start.state);
  });
  useEffect(() => {
    saveUnsaved();
  }, []);

  // URL → state: the browser's Back to a visited step is a Back; anything else (first
  // load on `/`, a stale or typed URL, Forward) is replaced by the current step.
  const firstSync = useRef(true);
  const syncFromUrl = useEffectEvent(() => {
    const first = firstSync.current;
    firstSync.current = false;
    if (urlStepId === state.currentStepId) return;
    if (
      !first &&
      navigationType === NavigationType.Pop &&
      urlStepId &&
      state.history.includes(urlStepId)
    ) {
      machine.act({ type: 'back', to: urlStepId }, { fromHistory: true });
      return;
    }
    toStep(state.currentStepId, true);
  });
  useEffect(() => {
    syncFromUrl();
  }, [location.key]);

  return (
    <FunnelView
      state={state}
      act={machine.act}
      track={track}
      result={
        <h1 className={styles.title}>{funnel.steps[state.currentStepId]?.content.loadingTitle}</h1>
      }
    />
  );
}

export function FunnelPage() {
  const [search] = useSearchParams();
  const queryClient = useQueryClient();
  const variant = search.get('variant');
  const [noticeSeen, setNoticeSeen] = useState(false);
  const query = useQuery({
    queryKey: sessionQueryKey(variant),
    queryFn: () => loadSession(DEFAULT_FUNNEL_ID, search),
    staleTime: Infinity,
    retry: false,
  });
  const notice: ToastMessage | null =
    query.data?.expired && !noticeSeen ? { id: 1, text: EXPIRED_NOTICE } : null;

  return (
    <main className={styles.wrap}>
      {query.data ? (
        <LiveFunnel
          // A reload from the server (state rejected) starts the funnel over from it.
          key={`${query.data.response.session.id}:${String(query.dataUpdatedAt)}`}
          loaded={query.data}
          onReload={() => {
            void queryClient.invalidateQueries({ queryKey: sessionQueryKey(variant) });
          }}
        />
      ) : (
        <Card variant="glass" className={styles.card} aria-busy={query.isPending}>
          {query.isError && (
            <>
              <h1 className={styles.title}>We could not start the funnel</h1>
              <p className={styles.text}>Check your connection and try again.</p>
              <Button onClick={() => void query.refetch()}>Try again</Button>
            </>
          )}
        </Card>
      )}
      <Toast
        message={notice}
        onClose={() => {
          setNoticeSeen(true);
        }}
      />
    </main>
  );
}
