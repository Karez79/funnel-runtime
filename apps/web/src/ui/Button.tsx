// The one button of the product (CLAUDE.md 10): a black pill for the main action, a white
// "ghost" pill for secondary ones, `sm` for dense admin rows. Screens never style buttons.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  size?: 'md' | 'sm';
}

interface Look {
  variant?: 'primary' | 'ghost' | undefined;
  size?: 'md' | 'sm' | undefined;
  className?: string | undefined;
}

const classesOf = ({ variant = 'primary', size = 'md', className }: Look) =>
  [styles.btn, styles[variant], size === 'sm' && styles.sm, className].filter(Boolean).join(' ');

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={classesOf({ variant, size, className })} {...rest} />;
}

/** The same pill for navigation: a real link (middle-click, new tab, link role). */
export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & Look) {
  return <a className={classesOf({ variant, size, className })} {...rest} />;
}
