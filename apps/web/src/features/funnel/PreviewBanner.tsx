import type { VariantKey } from '@funnel/shared';
import type { ReactNode } from 'react';
import styles from './PreviewBanner.module.css';

/** States plainly that nothing here is tracked (CLAUDE.md 11.1). */
export function PreviewBanner({
  version,
  variant,
  children,
}: {
  /** The raw route parameter, so a malformed one is shown as typed. */
  version: string;
  variant: VariantKey;
  children: ReactNode;
}) {
  return (
    <div className={styles.banner} role="status">
      <strong>Preview, not tracked</strong>
      <span>
        Version {version}, variant {variant}
      </span>
      <nav className={styles.switch} aria-label="Variant">
        {children}
      </nav>
    </div>
  );
}
