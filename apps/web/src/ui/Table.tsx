// Tables of the admin (reference `.tbl`): no backing card, small grey column heads,
// hairline rows, tabular numbers. `numeric` right-aligns a cell or head.
// A table wider than its panel scrolls inside it (CLAUDE.md 10, 360px without page
// scroll); the edge where more columns hide fades out under a soft shadow, so a cut-off
// column reads as "scroll for more" instead of looking clipped. The flags are set on the element
// directly: scrolling must not re-render the table.
import {
  useEffect,
  useRef,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import styles from './Table.module.css';

function useOverflowEdges() {
  const frameRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    const el = ref.current;
    if (!frame || !el) return;
    const update = () => {
      // 1px of slack for fractional widths at non-integer zoom.
      frame.toggleAttribute('data-more-start', el.scrollLeft > 1);
      frame.toggleAttribute('data-more-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const table = el.firstElementChild;
    if (table) observer.observe(table);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
  return { frameRef, ref };
}

export function Table({ label, children }: { label: string; children: ReactNode }) {
  const { frameRef, ref } = useOverflowEdges();
  return (
    <div ref={frameRef} className={styles.frame}>
      <div ref={ref} className={styles.tbl}>
        <table aria-label={label}>{children}</table>
      </div>
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

/** Variant label in its color: A blue, B coral (CLAUDE.md 10). */
export function VariantText({ variant }: { variant: 'A' | 'B' | null }) {
  if (variant === null) return <span className={styles.mono}>–</span>;
  return <span className={variant === 'A' ? styles.vA : styles.vB}>{variant}</span>;
}
