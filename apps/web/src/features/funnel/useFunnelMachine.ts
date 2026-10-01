// Runs funnel actions (CLAUDE.md 8): the pure reducer decides the next state; a move to
// another step is wrapped in a view transition (left on Continue, right on Back) and its
// events and side effects (save, URL) run with the new state. Live and preview funnels
// share this; they differ only in `track` and `onMove`.
import { useReducer } from 'react';
import { withViewTransition } from '../../lib/viewTransition.ts';
import {
  funnelReducer,
  transitionEvents,
  type FunnelAction,
  type FunnelState,
} from './funnelReducer.ts';
import type { Track } from './tracking.ts';

export interface MoveOptions {
  /** The move follows the browser's own Back: the URL is already there. */
  readonly fromHistory?: boolean;
}

interface MachineOptions {
  readonly track: Track;
  /** Runs inside the transition, after the new step is rendered. */
  readonly onMove?: (next: FunnelState, options: MoveOptions) => void;
}

export function useFunnelMachine(init: () => FunnelState, { track, onMove }: MachineOptions) {
  const [state, dispatch] = useReducer(funnelReducer, undefined, init);

  function act(action: FunnelAction, options: MoveOptions = {}) {
    const next = funnelReducer(state, action);
    if (next === state) return;
    if (next.currentStepId === state.currentStepId) {
      dispatch(action);
      return;
    }
    for (const event of transitionEvents(state, next, action)) {
      track(event.name, event.stepId, event.properties);
    }
    withViewTransition(
      () => {
        dispatch(action);
        onMove?.(next, options);
      },
      { back: action.type === 'back' },
    );
  }

  return { state, act, dispatch };
}
