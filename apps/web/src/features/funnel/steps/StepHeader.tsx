import type { Step } from '@funnel/shared';
import styles from './steps.module.css';

/** Title and helper text of a step, straight from the config. */
export function StepHeader({ step, describedBy }: { step: Step; describedBy?: string }) {
  const { title, helperText } = step.content;
  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      {helperText && (
        <p className={styles.helper} id={describedBy}>
          {helperText}
        </p>
      )}
    </>
  );
}

/** Validation message: announced when it appears (8.2). */
export function StepError({ id, error }: { id: string; error: string | null }) {
  if (error === null) return null;
  return (
    <p className={styles.error} id={id} role="alert">
      {error}
    </p>
  );
}
