// Multi-select (CLAUDE.md 8.2): a live "2 of 3 selected" counter, and options beyond
// `maxSelections` cannot be picked (the server still validates the limit).
import type { MultiSelectStep as Multi } from '@funnel/shared';
import { StepError, StepHeader } from './StepHeader.tsx';
import type { StepProps } from './types.ts';
import { useDigitKeys } from './useDigitKeys.ts';
import styles from './steps.module.css';

export function MultiSelectStep({ step, value, onChange, error }: StepProps<Multi>) {
  const { options } = step.input;
  const selected = Array.isArray(value) ? value : [];
  const max = step.validation?.maxSelections;
  const full = max !== undefined && selected.length >= max;

  function toggle(optionValue: string) {
    if (selected.includes(optionValue)) {
      onChange(selected.filter((v) => v !== optionValue));
    } else if (!full) {
      onChange([...selected, optionValue]);
    }
  }

  useDigitKeys(options.length, (index) => {
    const option = options[index];
    if (option) toggle(option.value);
  });
  const errorId = `${step.id}-error`;
  const counterId = `${step.id}-count`;
  return (
    <>
      <StepHeader step={step} />
      <ul
        className={styles.options}
        role="group"
        aria-label={step.content.title}
        aria-describedby={error === null ? counterId : `${counterId} ${errorId}`}
      >
        {options.map((option, index) => {
          const checked = selected.includes(option.value);
          return (
            <li key={option.value}>
              <button
                type="button"
                role="checkbox"
                data-option=""
                aria-checked={checked}
                aria-disabled={!checked && full}
                className={styles.option}
                onClick={() => {
                  toggle(option.value);
                }}
              >
                {index < 9 && <kbd className={styles.key}>{index + 1}</kbd>}
                {option.label}
                <span className={`${styles.tick} ${styles.box}`} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.counter} id={counterId} aria-live="polite">
        {max === undefined
          ? `${selected.length} selected`
          : `${selected.length} of ${max} selected`}
      </p>
      <StepError id={errorId} error={error} />
    </>
  );
}
