// KPI cards (CLAUDE.md 10, 11.2): the selected version's numbers with thin A/B bars, a
// count-up on load, the daily-starts sparkline in Started and, in the rate cards, the
// change against the previous published version.
import type { AnalyticsSummary } from '@funnel/shared';
import { formatCount, formatPercent, formatPoints } from '../../lib/format.ts';
import { Bars } from '../../ui/Bars.tsx';
import { Sparkline } from '../../ui/Sparkline.tsx';
import styles from './Dashboard.module.css';
import { useCountUp } from './useCountUp.ts';

type Kpis = AnalyticsSummary['kpis']['all'];
type RateKey = 'resultRate' | 'ctaCtr' | 'startedToCta';

function Value({
  value,
  suffix = '',
  digits = 0,
}: {
  value: number;
  suffix?: string;
  digits?: number;
}) {
  const shown = useCountUp(value);
  return (
    <div className={styles.kpiValue}>
      {shown.toFixed(digits)}
      {suffix}
    </div>
  );
}

function RateCard({
  label,
  rate,
  summary,
  digits,
}: {
  label: string;
  rate: RateKey;
  summary: AnalyticsSummary;
  digits: number;
}) {
  const { kpis } = summary;
  const value = kpis.all[rate];
  const previous = summary.versions.filter((v) => v.version < summary.version).at(-1);
  const before = previous?.kpis[rate] ?? null;
  const delta = value !== null && before !== null && previous ? (value - before) * 100 : null;
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiRow}>
        {value === null ? (
          <div className={styles.kpiValue}>–</div>
        ) : (
          <Value value={value * 100} suffix="%" digits={digits} />
        )}
        {delta !== null && previous && (
          <span className={delta < 0 ? `${styles.delta} ${styles.down}` : styles.delta}>
            {formatPoints(delta)} vs v{previous.version}
          </span>
        )}
      </div>
      <Bars
        a={kpis.A?.[rate] ?? null}
        b={kpis.B?.[rate] ?? null}
        labelA={kpis.A ? `A ${formatPercent(kpis.A[rate], digits)}` : ''}
        labelB={kpis.B ? `B ${formatPercent(kpis.B[rate], digits)}` : ''}
      />
    </div>
  );
}

function StartedCard({ summary }: { summary: AnalyticsSummary }) {
  const { kpis } = summary;
  const count = (k: Kpis | null) => k?.started ?? null;
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>Started</div>
      <div className={styles.kpiRow}>
        <Value value={kpis.all.started} />
        <Sparkline values={summary.daily.map((d) => d.started)} className={styles.spark} />
      </div>
      <Bars
        a={count(kpis.A)}
        b={count(kpis.B)}
        labelA={kpis.A ? `A ${formatCount(kpis.A.started)}` : ''}
        labelB={kpis.B ? `B ${formatCount(kpis.B.started)}` : ''}
      />
    </div>
  );
}

export function KpiCards({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div className={styles.kpis}>
      <StartedCard summary={summary} />
      <RateCard label="Reached result" rate="resultRate" summary={summary} digits={0} />
      <RateCard label="CTA click-through" rate="ctaCtr" summary={summary} digits={0} />
      <RateCard label="Started to CTA" rate="startedToCta" summary={summary} digits={1} />
    </div>
  );
}
