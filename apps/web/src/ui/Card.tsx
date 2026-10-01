// Surfaces of the reference: `panel` is the frosted section panel (28px, white rim, no
// blur, CLAUDE.md 10), `card` a white card inside it, `glass` the funnel card that sits
// over the soft glow and is one of the two places allowed to use backdrop-filter.
import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: 'card' | 'panel' | 'glass';
  as?: 'section' | 'div' | 'article';
}

export function Card({ variant = 'card', as: Tag = 'section', className, ...rest }: CardProps) {
  return (
    <Tag className={className ? `${styles[variant]} ${className}` : styles[variant]} {...rest} />
  );
}
