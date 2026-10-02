// Status pills of the reference (CLAUDE.md 10): solid blue (Stored, Handled, Published),
// coral (Rejected), black (Active, Matches), white with a rim (Ignored), dashed (Draft).
import type { ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'blue' | 'coral' | 'black' | 'outline' | 'dashed';

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}
