// The cut-out in a panel's top edge with concave corners (reference: avatar strip). It
// holds round "avatars" with count badges; pressing one toggles a filter.
import type { ReactNode } from 'react';
import styles from './Notch.module.css';

export function Notch({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.notch} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function NotchButton({
  short,
  title,
  count,
  pressed,
  muted = false,
  disabled = false,
  tone = 'a',
  onClick,
}: {
  /** One or two letters inside the circle. */
  short: string;
  /** Accessible name, e.g. "linkedin, 41 sessions". */
  title: string;
  count: number;
  pressed: boolean;
  muted?: boolean;
  disabled?: boolean;
  /** Badge color: the variant the counts belong to (B is always coral). */
  tone?: 'a' | 'b';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.src}
      aria-pressed={pressed}
      disabled={disabled}
      aria-label={title}
      title={title}
      onClick={onClick}
    >
      <span className={muted ? `${styles.av} ${styles.muted}` : styles.av}>{short}</span>
      <span
        className={
          muted ? `${styles.n} ${styles.w}` : tone === 'b' ? `${styles.n} ${styles.nb}` : styles.n
        }
      >
        {count}
      </span>
    </button>
  );
}
