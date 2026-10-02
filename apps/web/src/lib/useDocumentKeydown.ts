// One document-level keydown listener per caller, added once: the handler is an effect
// event, so it always sees the latest state without re-subscribing on every render.
import { useEffect, useEffectEvent } from 'react';

export function useDocumentKeydown(handler: (event: KeyboardEvent) => void): void {
  const onKey = useEffectEvent(handler);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onKey(event);
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, []);
}
