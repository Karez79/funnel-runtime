// Admin preview of any version (CLAUDE.md 11.1): the resolved funnel comes from the
// admin API, the state lives only in memory, and nothing is tracked or saved — no
// session is created, so "new sessions only on the active version" still holds and the
// analytics stay clean. The result is computed by the engine, since there is no server
// session to complete.
import { computeResult, VARIANTS, type ResolvedFunnel, type VariantKey } from '@funnel/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { call } from '../../lib/api.ts';
import { Card } from '../../ui/Card.tsx';
import { currentStep, initialState } from './funnelReducer.ts';
import styles from './FunnelPage.module.css';
import { FunnelView } from './FunnelView.tsx';
import { PreviewBanner } from './PreviewBanner.tsx';
import stepStyles from './steps/steps.module.css';
import { ResultScreen, type ResultOutcome } from './ResultScreen.tsx';
import { createTracker, NOOP_SINK } from './tracking.ts';
import { useFunnelMachine } from './useFunnelMachine.ts';

function PreviewFunnel({ funnel }: { funnel: ResolvedFunnel }) {
  const track = createTracker(NOOP_SINK, funnel.eventCatalog);
  const first = funnel.sequence[0] ?? '';
  const machine = useFunnelMachine(
    () => initialState(funnel, { answers: {}, history: [], currentStepId: first }),
    { track },
  );
  const { state } = machine;
  const step = currentStep(state);
  const resultId = computeResult(funnel, state.answers);
  const result = funnel.results[resultId];
  const outcome: ResultOutcome = result
    ? { status: 'ready', resultId, result }
    : { status: 'error', retry: () => undefined };
  return (
    <FunnelView
      state={state}
      act={machine.act}
      track={track}
      result={step && <ResultScreen step={step} outcome={outcome} track={track} />}
    />
  );
}

export function PreviewPage() {
  const { version = '' } = useParams();
  const [search] = useSearchParams();
  const variant: VariantKey = VARIANTS.find((v) => v === search.get('variant')) ?? 'A';
  const v = Number(version);
  const query = useQuery({
    queryKey: ['preview', v, variant],
    queryFn: () => call('previewVersion', { params: { v }, query: { variant } }),
    enabled: Number.isInteger(v) && v > 0,
    staleTime: Infinity,
  });

  return (
    <main className={styles.wrap}>
      <PreviewBanner version={version} variant={variant}>
        {VARIANTS.map((other) => (
          <Link
            key={other}
            to={{ search: `?variant=${other}` }}
            aria-current={other === variant ? 'page' : undefined}
          >
            Variant {other}
          </Link>
        ))}
      </PreviewBanner>
      {query.data ? (
        <PreviewFunnel key={`${String(v)}:${variant}`} funnel={query.data.funnel} />
      ) : (
        <Card variant="glass" className={styles.card} aria-busy={query.isPending}>
          {(query.isError || !query.isEnabled) && (
            <h1 className={stepStyles.title}>This version cannot be previewed</h1>
          )}
        </Card>
      )}
    </main>
  );
}
