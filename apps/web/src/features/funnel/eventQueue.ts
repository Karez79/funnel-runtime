// Client event queue (CLAUDE.md 7.4, 7.1). Why it looks like this:
// - Outbox first. Every event gets its uuid v7 `event_id` and `client_seq` when it is
//   created and goes straight into a per-session outbox in localStorage, so a refresh, a
//   closed tab or a network failure never loses it; the next queue for the session re-sends
//   it. The in-memory copy is the working set, storage is only a mirror: a full or blocked
//   storage must never break the funnel.
// - Safe to re-send. The server deduplicates by `event_id`, so the queue re-sends freely
//   (retries keep the same id) and removes an event only when the server answered for it:
//   `accepted` or `duplicate`; `rejected` is dropped with a warning, because re-sending it
//   cannot change the answer. Events the response does not mention stay.
// - Beacon on hide. `sendBeacon` survives page unload but returns no response, so what it
//   sends stays in the outbox and goes out again with the next flush or the next visit.
// - Everything impure (network, beacon, storage, clock, timers, ids, DOM) is injected; the
//   defaults use browser globals, so production code calls `createEventQueue(context)`.
import {
  ClientEventSchema,
  contract,
  MAX_BATCH_EVENTS,
  type ClientEvent,
  type EventProperties,
  type VariantKey,
} from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';

/** Flush when this many events wait, without waiting for the timer. */
const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 2_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface EventQueueContext {
  readonly sessionId: string;
  readonly funnelId: string;
  readonly funnelVersion: number;
  readonly experimentId: string;
  readonly variant: VariantKey;
  /** UTM the session was created with; unknown keys are omitted from events. */
  readonly utm?:
    | {
        readonly source?: string | null | undefined;
        readonly medium?: string | null | undefined;
        readonly campaign?: string | null | undefined;
      }
    | undefined;
}

export interface BatchBody {
  readonly events: readonly ClientEvent[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface EventQueueDeps {
  send(body: BatchBody): Promise<{ status: number; json: unknown }>;
  beacon(body: BatchBody): boolean;
  storage: StorageLike | null;
  /** Epoch milliseconds. */
  now(): number;
  timer: { set(fn: () => void, ms: number): TimerHandle; clear(handle: TimerHandle): void };
  uuid(): string;
  /** Subscribes to "page became hidden"; returns the unsubscribe function. */
  onHidden(callback: () => void): () => void;
  warn(message: string): void;
}

export interface EventQueue {
  push(name: string, stepId: string | null, properties: EventProperties): void;
  /** Events not yet acknowledged by the server (debug overlay). */
  pending(): number;
  /** Sends the oldest batch now; resolves when the request (if any) has finished. */
  flush(): Promise<void>;
  dispose(): void;
}

const OUTBOX_PREFIX = 'funnel:events:';
const SEQ_PREFIX = 'funnel:seq:';
const outboxKey = (sessionId: string): string => `${OUTBOX_PREFIX}${sessionId}`;
const seqKey = (sessionId: string): string => `${SEQ_PREFIX}${sessionId}`;

/** Session ids, other than `current`, that still have queue keys in storage. */
function otherSessions(storage: StorageLike | null, current: string): string[] {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage?.key(i) ?? '';
      const prefix = [OUTBOX_PREFIX, SEQ_PREFIX].find((p) => key.startsWith(p));
      if (prefix !== undefined) ids.add(key.slice(prefix.length));
    }
  } catch {
    return [];
  }
  ids.delete(current);
  return [...ids];
}

function readStorage(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stored events that still parse and belong to the session; anything else is skipped. */
function loadOutbox(storage: StorageLike | null, sessionId: string): ClientEvent[] {
  const raw = readStorage(storage, outboxKey(sessionId));
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const events: ClientEvent[] = [];
  for (const item of parsed) {
    const event = ClientEventSchema.safeParse(item);
    if (!event.success || event.data.session_id !== sessionId) continue;
    if (seen.has(event.data.event_id)) continue;
    seen.add(event.data.event_id);
    events.push(event.data);
  }
  return events;
}

type UtmFields = Partial<Pick<ClientEvent, 'utm_source' | 'utm_medium' | 'utm_campaign'>>;

function utmFields(utm: EventQueueContext['utm']): UtmFields {
  const fields: UtmFields = {};
  if (utm?.source) fields.utm_source = utm.source;
  if (utm?.medium) fields.utm_medium = utm.medium;
  if (utm?.campaign) fields.utm_campaign = utm.campaign;
  return fields;
}

function onDocumentHidden(callback: () => void): () => void {
  const listener = (): void => {
    if (document.visibilityState === 'hidden') callback();
  };
  document.addEventListener('visibilitychange', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener);
  };
}

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const route = contract.eventsBatch;

const defaultDeps = (): EventQueueDeps => ({
  async send(body) {
    const response = await fetch(route.path, {
      method: route.method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => null);
    return { status: response.status, json };
  },
  beacon: (body) =>
    navigator.sendBeacon(
      route.path,
      new Blob([JSON.stringify(body)], { type: 'application/json' }),
    ),
  storage: browserStorage(),
  now: () => Date.now(),
  timer: {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => {
      clearTimeout(handle);
    },
  },
  uuid: () => uuidv7(),
  onHidden: onDocumentHidden,
  warn: (message) => {
    // eslint-disable-next-line no-console -- the one client log: a dropped event (7.4)
    console.warn(message);
  },
});

type Outcome =
  | { kind: 'acked'; results: ReadonlyMap<string, string> }
  | { kind: 'retry' }
  /** 400/413: the server will never take this batch as is, see `settle`. */
  | { kind: 'poison' };

function classify(status: number, json: unknown): Outcome {
  if (status === 200) {
    const parsed = route.response.safeParse(json);
    if (!parsed.success) return { kind: 'retry' };
    const results = new Map<string, string>();
    for (const result of parsed.data.results) {
      if (result.event_id === null) continue;
      results.set(
        result.event_id,
        result.status === 'rejected' ? `rejected: ${result.reason}` : result.status,
      );
    }
    return { kind: 'acked', results };
  }
  if (status === 400 || status === 413) return { kind: 'poison' };
  // Network-level trouble, 5xx, 429 and any other status: the batch may succeed later.
  return { kind: 'retry' };
}

export function createEventQueue(
  context: EventQueueContext,
  overrides: Partial<EventQueueDeps> = {},
): EventQueue {
  const deps: EventQueueDeps = { ...defaultDeps(), ...overrides };
  const { sessionId } = context;
  const utm = utmFields(context.utm);

  /** The counter as stored; another tab of the same session may have moved it on. */
  const storedSeq = (): number => {
    const value = Number(readStorage(deps.storage, seqKey(sessionId)));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  };

  let outbox = loadOutbox(deps.storage, sessionId);
  let nextSeq = Math.max(storedSeq(), ...outbox.map((event) => event.client_seq + 1));
  /** Ids this queue removed: a merge with storage must not bring them back. */
  const removed = new Set<string>();

  let timer: TimerHandle | null = null;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  /** Shrinks after a 400/413 so a poison event ends up alone in its batch. */
  let batchLimit = MAX_BATCH_EVENTS;
  let disposed = false;

  function persist(): void {
    // After dispose a newer queue may own the session's storage (remount, refresh): a late
    // response must not overwrite its outbox. Acked events left there are re-sent as
    // duplicates, which is harmless.
    if (disposed) return;
    try {
      // The counter goes first: if the outbox write hits the quota, seq still never repeats.
      deps.storage?.setItem(seqKey(sessionId), String(Math.max(nextSeq, storedSeq())));
      // Two tabs share the session (8.1): keep stored events of the other tab, so one tab's
      // write never erases what only the other tab has stored.
      const own = new Set(outbox.map((event) => event.event_id));
      const foreign = loadOutbox(deps.storage, sessionId).filter(
        (event) => !own.has(event.event_id) && !removed.has(event.event_id),
      );
      deps.storage?.setItem(outboxKey(sessionId), JSON.stringify([...outbox, ...foreign]));
    } catch {
      // Quota or blocked storage: the in-memory outbox keeps working for this page.
    }
  }

  function schedule(ms: number): void {
    if (disposed) return;
    if (timer !== null) deps.timer.clear(timer);
    timer = deps.timer.set(() => {
      timer = null;
      void flush();
    }, ms);
  }

  /** Next flush after a request or a push; never cuts a running backoff short. */
  function planNext(): void {
    if (disposed || outbox.length === 0 || inFlight !== null) return;
    if (failures > 0) {
      if (timer === null) schedule(Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS));
      return;
    }
    if (outbox.length >= FLUSH_SIZE) schedule(0);
    else if (timer === null) schedule(FLUSH_INTERVAL_MS);
  }

  function remove(ids: ReadonlySet<string>): void {
    if (ids.size === 0) return;
    for (const id of ids) removed.add(id);
    outbox = outbox.filter((event) => !ids.has(event.event_id));
    persist();
  }

  function settle(batch: readonly ClientEvent[], outcome: Outcome): void {
    if (outcome.kind === 'retry') {
      failures += 1;
      return;
    }
    if (outcome.kind === 'poison') {
      // Splitting finds the offending event; alone, it can never be accepted, so it goes.
      const [only] = batch;
      if (batch.length === 1 && only) {
        deps.warn(`Event ${only.name} (${only.event_id}) dropped: the server refused it`);
        remove(new Set([only.event_id]));
      } else {
        batchLimit = Math.max(1, Math.ceil(batch.length / 2));
      }
      return;
    }
    failures = 0;
    batchLimit = MAX_BATCH_EVENTS;
    const done = new Set<string>();
    for (const event of batch) {
      const status = outcome.results.get(event.event_id);
      if (status === undefined) continue;
      if (status !== 'accepted' && status !== 'duplicate') {
        deps.warn(`Event ${event.name} (${event.event_id}) ${status}`);
      }
      done.add(event.event_id);
    }
    remove(done);
  }

  async function sendBatch(): Promise<void> {
    const batch = outbox.slice(0, batchLimit);
    let outcome: Outcome;
    try {
      const response = await deps.send({ events: batch });
      outcome = classify(response.status, response.json);
    } catch {
      outcome = { kind: 'retry' };
    }
    settle(batch, outcome);
  }

  function flush(): Promise<void> {
    if (inFlight !== null) return inFlight;
    if (outbox.length === 0) return Promise.resolve();
    if (timer !== null) {
      deps.timer.clear(timer);
      timer = null;
    }
    inFlight = sendBatch().finally(() => {
      inFlight = null;
      planNext();
    });
    return inFlight;
  }

  function push(name: string, stepId: string | null, properties: EventProperties): void {
    if (disposed) return;
    nextSeq = Math.max(nextSeq, storedSeq());
    outbox.push({
      event_id: deps.uuid(),
      session_id: sessionId,
      name,
      client_timestamp: new Date(deps.now()).toISOString(),
      client_seq: nextSeq,
      funnel_id: context.funnelId,
      funnel_version: context.funnelVersion,
      experiment_id: context.experimentId,
      variant: context.variant,
      step_id: stepId,
      ...utm,
      properties: { ...properties },
    });
    nextSeq += 1;
    persist();
    planNext();
  }

  function beaconAll(): void {
    // Nothing is removed: a beacon has no response, dedup makes the re-send harmless.
    for (let start = 0; start < outbox.length; start += MAX_BATCH_EVENTS) {
      if (!deps.beacon({ events: outbox.slice(start, start + MAX_BATCH_EVENTS) })) return;
    }
  }

  /**
   * Outboxes of sessions this browser left behind (expired session, `?variant=` override,
   * reset): their events are sent once, and the keys go when nothing is left to send. A
   * failure leaves them for the next queue. One orphan request at a time.
   */
  const isDisposed = (): boolean => disposed;

  async function drainOtherSessions(): Promise<void> {
    for (const id of otherSessions(deps.storage, sessionId)) {
      if (disposed) return;
      let events = loadOutbox(deps.storage, id).slice(0, MAX_BATCH_EVENTS);
      let outcome: Outcome = { kind: 'acked', results: new Map() };
      // Like the queue's own batches: a refused batch (400/413) is halved until the
      // refused event is alone, and only that one is dropped.
      while (events.length > 0) {
        try {
          const response = await deps.send({ events });
          outcome = classify(response.status, response.json);
        } catch {
          outcome = { kind: 'retry' };
        }
        if (outcome.kind !== 'poison' || events.length === 1) break;
        events = events.slice(0, Math.ceil(events.length / 2));
      }
      // Read through a call: `disposed` may have flipped while the request was out.
      if (outcome.kind === 'retry' || isDisposed()) continue;
      const answered = new Set(
        outcome.kind === 'acked' ? [...outcome.results.keys()] : events.map((e) => e.event_id),
      );
      if (outcome.kind === 'poison') deps.warn(`Old event ${[...answered].join()} dropped`);
      const left = loadOutbox(deps.storage, id).filter((e) => !answered.has(e.event_id));
      try {
        if (left.length === 0) {
          deps.storage?.removeItem(outboxKey(id));
          deps.storage?.removeItem(seqKey(id));
        } else {
          deps.storage?.setItem(outboxKey(id), JSON.stringify(left));
        }
      } catch {
        // Blocked storage: try again with the next queue.
      }
    }
  }

  const unsubscribe = deps.onHidden(beaconAll);
  planNext();
  void drainOtherSessions();

  return {
    push,
    pending: () => outbox.length,
    flush,
    dispose() {
      // Leaving the funnel inside the SPA fires no visibilitychange: hand pending events to
      // a beacon now. They stay in the outbox; dedup makes the next send harmless.
      if (!disposed && outbox.length > 0) beaconAll();
      disposed = true;
      if (timer !== null) deps.timer.clear(timer);
      timer = null;
      unsubscribe();
    },
  };
}
