// Thick half donut of the A/B panel (reference: "Support Ticket Journey" gauges): the arc
// fills to `percent` once on load, a white badge at the left end carries a count and the
// value sits in the middle. Variant A is always blue, B always coral (CLAUDE.md 10).
import type { ReactNode } from 'react';
import styles from './HalfDonut.module.css';

const ARC = 'M30 110a80 80 0 01160 0';

export function HalfDonut({
  percent,
  tone,
  count,
  countTitle,
  children,
}: {
  /** 0..100; null shows an empty track and a dash. */
  percent: number | null;
  tone: 'a' | 'b';
  count: number;
  countTitle: string;
  /** Caption lines under the gauge. */
  children: ReactNode;
}) {
  return (
    <figure className={styles.gauge}>
      <span className={styles.count} title={countTitle}>
        {count}
      </span>
      <svg viewBox="0 0 220 122" aria-hidden="true">
        <path className={`${styles.track} ${styles[tone]}`} d={ARC} />
        <path
          className={`${styles.arc} ${styles[tone]}`}
          style={{ '--v': percent ?? 0 }}
          d={ARC}
          pathLength={100}
        />
        <text x="110" y="104" textAnchor="middle" className={styles.value}>
          {percent === null ? '–' : `${percent.toFixed(1)}%`}
        </text>
      </svg>
      <figcaption>{children}</figcaption>
    </figure>
  );
}
