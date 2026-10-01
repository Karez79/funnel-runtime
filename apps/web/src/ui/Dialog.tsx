// Modal dialogs on the native <dialog> + showModal() (CLAUDE.md 10.1): focus trap, Esc
// and the top layer come from the platform; enter and exit animate in CSS through
// @starting-style and `transition-behavior: allow-discrete`. React only says "open".
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import styles from './Dialog.module.css';

export function Dialog({
  open,
  onClose,
  className,
  children,
  ...aria
}: {
  open: boolean;
  /** Esc, a click on the backdrop or `close()` from inside. */
  onClose: () => void;
  className?: string | undefined;
  children: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCloseEvent = () => {
      close();
    };
    el.addEventListener('close', onCloseEvent);
    return () => {
      el.removeEventListener('close', onCloseEvent);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className ? `${styles.dialog} ${className}` : styles.dialog}
      onClick={(e) => {
        // A click on the dialog box itself (not its content) is a click on the backdrop.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      {...aria}
    >
      {children}
    </dialog>
  );
}
