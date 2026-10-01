// The round icon button look for elements that are not <button>s (navigation links in
// the admin rail and top bar), taken from IconButton's own styles so it lives once.
import styles from './IconButton.module.css';
import { cx } from './cx.ts';

export function iconButtonClass(dark = false): string {
  return cx(styles.ib, styles.md, dark && styles.dark);
}
