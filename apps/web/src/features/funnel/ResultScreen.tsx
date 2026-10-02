// The result screen (CLAUDE.md 8.2, 8.3). The result comes from the server (live) or from
// the engine (preview); this component only renders an outcome: loading and error states
// use the titles of the result step from the config. The CTA with
// `action: expand_recommendation` turns the recommendations into a 30-day plan in place:
// week labels open above the items (`grid-template-rows: 0fr → 1fr`, no height measured
// in JS). In place, not a second list below the CTA: on a phone a list under the button
// opens off screen and repeats the lines right above it.
import { EXPAND_RECOMMENDATION, type Result, type Step } from '@funnel/shared';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Eyebrow } from '../../ui/Eyebrow.tsx';
import { Icon } from '../../ui/Icon.tsx';
import styles from './ResultScreen.module.css';
import { ResultWeek } from './ResultWeek.tsx';
import type { Track } from './tracking.ts';

export type ResultOutcome =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'ready'; readonly resultId: string; readonly result: Result };

const WEEKS_IN_PLAN = 4;

/** Week of each recommendation, in order: one per week, the rest in the last week. */
const weekOf = (index: number) => Math.min(index, WEEKS_IN_PLAN - 1);

function ReadyResult({
  resultId,
  result,
  track,
}: {
  resultId: string;
  result: Result;
  track: Track;
}) {
  const [open, setOpen] = useState(false);
  const planId = useId();
  const expands = result.cta.action === EXPAND_RECOMMENDATION.action;

  const onShown = useEffectEvent(() => {
    track('result_viewed', 'result', { result_id: resultId });
  });
  useEffect(() => {
    onShown();
  }, [resultId]);

  return (
    <>
      <Eyebrow>Your recommendation</Eyebrow>
      <h1 className={styles.title}>{result.title}</h1>
      <p className={styles.summary}>{result.summary}</p>
      <ResultWeek resultId={resultId} title="What a week could look like" />
      <ol
        className={styles.recs}
        id={planId}
        data-open={expands && open}
        aria-label={expands && open ? '30-day plan' : undefined}
      >
        {result.recommendations.map((text, i) => (
          <li key={text}>
            {expands && (i === 0 || weekOf(i) !== weekOf(i - 1)) && (
              <span className={styles.planWeek} aria-hidden={!open}>
                <strong>Week {weekOf(i) + 1}</strong>
              </span>
            )}
            <span className={styles.recIcon} aria-hidden="true">
              <Icon name="check" />
            </span>
            {text}
          </li>
        ))}
      </ol>
      <Button
        aria-expanded={expands ? open : undefined}
        aria-controls={expands ? planId : undefined}
        onClick={() => {
          track('cta_clicked', 'result', { result_id: resultId, action: result.cta.action });
          if (!expands) return;
          // Sent only if the session's catalog lists it (track checks); the values are
          // the CTA's own plus where the plan was opened from (`source`, whitelisted by
          // the v3 catalog): the result CTA is the only place that opens it.
          if (!open) {
            track('recommendation_expanded', 'result', {
              result_id: resultId,
              action: result.cta.action,
              source: EXPAND_RECOMMENDATION.source,
            });
          }
          setOpen(!open);
        }}
      >
        {result.cta.label}
      </Button>
    </>
  );
}

export function ResultScreen({
  step,
  outcome,
  track,
}: {
  step: Step;
  outcome: ResultOutcome;
  track: Track;
}) {
  const { loadingTitle, errorTitle, retryLabel } = step.content;
  switch (outcome.status) {
    case 'pending':
      return (
        <h1 className={styles.title} aria-busy="true">
          {loadingTitle}
        </h1>
      );
    case 'error':
      return (
        <div role="alert">
          <h1 className={styles.title}>{errorTitle}</h1>
          <Button onClick={outcome.retry}>{retryLabel}</Button>
        </div>
      );
    case 'ready':
      return <ReadyResult resultId={outcome.resultId} result={outcome.result} track={track} />;
  }
}
