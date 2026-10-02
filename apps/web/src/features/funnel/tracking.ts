// The seam between the funnel and the event queue (CLAUDE.md 7.4, 8.4). The funnel only
// knows `EventSink`; the event queue (eventQueue.ts) implements it. `track` sends an event only if its name
// is in the catalog of the CURRENT session's version, so a session on an older version
// never sends an event its version does not know.
import {
  catalogEvent,
  type EventDefinition,
  type EventProperties,
  type SessionResponse,
} from '@funnel/shared';
import { createEventQueue, type EventQueue } from './eventQueue.ts';

/** Where the funnel hands events; the event queue implements it. */
export interface EventSink {
  push(name: string, stepId: string | null, properties: EventProperties): void;
  /** Events not yet acknowledged by the server (debug overlay, 8.5). */
  pending(): number;
}

export type Track = (name: string, stepId: string | null, properties?: EventProperties) => void;

export function createTracker(sink: EventSink, catalog: readonly EventDefinition[]): Track {
  return (name, stepId, properties = {}) => {
    if (catalogEvent(catalog, name)) sink.push(name, stepId, properties);
  };
}

/** Drops every event: preview mode (11.1) creates no session and sends nothing. */
export const NOOP_SINK: EventSink = {
  push: () => undefined,
  pending: () => 0,
};

/** A live session's sink, tied to the component that runs the session. */
export interface LiveSink extends EventSink {
  /** Starts the queue (re-sends a stored outbox) and returns the function that stops it. */
  open(): () => void;
}

type SinkSession = Pick<
  SessionResponse['session'],
  'id' | 'funnelVersion' | 'experimentId' | 'variant'
>;

/**
 * The event queue of a live session (7.4). The queue is created on first use rather than
 * once: React may stop and start effects again (StrictMode, remounts), and children's
 * effects track before the parent's effect opens the sink. A push after the sink was
 * closed (a move that finishes after unmount) still lands in the stored outbox through a
 * queue that is stopped right away, so no queue outlives the component.
 */
export function createEventSink({
  session,
  funnel,
}: {
  session: SinkSession;
  funnel: { meta: Pick<SessionResponse['funnel']['meta'], 'funnelId'> };
}): LiveSink {
  let queue: EventQueue | null = null;
  let closed = false;
  const create = (): EventQueue =>
    createEventQueue({
      sessionId: session.id,
      funnelId: funnel.meta.funnelId,
      funnelVersion: session.funnelVersion,
      experimentId: session.experimentId,
      variant: session.variant,
    });
  const current = (): EventQueue => (queue ??= create());
  return {
    push: (name, stepId, properties) => {
      if (!closed) {
        current().push(name, stepId, properties);
        return;
      }
      const late = create();
      late.push(name, stepId, properties);
      late.dispose();
    },
    pending: () => queue?.pending() ?? 0,
    open: () => {
      closed = false;
      current();
      return () => {
        closed = true;
        queue?.dispose();
        queue = null;
      };
    },
  };
}
