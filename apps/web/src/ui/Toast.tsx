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
    if (!el || id === undefined) return;
    if (!el.matches(':popover-open')) el.showPopover();
    const timer = window.setTimeout(() => {
      el.hidePopover();
      close();
    }, LIFETIME_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [id]);

  return (
    <div ref={ref} popover="manual" role="status" className={styles.toast}>
      <span>{message?.text}</span>
      {message?.action && (
        <button type="button" className={styles.action} onClick={message.action.onClick}>
          {message.action.icon && <Icon name={message.action.icon} className={styles.icon} />}
          {message.action.label}
        </button>
      )}
    </div>
  );
}
