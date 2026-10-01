// Screen changes animate through the View Transitions API (CLAUDE.md 10.1). The update
// runs inside `flushSync`, so React has rendered the new screen before the browser takes
// the "after" snapshot. `back` puts a class on <html> that flips the slide direction in
// CSS. Without support, or with reduced motion, the update simply runs.
import { flushSync } from 'react-dom';

const BACK_CLASS = 'back';
/** Only the latest transition may clear the class; an earlier one can finish later. */
let latest = 0;

export function withViewTransition(update: () => void, { back = false } = {}): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('startViewTransition' in document) || reduced) {
    update();
    return;
  }
  const root = document.documentElement;
  const token = ++latest;
  root.classList.toggle(BACK_CLASS, back);
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  void transition.finished.finally(() => {
    if (token === latest) root.classList.remove(BACK_CLASS);
  });
}
