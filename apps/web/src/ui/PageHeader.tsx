// Page head of the admin (reference `.head`): title, a muted subtitle and the page's
// filters or actions pushed to the right.
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.head}>
      <h1>{title}</h1>
      {subtitle !== undefined && <span className={styles.sub}>{subtitle}</span>}
      {children !== undefined && <div className={styles.actions}>{children}</div>}
    </div>
  );
}
