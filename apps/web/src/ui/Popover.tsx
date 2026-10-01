// Details popover anchored to the element that opened it (CLAUDE.md 10.1): Popover API
// for the top layer and light dismiss, CSS anchor positioning to sit under the anchor.
// Without anchor positioning the position is computed once from getBoundingClientRect.
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import styles from './Popover.module.css';

const ANCHOR = '--popover-anchor';

export function Popover({
  anchor,
  onClose,
  label,
  children,
}: {
  /** The element to sit under; null closes the popover. */
  anchor: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!anchor) {
      if (el.matches(':popover-open')) el.hidePopover();
      return;
    }
    anchor.style.setProperty('anchor-name', ANCHOR);
    if (!CSS.supports('anchor-name', ANCHOR)) {
      const rect = anchor.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - 296)))}px`;
      el.style.top = `${String(rect.bottom + 8)}px`;
    }
    if (!el.matches(':popover-open')) el.showPopover();
    return () => {
      anchor.style.removeProperty('anchor-name');
    };
  }, [anchor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if (e instanceof ToggleEvent && e.newState === 'closed') close();
    };
    el.addEventListener('toggle', onToggle);
    return () => {
      el.removeEventListener('toggle', onToggle);
    };
  }, []);

  return (
    <div ref={ref} popover="auto" className={styles.pop} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
