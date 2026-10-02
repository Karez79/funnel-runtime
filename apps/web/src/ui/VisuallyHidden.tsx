// Text for screen readers only (a label of an icon-only column or control).
import type { ReactNode } from 'react';
import styles from './VisuallyHidden.module.css';

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>;
}
