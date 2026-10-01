import type { SingleSelectStep as Single } from '@funnel/shared';
import { StepError, StepHeader } from './StepHeader.tsx';
import type { StepProps } from './types.ts';
import { useDigitKeys } from './useDigitKeys.ts';
import styles from './steps.module.css';

export function SingleSelectStep({ step, value, onChange, error }: StepProps<Single>) {
  const { options } = step.input;
  useDigitKeys(options.length, (index) => {
    const option = options[index];
    if (option) onChange(option.value);
  });
  const errorId = `${step.id}-error`;
  return (
    <>
      <StepHeader step={step} />
      <ul
        className={styles.options}
        role="radiogroup"
        aria-label={step.content.title}
        aria-describedby={error === null ? undefined : errorId}
      >
        {options.map((option, index) => (
          <li key={option.value}>
            <button
              type="button"
              role="radio"
              data-option=""
              aria-checked={value === option.value}
              className={styles.option}
              onClick={() => {
                onChange(option.value);
              }}
            >
              {index < 9 && <kbd className={styles.key}>{index + 1}</kbd>}
              {option.label}
              <span className={styles.tick} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <StepError id={errorId} error={error} />
    </>
  );
}
