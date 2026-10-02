// A keyboard key hint ("Enter", "Esc", "1"): one look for the funnel and the admin.
import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
