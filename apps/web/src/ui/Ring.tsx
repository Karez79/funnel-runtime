// Progress ring of the journey nodes: a conic gradient whose share animates through the
// registered `--p` property (@property in tokens.css) on first paint.
import styles from './Ring.module.css';

export function Ring({ value, tone = 'a' }: { value: number | null; tone?: 'a' | 'b' }) {
  const shown = value === null ? null : Math.round(value);
  return (
    <span className={`${styles.ring} ${styles[tone]}`} style={{ '--to': shown ?? 0 }}>
      <span>{shown ?? '–'}</span>
    </span>
  );
}
