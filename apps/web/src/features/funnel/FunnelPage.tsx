// The live funnel (CLAUDE.md 8.1): loads or starts the session through TanStack Query,
// then runs it. The step is mirrored in the URL (`/s/:stepId`) with real history
// entries, so the browser's Back goes to the previous step and counts as `back_clicked`;
// a URL the state does not lead to is replaced by the current step.
import { stepBack } from '@funnel/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { call } from '../../lib/api.ts';
import { DebugOverlay } from './DebugOverlay.tsx';
import { currentStep, initialState, sessionState, visiblePathOf } from './funnelReducer.ts';
import styles from './FunnelPage.module.css';
import stepStyles from './steps/steps.module.css';
import { FunnelView } from './FunnelView.tsx';
import { ResultScreen, type ResultOutcome } from './ResultScreen.tsx';
import {
  DEFAULT_FUNNEL_ID,
  forgetSession,
  loadSession,
  readMirror,
  startingState,
  type LoadedSession,
} from './session.ts';
import { createEventSink, createTracker } from './tracking.ts';
import { useFunnelMachine } from './useFunnelMachine.ts';
import { sessionScope, useStateSaver } from './useStateSaver.ts';

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

  // Each entry remembers the step it was entered from, so the card Back knows whether the
  // previous browser entry is the step it goes back to (and not, say, the admin).
  const toStep = (stepId: string, replace: boolean, from?: string) => {
    void navigate(
      { pathname: `/s/${stepId}`, search: location.search },
      { replace, state: from === undefined ? null : { from } },
    );
  };

  const { save, savedRev } = useStateSaver({
    funnelId: DEFAULT_FUNNEL_ID,
    sessionId: session.id,
    stateRev: session.stateRev,
    onConflict: (state) => {
      machine.dispatch({ type: 'adopt', state });
      toStep(state.currentStepId, true);
    },
    onRejected: onReload,
  });

  // The server computes the result (6.3); it runs after the saves queued before it.
  const complete = useMutation({
    scope: sessionScope(session.id),
    mutationFn: () => call('completeSession', { params: { id: session.id } }),
  });
  const completeIfResult = (stepId: string) => {
    if (funnel.steps[stepId]?.type === 'result') complete.mutate();
  };

  const machine = useFunnelMachine(() => initialState(funnel, start.state), {
    track,
    onMove: (next, { url = 'push' }) => {
      save(sessionState(next));
      completeIfResult(next.currentStepId);
      const there = window.location.pathname === `/s/${next.currentStepId}`;
      // After a browser Back the URL is normally there already; if the user moved through
      // history again meanwhile (the transition is async), the URL follows the state.
      if (url === 'push') toStep(next.currentStepId, false, state.currentStepId);
      else if (url === 'replace' || !there) toStep(next.currentStepId, true);
    },
  });
  const { state } = machine;

  // A state that was never saved (offline, tab closed mid-save) is sent once on load,
  // and a session reopened on its result asks the server for it again.
  const onLoad = useEffectEvent(() => {
    if (start.unsaved) save(start.state);
    completeIfResult(start.state.currentStepId);
  });
  useEffect(() => {
    onLoad();
  }, []);

  const outcome: ResultOutcome = complete.isSuccess
    ? { status: 'ready', resultId: complete.data.resultId, result: complete.data.result }
    : complete.isError
      ? {
          status: 'error',
          retry: () => {
            complete.mutate();
          },
        }
      : { status: 'pending' };
  const step = currentStep(state);

  // Back in the card is the browser's Back when the previous entry is the step it goes
  // back to, so the funnel's history and the browser's stay one stack; the POP below does
  // the move. Otherwise (tab opened on a step, entry replaced) it replaces the entry.
  // Nothing starts while a move is rendering.
  const expectBack = useRef(false);
  const goBack = () => {
    if (machine.isMoving() || expectBack.current) return;
    const entry: unknown = location.state;
    const from = typeof entry === 'object' && entry !== null && 'from' in entry ? entry.from : null;
    if (from !== null && from === stepBack(state.history)?.stepId) {
      expectBack.current = true;
      void navigate(-1);
    } else {
      machine.act({ type: 'back' }, { url: 'replace' });
    }
  };

  // URL → state: the browser's Back to a visited step is a Back; a Back started in the
  // card that landed on another URL still goes one step back; anything else (first load
  // on `/`, a stale or typed URL, Forward) is replaced by the current step.
  const firstSync = useRef(true);
  const syncFromUrl = useEffectEvent(() => {
    const first = firstSync.current;
    const expected = expectBack.current;
    firstSync.current = false;
    expectBack.current = false;
    if (urlStepId === state.currentStepId) return;
    const pop = !first && navigationType === NavigationType.Pop;
    if (pop && urlStepId && state.history.includes(urlStepId)) {
      machine.act({ type: 'back', to: urlStepId }, { url: 'none' });
      return;
    }
    if (pop && expected) {
      machine.act({ type: 'back' }, { url: 'replace' });
      return;
    }
    toStep(state.currentStepId, true);
  });
  useEffect(() => {
    syncFromUrl();
  }, [location.key]);

  return (
    <>
      <FunnelView
        state={state}
        act={machine.act}
        onBack={goBack}
        track={track}
        result={step && <ResultScreen step={step} outcome={outcome} track={track} />}
      />
      <DebugOverlay
        session={session}
        visiblePath={visiblePathOf(state)}
        currentStepId={state.currentStepId}
        stateRev={savedRev}
        sink={sink}
        onReset={() => {
          forgetSession(DEFAULT_FUNNEL_ID);
          window.location.assign(`/${location.search}`);
        }}
      />
    </>
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
              <h1 className={stepStyles.title}>We could not start the funnel</h1>
              <p className={stepStyles.helper}>Check your connection and try again.</p>
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
