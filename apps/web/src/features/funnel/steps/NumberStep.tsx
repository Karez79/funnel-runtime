// Number question (CLAUDE.md 8.2): a large field sized to its content, −/+ buttons that
// move by `input.step` within the range, and the range spelled out under the field.
// The text being typed stays local; the step reports a number, or nothing when empty.
// An empty field shows a grey placeholder number from the config (the lower bound) so it
// is clear what to type; it is only a hint: Continue stays disabled until a real value.
// −/+ on an empty field start from that number. On devices with a fine pointer the field
// takes focus at once; on touch screens it does not, so no keyboard covers the question.
import type { NumberStep as NumberQuestion } from '@funnel/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** The number an empty field suggests: the lower bound, else the upper one, else zero. */
function suggestion(min: number | undefined, max: number | undefined): number {
  return min ?? max ?? 0;
}

const FINE_POINTER = '(hover: hover) and (pointer: fine)';

export function NumberStep({ step, value, onChange, error }: StepProps<NumberQuestion>) {
  const { min, max, unit } = step.input;
  const increment = step.input.step ?? 1;
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  const placeholder = suggestion(min, max);
  const input = useRef<HTMLInputElement>(null);
  // Focus moves from the step body (FunnelView) to the field: its name is the title and
  // the helper text and range are its description, so a screen reader still hears both.
  useEffect(() => {
    if (window.matchMedia(FINE_POINTER).matches) input.current?.focus({ preventScroll: true });
  }, [step.id]);
  // Fallback width for browsers without `field-sizing` (steps.module.css).
  const digits = Math.max(1, (text || String(placeholder)).length);
  useLayoutEffect(() => {
    input.current?.style.setProperty('--digits', String(digits));
  }, [digits]);

  function set(next: number) {
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
    setText(String(clamped));
    onChange(clamped);
  }

  function nudge(direction: 1 | -1) {
    const from = typeof value === 'number' ? value : placeholder;
    set(from + direction * increment);
  }

  const range = rangeText(min, max);
  const rangeId = `${step.id}-range`;
  const helperId = `${step.id}-helper`;
  const errorId = `${step.id}-error`;
  return (
    <>
      <StepHeader step={step} describedBy={helperId} />
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
            ref={input}
            type="number"
            inputMode="numeric"
            className={styles.input}
            value={text}
            placeholder={String(placeholder)}
            min={min}
            max={max}
            step={increment}
            aria-label={step.content.title}
            aria-invalid={error !== null}
            aria-describedby={[
              step.content.helperText && helperId,
              range && rangeId,
              error !== null && errorId,
            ]
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
