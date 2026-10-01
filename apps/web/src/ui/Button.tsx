// The one button of the product (CLAUDE.md 10): a black pill for the main action, a white
// "ghost" pill for secondary ones, `sm` for dense admin rows. Screens never style buttons.
import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  size?: 'md' | 'sm';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.btn, styles[variant], size === 'sm' && styles.sm, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}
