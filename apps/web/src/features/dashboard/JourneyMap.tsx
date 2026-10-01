// The Funnel journey (CLAUDE.md 10, 11.2): steps of the shown sequence in white columns,
// each with a pass-rate ring and "N reached". The step with the most drop-offs is bold
// and coral with a dashed curve; the rest are muted. Conditional steps carry a dashed
// coral outline and their condition. The last column holds the result tiles. A click on
// a step opens its A/B details in a popover anchored to it.
import type { AnalyticsSummary } from '@funnel/shared';
import { useRef, useState } from 'react';
import { formatCount } from '../../lib/format.ts';
import { Icon } from '../../ui/Icon.tsx';
import { Ring } from '../../ui/Ring.tsx';
import { cx } from '../../ui/cx.ts';
import {
  biggestDrop,
  humanize,
  journeyColumns,
  metricsOf,
  type JourneyStep,
  type ShownVariant,
} from './journey.ts';
import styles from './Journey.module.css';
import { JourneyLinks } from './JourneyLinks.tsx';
import { StepPopover } from './StepPopover.tsx';

const RESULT_TILES = 4;

function ResultTiles({ summary, variant }: { summary: AnalyticsSummary; variant: ShownVariant }) {
  const kpis = variant === 'all' ? summary.kpis.all : summary.kpis[variant];
  const counted = summary.results
    .map((r) => ({
      id: r.resultId,
      n: (variant === 'all' ? r.sessions.all : r.sessions[variant]) ?? 0,
    }))
    .sort((x, y) => y.n - x.n);
  const shown =
    counted.length <= RESULT_TILES
      ? counted
      : [
          ...counted.slice(0, RESULT_TILES - 1),
          { id: 'Other results', n: counted.slice(RESULT_TILES - 1).reduce((t, r) => t + r.n, 0) },
        ];
  return (
    <div className={styles.results}>
      <div className={cx(styles.tile, styles.main)} data-journey-target="result">
        Reached result<b>{formatCount(kpis?.reachedResult ?? 0)}</b>
      </div>
      <div className={styles.tile}>
        CTA clicked<b>{formatCount(kpis?.clickedCta ?? 0)}</b>
      </div>
      {shown.map((r) => (
        <div key={r.id} className={styles.tile}>
          {humanize(r.id)}
          <b>{formatCount(r.n)}</b>
        </div>
      ))}
    </div>
  );
}

function StepNode({
  step,
  variant,
  hot,
  expanded,
  onOpen,
}: {
  step: JourneyStep;
  variant: ShownVariant;
  hot: boolean;
  expanded: boolean;
  onOpen: (el: HTMLElement) => void;
}) {
  const m = metricsOf(step, variant);
  const pass = m?.passRate ?? null;
  return (
    <button
      type="button"
      className={cx(styles.node, hot && styles.hot, step.condition !== null && styles.cond)}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      data-journey-target="step"
      data-hot={hot}
      onClick={(e) => {
        onOpen(e.currentTarget);
      }}
    >
      <Ring value={pass === null ? null : pass * 100} tone={hot || variant === 'B' ? 'b' : 'a'} />
      <span className={styles.nodeText}>
        {humanize(step.stepId)}
        <small>{formatCount(m?.reached ?? 0)} reached</small>
        {hot && <small className={styles.loss}>{formatCount(m?.droppedHere ?? 0)} left here</small>}
        {step.condition !== null && <span className={styles.tag}>{step.condition}</span>}
      </span>
      {hot ? (
        <span className={styles.more} aria-hidden="true">
          ···
        </span>
      ) : (
        <span className={styles.ok} aria-hidden="true">
          <Icon name="check2" />
        </span>
      )}
      <span className={styles.cbtn} aria-hidden="true">
        <Icon name="chart" />
      </span>
    </button>
  );
}

export function JourneyMap({
  summary,
  variant,
  titles,
}: {
  summary: AnalyticsSummary;
  variant: ShownVariant;
  /** Step titles of the version (questions), for the popover. */
  titles: Readonly<Record<string, string>>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ stepId: string; anchor: HTMLElement } | null>(null);
  const columns = journeyColumns(summary.steps);
  const hot = biggestDrop(summary.steps, variant);
  const openStep = open ? summary.steps.find((s) => s.stepId === open.stepId) : undefined;

  return (
    <div className={styles.journey} ref={root}>
      <JourneyLinks
        root={root}
        version={`${String(summary.version)}:${variant}:${hot ?? ''}:${String(columns.length)}`}
      />
      {columns.map((column) => (
        <div key={column.label} className={styles.col} data-journey-col>
          <div className={styles.colbox} data-journey-box>
            {column.steps.map((step) => (
              <StepNode
                key={step.stepId}
                step={step}
                variant={variant}
                hot={step.stepId === hot}
                expanded={open?.stepId === step.stepId}
                onOpen={(anchor) => {
                  setOpen(open?.stepId === step.stepId ? null : { stepId: step.stepId, anchor });
                }}
              />
            ))}
          </div>
          <div className={styles.cap}>{column.label}</div>
        </div>
      ))}
      <div className={styles.col} data-journey-col>
        <ResultTiles summary={summary} variant={variant} />
        <div className={styles.cap}>Results</div>
      </div>
      <StepPopover
        step={openStep ?? null}
        anchor={open?.anchor ?? null}
        title={openStep ? (titles[openStep.stepId] ?? null) : null}
        branch={summary.branches.find((b) => b.stepId === openStep?.stepId) ?? null}
        onClose={() => {
          setOpen(null);
        }}
      />
    </div>
  );
}
