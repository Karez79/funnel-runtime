// Tables of the admin (reference `.tbl`): no backing card, small grey column heads,
// hairline rows, tabular numbers. `numeric` right-aligns a cell or head.
// A table wider than its panel scrolls inside it (CLAUDE.md 10, 360px without page
// scroll); the edge where more columns hide fades out under a soft shadow, so a cut-off
// column reads as "scroll for more" instead of looking clipped. The flags are set on the element
// directly: scrolling must not re-render the table. A scroller with hidden columns is a
// named, focusable region, so keyboard users can scroll it too (WCAG 2.1.1, axe
// `scrollable-region-focusable`); a table that fits stays out of the tab order.
// `stack` is for tables whose key column (a status, an action) must not hide behind the
// scroll on a phone: in a narrow panel each row becomes a block of "label: value" lines,
// the labels coming from each cell's `label`. `wrap` lets a text cell break lines.
import {
  useEffect,
  useRef,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import styles from './Table.module.css';

function useOverflowEdges(label: string) {
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
      if (el.scrollWidth - el.clientWidth > 1) {
        el.tabIndex = 0;
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', label);
      } else {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
      }
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
  }, [label]);
  return { frameRef, ref };
}

export function Table({
  label,
  stack = false,
  children,
}: {
  label: string;
  stack?: boolean;
  children: ReactNode;
}) {
  const { frameRef, ref } = useOverflowEdges(label);
  return (
    <div ref={frameRef} className={stack ? `${styles.frame} ${styles.stack}` : styles.frame}>
      <div ref={ref} className={styles.tbl}>
        <table aria-label={label}>{children}</table>
      </div>
    </div>
  );
}

const cls = (numeric: boolean, className: string | undefined, wrap = false) =>
  [numeric && styles.n, wrap && styles.wrap, className].filter(Boolean).join(' ') || undefined;

export function Th({
  numeric = false,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={cls(numeric, className)} {...rest} />;
}

export function Td({
  numeric = false,
  wrap = false,
  label,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean;
  wrap?: boolean;
  /** Column name shown next to the value when a `stack` table stacks its rows. */
  label?: string;
}) {
  return <td className={cls(numeric, className, wrap)} data-label={label} {...rest} />;
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
