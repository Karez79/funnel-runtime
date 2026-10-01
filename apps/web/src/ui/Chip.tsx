// Filter chip of the reference (`.chip`): translucent pill, black when on. A chip that
// toggles exposes `aria-pressed`; a chip that opens a menu or picker leaves it out.
import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Chip.module.css';
import { VisuallyHidden } from './VisuallyHidden.tsx';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean;
  icon?: IconName;
}

export function Chip({
  on = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ChipProps) {
  const classes = [styles.chip, on && styles.on, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} className={styles.icon} />}
      {children}
    </button>
  );
}

/** A select styled as a chip: native, so keyboard and screen readers work for free. */
export function ChipSelect({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon?: IconName;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.chip}>
      {icon && <Icon name={icon} className={styles.icon} />}
      <VisuallyHidden>{label}</VisuallyHidden>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
