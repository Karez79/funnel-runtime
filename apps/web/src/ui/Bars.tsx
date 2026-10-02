// The two thin A/B bars under a KPI (reference `.bars`): widths are relative to the
// larger value so the difference reads at a glance; labels carry the exact numbers.
import styles from './Bars.module.css';

export function Bars({
  a,
  b,
  labelA,
  labelB,
}: {
  a: number | null;
  b: number | null;
  labelA: string;
  labelB: string;
}) {
  const max = Math.max(a ?? 0, b ?? 0);
  const width = (v: number | null) =>
    max === 0 || v === null ? '0%' : `${String((v / max) * 100)}%`;
  return (
    <div>
      <div className={styles.bars} aria-hidden="true">
        <div>
          <i className={styles.a} style={{ width: width(a) }} />
        </div>
        <div>
          <i className={styles.b} style={{ width: width(b) }} />
        </div>
      </div>
      <div className={styles.labels}>
        <span>{labelA}</span>
        <span>{labelB}</span>
      </div>
    </div>
  );
}
