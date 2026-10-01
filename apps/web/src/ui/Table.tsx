// Tables of the admin (reference `.tbl`): no backing card, small grey column heads,
// hairline rows, tabular numbers. `numeric` right-aligns a cell or head.
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import styles from './Table.module.css';

export function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.tbl}>
      <table aria-label={label}>{children}</table>
    </div>
  );
}

const cls = (numeric: boolean, className: string | undefined) =>
  [numeric && styles.n, className].filter(Boolean).join(' ') || undefined;

export function Th({
  numeric = false,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={cls(numeric, className)} {...rest} />;
}

export function Td({
  numeric = false,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cls(numeric, className)} {...rest} />;
}

/** Muted tabular text inside a cell (times, ids). */
export function Mono({ children }: { children: ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}
