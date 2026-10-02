// KPI count-up: the one load moment of the dashboard (CLAUDE.md 10). Eases from 0 to the
// value once per value; reduced motion shows the value at once.
import { useEffect, useState } from 'react';

const DURATION_MS = 900;

export function useCountUp(target: number): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const frame = requestAnimationFrame(() => {
        setShown(target);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / DURATION_MS);
      setShown(target * (1 - (1 - k) ** 3));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target]);
  return shown;
}
