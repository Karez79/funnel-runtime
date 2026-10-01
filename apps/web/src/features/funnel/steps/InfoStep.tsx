import type { Step } from '@funnel/shared';
import styles from './steps.module.css';

export function InfoStep({ step }: { step: Step }) {
  const { eyebrow, title, body } = step.content;
  return (
    <>
      {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
      <h1 className={styles.title}>{title}</h1>
      {body && <p className={styles.helper}>{body}</p>}
    </>
  );
}
