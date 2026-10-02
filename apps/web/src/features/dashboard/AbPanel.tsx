// A/B on the main metric, started → CTA (CLAUDE.md 11.2): half donuts in the variant
// colors with the 95% Wilson interval, and the verdict exactly as the aggregator words
// it. Significance is the shared `isSignificant`, the same test the verdict uses.
import { isSignificant, type AnalyticsSummary } from '@funnel/shared';
import { formatCount } from '../../lib/format.ts';
import { HalfDonut } from '../../ui/HalfDonut.tsx';
import styles from './Dashboard.module.css';

type Experiment = AnalyticsSummary['experiment'];

function Gauge({ variant, p }: { variant: 'A' | 'B'; p: Experiment['A'] }) {
  const ci = p.ci
    ? `95% CI ${(p.ci[0] * 100).toFixed(0)}–${(p.ci[1] * 100).toFixed(0)}%`
    : 'No sessions yet';
  return (
    <HalfDonut
      percent={p.rate === null ? null : p.rate * 100}
      tone={variant === 'A' ? 'a' : 'b'}
      count={p.conversions}
      countTitle="Sessions that clicked the CTA"
    >
      <div>
        Variant {variant}, {formatCount(p.conversions)} of {formatCount(p.sessions)}
      </div>
      <div className={styles.ci}>{ci}</div>
    </HalfDonut>
  );
}

export function AbPanel({ experiment }: { experiment: Experiment }) {
  const significant = isSignificant(experiment.pValue);
  const enough = experiment.A.sessions > 0 && experiment.B.sessions > 0;
  const badge = !enough ? 'Not enough data' : significant ? 'Significant' : 'Not significant';
  const needed =
    !significant && experiment.requiredPerVariant !== null
      ? ` About ${formatCount(experiment.requiredPerVariant)} sessions per variant are needed to confirm a difference of this size.`
      : '';
  return (
    <>
      <div className={styles.gauges}>
        <Gauge variant="A" p={experiment.A} />
        <Gauge variant="B" p={experiment.B} />
      </div>
      <div className={styles.verdict}>
        <span className={significant ? `${styles.badge} ${styles.badgeOk}` : styles.badge}>
          {badge}
        </span>
        <span>
          {experiment.verdict}
          {needed}
        </span>
      </div>
    </>
  );
}
