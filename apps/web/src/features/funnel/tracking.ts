// The seam between the funnel and the event queue (CLAUDE.md 7.4, 8.4). The funnel only
// knows `EventSink`; Phase 4's eventQueue implements it. `track` sends an event only if its name
// is in the catalog of the CURRENT session's version, so a session on an older version
// never sends an event its version does not know.
import {
  catalogEvent,
  type EventDefinition,
  type EventProperties,
  type SessionResponse,
} from '@funnel/shared';

/** Where the funnel hands events; Phase 4's eventQueue implements it. */
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

/** Drops every event: preview mode (11.1) and, until the queue lands, live sessions. */
export const NOOP_SINK: EventSink = {
  push: () => undefined,
  pending: () => 0,
};

/** The one place that decides a live session's sink; Phase 4 returns the event queue here. */
export const createEventSink: (session: SessionResponse) => EventSink = () => NOOP_SINK;
