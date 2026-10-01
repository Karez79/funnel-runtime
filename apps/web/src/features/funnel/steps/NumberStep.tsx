// Number question (CLAUDE.md 8.2): a large field sized to its content, −/+ buttons that
// move by `input.step` within the range, and the range spelled out under the field.
// The text being typed stays local; the step reports a number, or nothing when empty.
import type { NumberStep as NumberQuestion } from '@funnel/shared';
import { useState } from 'react';
import { IconButton } from '../../../ui/IconButton.tsx';
import { StepError, StepHeader } from './StepHeader.tsx';
import type { StepProps } from './types.ts';
import styles from './steps.module.css';

function rangeText(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && max !== undefined) return `From ${min} to ${max}`;
  if (min !== undefined) return `At least ${min}`;
  if (max !== undefined) return `Up to ${max}`;
  return null;
}

export function NumberStep({ step, value, onChange, error }: StepProps<NumberQuestion>) {
  const { min, max, unit } = step.input;
  const increment = step.input.step ?? 1;
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');

  function set(next: number) {
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
    setText(String(clamped));
    onChange(clamped);
  }

  function nudge(direction: 1 | -1) {
    if (typeof value !== 'number') {
      set(min ?? 0);
      return;
    }
    set(value + direction * increment);
  }

  const range = rangeText(min, max);
  const rangeId = `${step.id}-range`;
  const errorId = `${step.id}-error`;
  return (
    <>
      <StepHeader step={step} />
      <div className={styles.number}>
        <IconButton
          icon="minus"
          size="lg"
          aria-label="Decrease"
          disabled={typeof value === 'number' && min !== undefined && value <= min}
          onClick={() => {
            nudge(-1);
          }}
        />
        <label className={styles.field}>
          <input
            type="number"
            inputMode="numeric"
            className={styles.input}
            value={text}
            min={min}
            max={max}
            step={increment}
            aria-label={step.content.title}
            aria-invalid={error !== null}
            aria-describedby={[range && rangeId, error !== null && errorId]
              .filter(Boolean)
              .join(' ')}
            onChange={(event) => {
              const raw = event.target.value;
              setText(raw);
              onChange(raw.trim() === '' ? undefined : Number(raw));
            }}
          />
          {unit && <span className={styles.unit}>{unit}</span>}
        </label>
        <IconButton
          icon="plus"
          size="lg"
          aria-label="Increase"
          disabled={typeof value === 'number' && max !== undefined && value >= max}
          onClick={() => {
            nudge(1);
          }}
        />
      </div>
      {range && (
        <p className={styles.range} id={rangeId}>
          {range}
        </p>
      )}
      <StepError id={errorId} error={error} />
    </>
  );
}
