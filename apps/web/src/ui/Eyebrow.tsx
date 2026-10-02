// Soft blue label above a screen title (reference .eyebrow / .rkicker): the intro's
// eyebrow from the config and the result's "Your recommendation" are the same piece.
import type { ReactNode } from 'react';
import styles from './Eyebrow.module.css';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className={styles.eyebrow}>{children}</span>;
}
