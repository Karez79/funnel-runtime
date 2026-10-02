// Step details in a popover anchored to the journey node (CLAUDE.md 10.1): reached,
// completed, left here and came back for A and B, plus the branch share of a
// conditional step.
import type { AnalyticsSummary } from '@funnel/shared';
import { formatCount, formatPercent } from '../../lib/format.ts';
import { Popover } from '../../ui/Popover.tsx';
import { humanize, type JourneyStep } from './journey.ts';
import styles from './Journey.module.css';

const ROWS = [
  ['Reached', 'reached'],
  ['Completed', 'completed'],
  ['Left here', 'droppedHere'],
  ['Came back to it', 'cameBack'],
] as const;

export function StepPopover({
  step,
  anchor,
  title,
  branch,
  onClose,
}: {
  step: JourneyStep | null;
  anchor: HTMLElement | null;
  title: string | null;
  branch: AnalyticsSummary['branches'][number] | null;
  onClose: () => void;
}) {
  const cell = (v: number | undefined) => (v === undefined ? '–' : formatCount(v));
  return (
    <Popover
      anchor={step ? anchor : null}
      onClose={onClose}
      label={step ? humanize(step.stepId) : 'Step'}
    >
      {step && (
        <>
          <h3 className={styles.popTitle}>{humanize(step.stepId)}</h3>
          {title && <p className={styles.popQuestion}>{title}</p>}
          <dl className={styles.popGrid}>
            <div className={styles.popRow}>
              <dt className={styles.popHead}>Sessions</dt>
              <dd className={styles.popHead}>A</dd>
              <dd className={styles.popHead}>B</dd>
            </div>
            {ROWS.map(([label, key]) => (
              <div key={key} className={styles.popRow}>
                <dt>{label}</dt>
                <dd className={styles.popA}>{cell(step.metrics.A?.[key])}</dd>
                <dd className={styles.popB}>{cell(step.metrics.B?.[key])}</dd>
              </div>
            ))}
          </dl>
          {branch && (
            <p className={styles.popNote}>
              Shown to {formatPercent(branch.share)} of the {formatCount(branch.parentReached)}{' '}
              sessions that reached {humanize(branch.parentStepId)}.
            </p>
          )}
        </>
      )}
    </Popover>
  );
}
