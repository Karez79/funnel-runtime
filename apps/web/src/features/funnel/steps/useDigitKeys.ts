// Digits 1–9 pick the n-th option of a choice step (CLAUDE.md 8.2). Typing in a field is
// left alone, and so is any shortcut with a modifier.
import { useEffect, useEffectEvent } from 'react';

export function useDigitKeys(count: number, onDigit: (index: number) => void): void {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    const digit = Number(event.key);
    if (!Number.isInteger(digit) || digit < 1 || digit > Math.min(count, 9)) return;
    event.preventDefault();
    onDigit(digit - 1);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handle(event);
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, []);
}
