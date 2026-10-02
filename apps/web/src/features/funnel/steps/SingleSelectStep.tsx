// Single choice as an ARIA radio group: one tab stop (the checked option, or the first),
// arrows move and check like native radios, digits 1–9 pick directly (CLAUDE.md 8.2).
import type { SingleSelectStep as Single } from '@funnel/shared';
import type { KeyboardEvent } from 'react';
import { StepError, StepHeader } from './StepHeader.tsx';
import type { StepProps } from './types.ts';
import { useDigitKeys } from './useDigitKeys.ts';
import styles from './steps.module.css';

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);
const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft']);

export function SingleSelectStep({ step, value, onChange, error }: StepProps<Single>) {
  const { options } = step.input;
  useDigitKeys(options.length, (index) => {
    const option = options[index];
    if (option) onChange(option.value);
  });
  const checked = options.findIndex((option) => option.value === value);
  const focusable = checked === -1 ? 0 : checked;

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    // Alt+← is Back for the whole funnel.
    if (event.altKey) return;
    const delta = NEXT_KEYS.has(event.key) ? 1 : PREV_KEYS.has(event.key) ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = (focusable + delta + options.length) % options.length;
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  }

  const errorId = `${step.id}-error`;
  return (
    <>
      <StepHeader step={step} />
      <ul
        className={styles.options}
        role="radiogroup"
        aria-label={step.content.title}
        aria-describedby={error === null ? undefined : errorId}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => (
          <li key={option.value} role="none">
            <button
              type="button"
              role="radio"
              data-option=""
              aria-checked={index === checked}
              tabIndex={index === focusable ? 0 : -1}
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
