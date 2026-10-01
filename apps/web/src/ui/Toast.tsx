// Toast through the Popover API (`popover="manual"`, CLAUDE.md 10.1): it sits in the top
// layer without a portal, never steals focus and lives 5 seconds. Showing a new message
// restarts the timer. `role="status"` announces it politely.
import { useEffect, useEffectEvent, useRef } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Toast.module.css';

const LIFETIME_MS = 5000;

export interface ToastMessage {
  /** Changes for every new toast, so the same text shown twice restarts the timer. */
  readonly id: number;
  readonly text: string;
  readonly action?: {
    readonly label: string;
    readonly icon?: IconName;
    readonly onClick: () => void;
  };
}

export function Toast({ message, onClose }: { message: ToastMessage | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  const id = message?.id;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (id === undefined) {
      // Cleared by the parent while open (e.g. after its action ran).
      if (el.matches(':popover-open')) el.hidePopover();
      return;
    }
    if (!el.matches(':popover-open')) el.showPopover();
    const timer = window.setTimeout(() => {
      el.hidePopover();
      close();
    }, LIFETIME_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [id]);

  const { action } = message ?? {};
  return (
    <>
      {/* Always in the accessibility tree, so screen readers announce the new text: the
          popover itself is display:none until shown, and a live region that appears
          together with its text is often not announced. */}
      <span role="status" className={styles.srOnly}>
        {message?.text}
      </span>
      <div ref={ref} popover="manual" className={styles.toast}>
        <span>{message?.text}</span>
        {action && (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              action.onClick();
              ref.current?.hidePopover();
              onClose();
            }}
          >
            {action.icon && <Icon name={action.icon} className={styles.icon} />}
            {action.label}
          </button>
        )}
      </div>
    </>
  );
}
