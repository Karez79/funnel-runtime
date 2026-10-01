// Round icon button of the reference (`.ib`): translucent white with a thin rim, or dark
// for the one emphasised action. The accessible name is required, the icon is decorative.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  'aria-label': string;
  /** An icon of the set, or text such as "−" / "+". */
  icon: IconName | { text: ReactNode };
  size?: 'sm' | 'md' | 'lg';
  dark?: boolean;
}

export function IconButton({
  icon,
  size = 'md',
  dark = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const classes = [styles.ib, styles[size], dark && styles.dark, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {typeof icon === 'string' ? <Icon name={icon} /> : icon.text}
    </button>
  );
}
