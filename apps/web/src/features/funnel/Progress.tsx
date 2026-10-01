// Segmented progress (CLAUDE.md 8.2): one segment per visible question, passed ones
// black, the current one blue. A branching answer adds or removes segments, and a new
// segment grows in (`@starting-style`) so the change of the total reads as movement.
import type { Progress as ProgressValue } from '@funnel/shared';
import styles from './Progress.module.css';

export function Progress({ value, done }: { value: ProgressValue; done: boolean }) {
  const { index, total } = value;
  const label = done ? 'Done' : index === 0 ? '' : `${index} of ${total}`;
  return (
    <div className={styles.progress}>
      <div
        className={styles.dots}
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done ? total : index}
        aria-valuetext={label || `0 of ${total}`}
      >
        {Array.from({ length: total }, (_, i) => (
          <i
            key={i}
            className={
              done || i < index - 1 ? styles.done : i === index - 1 ? styles.now : undefined
            }
          />
        ))}
      </div>
      <span className={styles.count} aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
