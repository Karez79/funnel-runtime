// Inline SVG sparkline with a gradient fill (reference: Started KPI). Values are scaled
// into the box; one value or none draws nothing rather than a misleading flat line.
import { useId } from 'react';
import styles from './Sparkline.module.css';

const W = 96;
const H = 34;
const PAD = 3;

export function Sparkline({
  values,
  className,
}: {
  values: readonly number[];
  className?: string | undefined;
}) {
  const id = useId();
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - PAD - (v / max) * (H - 2 * PAD);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${points.join(' L')}`;
  return (
    <svg
      className={className ? `${styles.spark} ${className}` : styles.spark}
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className={styles.stopTop} />
          <stop offset="1" className={styles.stopBottom} />
        </linearGradient>
      </defs>
      <path d={`${line} L${String(W)} ${String(H)} L0 ${String(H)}Z`} fill={`url(#${id})`} />
      <path d={line} className={styles.line} />
    </svg>
  );
}
