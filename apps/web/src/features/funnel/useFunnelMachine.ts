// Runs funnel actions (CLAUDE.md 8): the pure reducer decides the next state; a move to
// another step is wrapped in a view transition (left on Continue, right on Back) and its
// events and side effects (save, URL) run with the new state. Live and preview funnels
// share this; they differ only in `track` and `onMove`.
// One move at a time: the transition renders the new step asynchronously, and any action
// before that (key repeat, a digit right after Enter, a click on an option) would be
// computed from the step the user is leaving. Actions arriving meanwhile are dropped, and
// the transition commits exactly the state that was saved and tracked (`set`), so the
// screen, the saved state, the URL and the events always describe the same step.
import { useReducer, useRef } from 'react';
import { withViewTransition } from '../../lib/viewTransition.ts';
import {
  funnelReducer,
  transitionEvents,
  type FunnelAction,
  type FunnelState,
} from './funnelReducer.ts';
import type { Track } from './tracking.ts';

export interface MoveOptions {
  /**
   * What the move does to the URL: a new history entry (default), a replaced entry, or
   * nothing because it follows the browser's own Back and the URL is already there.
   */
  readonly url?: 'push' | 'replace' | 'none';
}

interface MachineOptions {
  readonly track: Track;
  /** Runs inside the transition, after the new step is rendered. */
  readonly onMove?: (next: FunnelState, options: MoveOptions) => void;
}

export function useFunnelMachine(init: () => FunnelState, { track, onMove }: MachineOptions) {
  const [state, dispatch] = useReducer(funnelReducer, undefined, init);
  const moving = useRef(false);

  function act(action: FunnelAction, options: MoveOptions = {}) {
    if (moving.current) return;
    const next = funnelReducer(state, action);
    if (next === state) return;
    if (next.currentStepId === state.currentStepId) {
      dispatch(action);
      return;
    }
    moving.current = true;
    for (const event of transitionEvents(state, next, action)) {
      track(event.name, event.stepId, event.properties);
    }
    withViewTransition(
      () => {
        dispatch({ type: 'set', state: next });
        onMove?.(next, options);
        moving.current = false;
      },
      { back: action.type === 'back' },
    );
  }

  /** A move is being rendered; callers that start moves another way wait for it. */
  const isMoving = () => moving.current;

  return { state, act, dispatch, isMoving };
}
