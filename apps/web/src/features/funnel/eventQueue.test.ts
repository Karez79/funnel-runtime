import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEventSchema, type ClientEvent } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import {
  createEventQueue,
  type BatchBody,
  type EventQueue,
  type EventQueueContext,
  type EventQueueDeps,
  type StorageLike,
} from './eventQueue.ts';

const SESSION = '01900000-0000-7000-8000-000000000001';
const CONTEXT: EventQueueContext = {
  sessionId: SESSION,
  funnelId: 'workstyle-planner',
  funnelVersion: 1,
  experimentId: 'question-order-and-result-framing-v1',
  variant: 'B',
};

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
  };
}

type Response = { status: number; json: unknown };
type Reply = Response | Error;
type Status = 'accepted' | 'duplicate' | 'rejected';

/** Accepts everything unless a reply is queued; records every request. */
function fakeServer() {
  const requests: ClientEvent[][] = [];
  const replies: ((events: readonly ClientEvent[]) => Reply)[] = [];
  const send = vi.fn((body: BatchBody) => {
    requests.push([...body.events]);
    const reply = (replies.shift() ?? ((events) => ack(events, () => 'accepted')))(body.events);
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  return { requests, replies, send };
}

function ack(events: readonly ClientEvent[], status: (event: ClientEvent) => Status): Response {
  const results = events.map((event) => {
    const s = status(event);
    return s === 'rejected'
      ? { event_id: event.event_id, status: s, reason: 'unknown_event' }
      : { event_id: event.event_id, status: s };
  });
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  return {
    status: 200,
    json: {
      results,
      accepted: count('accepted'),
      duplicates: count('duplicate'),
      rejected: count('rejected'),
    },
  };
}

let queues: EventQueue[] = [];
let storage: ReturnType<typeof memoryStorage>;
let server: ReturnType<typeof fakeServer>;
let warn: ReturnType<typeof vi.fn<(message: string) => void>>;
let hidden: (() => void) | undefined;

function makeQueue(
  overrides: Partial<EventQueueDeps> = {},
  context: EventQueueContext = CONTEXT,
): EventQueue {
  const queue = createEventQueue(context, {
    send: server.send,
    beacon: () => true,
    storage,
    now: () => Date.parse('2026-10-02T10:00:00.000Z'),
    uuid: () => uuidv7(),
    onHidden: (callback) => {
      hidden = callback;
      return () => {
        hidden = undefined;
      };
    },
    warn,
    ...overrides,
  });
  queues.push(queue);
  return queue;
}

/** Simulates a page refresh: the old queue is gone, storage stays. */
function refresh(overrides: Partial<EventQueueDeps> = {}): EventQueue {
  for (const queue of queues) queue.dispose();
  queues = [];
  return makeQueue(overrides);
}

const push = (queue: EventQueue, count: number) => {
  for (let i = 0; i < count; i += 1)
    queue.push('step_viewed', 'team_size', { step_type: 'number' });
};

/** The stored outbox, parsed (and so checked) with the shared schema. */
const storedEvents = (raw = storage.data.get(`funnel:events:${SESSION}`)): ClientEvent[] =>
  ClientEventSchema.array().parse(JSON.parse(raw ?? '[]'));

const sentIds = (index: number) => server.requests[index]?.map((e) => e.event_id) ?? [];

beforeEach(() => {
  vi.useFakeTimers();
  storage = memoryStorage();
  server = fakeServer();
  warn = vi.fn<(message: string) => void>();
  hidden = undefined;
});

afterEach(() => {
  for (const queue of queues) queue.dispose();
  queues = [];
  vi.useRealTimers();
});

describe('event shape and client_seq', () => {
  it('builds a full ClientEvent from the context and keeps it in the outbox', () => {
    const queue = makeQueue();
    queue.push('answer_submitted', 'team_size', { answer_kind: 'number' });

    const [parsed] = storedEvents();
    expect(parsed?.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect({ ...parsed, event_id: 'id' }).toEqual({
      event_id: 'id',
      session_id: SESSION,
      name: 'answer_submitted',
      client_timestamp: '2026-10-02T10:00:00.000Z',
      client_seq: 0,
      funnel_id: 'workstyle-planner',
      funnel_version: 1,
      experiment_id: 'question-order-and-result-framing-v1',
      variant: 'B',
      step_id: 'team_size',
      properties: { answer_kind: 'number' },
    });
    // UTM is the session's (6.3): the server fills it in, the client does not claim it.
    expect(parsed).not.toHaveProperty('utm_source');
    expect(queue.pending()).toBe(1);
  });

  it('keeps client_seq monotonic across a refresh', async () => {
    const queue = makeQueue();
    push(queue, 3);
    await queue.flush();
    expect(queue.pending()).toBe(0);

    const next = refresh();
    push(next, 2);
    await next.flush();
    const seqs = server.requests.flat().map((e) => e.client_seq);
    expect(seqs).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(server.requests.flat().map((e) => e.event_id)).size).toBe(5);
  });
});

describe('flush triggers', () => {
  it('flushes every 2 seconds', async () => {
    const queue = makeQueue();
    push(queue, 3);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(server.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.requests).toHaveLength(1);
    expect(sentIds(0)).toHaveLength(3);
    expect(queue.pending()).toBe(0);
  });

  it('flushes as soon as 10 events wait', async () => {
    const queue = makeQueue();
    push(queue, 9);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.send).not.toHaveBeenCalled();
    push(queue, 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentIds(0)).toHaveLength(10);
  });

  it('sends at most 100 events per request and one request at a time', async () => {
    const queue = makeQueue();
    let release: (() => void) | undefined;
    server.send.mockImplementationOnce((body) => {
      server.requests.push([...body.events]);
      return new Promise((resolve) => {
        release = () => {
          resolve(ack(body.events, () => 'accepted'));
        };
      });
    });
    push(queue, 150);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.send).toHaveBeenCalledTimes(1);
    void queue.flush();
    expect(server.send).toHaveBeenCalledTimes(1);
    expect(sentIds(0)).toHaveLength(100);

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests[1]).toHaveLength(50);
    expect(queue.pending()).toBe(0);
  });
});

describe('server answers', () => {
  it('removes accepted and duplicate, warns about and removes rejected, keeps missing', async () => {
    const queue = makeQueue();
    push(queue, 4);
    server.replies.push((events) => {
      const reply = ack(events.slice(0, 3), (event) =>
        event === events[0] ? 'accepted' : event === events[1] ? 'duplicate' : 'rejected',
      );
      return reply;
    });
    await queue.flush();

    expect(queue.pending()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('unknown_event');
    const left = sentIds(0)[3];
    expect(storedEvents().map((e) => e.event_id)).toEqual([left]);
  });

  it('keeps events on network errors and 5xx and retries with backoff 1, 2, 4, 8, 16, 30, 30 s', async () => {
    const queue = makeQueue();
    push(queue, 2);
    for (let i = 0; i < 7; i += 1) {
      server.replies.push(() => (i % 2 === 0 ? new Error('offline') : { status: 503, json: null }));
    }
    await queue.flush();
    expect(server.requests).toHaveLength(1);

    for (const [index, seconds] of [1, 2, 4, 8, 16, 30, 30].entries()) {
      await vi.advanceTimersByTimeAsync(seconds * 1_000 - 1);
      expect(server.requests).toHaveLength(index + 1);
      // A push during backoff waits for the retry instead of flushing early.
      push(queue, index === 3 ? 10 : 0);
      await vi.advanceTimersByTimeAsync(1);
      expect(server.requests).toHaveLength(index + 2);
    }
    const first = sentIds(0);
    for (let i = 1; i < server.requests.length; i += 1) {
      expect(sentIds(i).slice(0, 2)).toEqual(first);
    }
    // The last retry succeeded and took the events pushed during the backoff too.
    expect(queue.pending()).toBe(0);
  });

  it('resets the backoff after a success', async () => {
    const queue = makeQueue();
    push(queue, 1);
    server.replies.push(
      () => new Error('offline'),
      () => new Error('offline'),
    );
    await queue.flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.requests).toHaveLength(3);
    expect(queue.pending()).toBe(0);

    server.replies.push(() => new Error('offline'));
    push(queue, 1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.requests).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.requests).toHaveLength(5);
    expect(queue.pending()).toBe(0);
  });

  it('treats 429 and an unreadable 200 as retryable', async () => {
    const queue = makeQueue();
    push(queue, 1);
    server.replies.push(
      () => ({ status: 429, json: null }),
      () => ({ status: 200, json: { nope: true } }),
    );
    await queue.flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(queue.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.requests).toHaveLength(3);
    expect(queue.pending()).toBe(0);
  });

  it('splits a batch the server refuses (400/413) and drops the single poison event', async () => {
    const queue = makeQueue();
    push(queue, 4);
    const poison = () => sentIds(0)[2];
    const refuses = (events: readonly ClientEvent[]): Reply =>
      events.some((e) => e.event_id === poison())
        ? { status: 413, json: null }
        : ack(events, () => 'accepted');
    server.replies.push(refuses, refuses, refuses, refuses, refuses);
    await queue.flush(); // 4 → refused
    await queue.flush(); // [0,1] accepted
    await queue.flush(); // [2,3] refused, limit 1
    await queue.flush(); // [2] refused alone → dropped
    await queue.flush(); // [3] accepted
    expect(server.requests.map((r) => r.length)).toEqual([4, 2, 2, 1, 1]);
    expect(queue.pending()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(poison());
  });
});

describe('beacon on hide', () => {
  // A failing request keeps all 150 events in the outbox when the page hides.
  const offline = { send: () => Promise.reject(new Error('offline')) };

  it('beacons the whole outbox in batches of 100 and keeps it', async () => {
    const beacon = vi.fn<(body: BatchBody) => boolean>(() => true);
    const queue = makeQueue({ ...offline, beacon });
    push(queue, 150);
    await vi.advanceTimersByTimeAsync(0);
    hidden?.();
    expect(beacon.mock.calls.map(([body]) => body.events.length)).toEqual([100, 50]);
    expect(queue.pending()).toBe(150);
  });

  it('stops when the browser refuses a beacon', async () => {
    const beacon = vi.fn<(body: BatchBody) => boolean>(() => false);
    const queue = makeQueue({ ...offline, beacon });
    push(queue, 150);
    await vi.advanceTimersByTimeAsync(0);
    hidden?.();
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('dispose beacons pending events and keeps them in the outbox', () => {
    const beacon = vi.fn<(body: BatchBody) => boolean>(() => true);
    const queue = makeQueue({ beacon });
    push(queue, 3);
    queue.dispose();
    queue.dispose();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0].events).toHaveLength(3);
    expect(storedEvents()).toHaveLength(3);
  });

  it('dispose with an empty outbox sends no beacon', () => {
    const beacon = vi.fn<(body: BatchBody) => boolean>(() => true);
    makeQueue({ beacon }).dispose();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('dispose stops timers and the hidden listener', async () => {
    const queue = makeQueue();
    push(queue, 3);
    queue.dispose();
    expect(hidden).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.send).not.toHaveBeenCalled();
    queue.push('step_viewed', null, {});
    expect(queue.pending()).toBe(3);
  });
});

describe('refresh and storage', () => {
  it('re-sends the outbox of the session after a refresh with the same event ids', async () => {
    const first = makeQueue({ send: () => Promise.reject(new Error('offline')) });
    push(first, 3);
    expect(first.pending()).toBe(3);
    const stored = storage.data.get(`funnel:events:${SESSION}`);

    const next = refresh();
    expect(next.pending()).toBe(3);
    await vi.advanceTimersByTimeAsync(2_000);
    const storedIds = storedEvents(stored).map((e) => e.event_id);
    expect(sentIds(0)).toEqual(storedIds);
    expect(next.pending()).toBe(0);
  });

  it('a late response to a disposed queue does not overwrite the newer outbox', async () => {
    let release: (() => void) | undefined;
    const first = makeQueue({
      send: (body) =>
        new Promise((resolve) => {
          release = () => {
            resolve(ack(body.events, () => 'accepted'));
          };
        }),
    });
    push(first, 2);
    const flushed = first.flush();
    const next = refresh();
    next.push('back_clicked', 'team_size', {});
    release?.();
    await flushed;

    expect(storedEvents()).toHaveLength(3);
    expect(next.pending()).toBe(3);
  });

  it('two tabs of one session never repeat client_seq', () => {
    const tabA = makeQueue();
    const tabB = makeQueue();
    tabA.push('step_viewed', 'intro', {});
    tabB.push('step_viewed', 'intro', {});
    tabA.push('step_viewed', 'team_size', {});
    tabB.push('back_clicked', 'team_size', {});
    expect(
      storedEvents()
        .map((e) => e.client_seq)
        .toSorted((a, b) => a - b),
    ).toEqual([0, 1, 2, 3]);
  });

  it("one tab's write keeps the other tab's stored events and drops only its own acked ones", async () => {
    const tabA = makeQueue({ send: () => Promise.reject(new Error('offline')) });
    push(tabA, 2);
    const idsA = storedEvents().map((e) => e.event_id);

    const tabB = makeQueue();
    push(tabB, 1);
    await tabB.flush();
    expect(tabB.pending()).toBe(0);

    // B's outbox held A's two events (loaded at creation) and its own; all were acked,
    // so B removes them from storage, but A still has its own copy and writes it back.
    tabA.push('back_clicked', 'team_size', {});
    expect(
      storedEvents()
        .map((e) => e.event_id)
        .slice(0, 2),
    ).toEqual(idsA);
    expect(storedEvents()).toHaveLength(3);
  });

  it('a tab does not erase events only the other tab stored', () => {
    const tabA = makeQueue();
    const tabB = makeQueue();
    push(tabA, 2);
    const idsA = storedEvents().map((e) => e.event_id);
    tabB.push('back_clicked', 'team_size', {});
    const stored = storedEvents().map((e) => e.event_id);
    expect(stored).toHaveLength(3);
    expect(stored).toEqual(expect.arrayContaining(idsA));
  });

  it('ignores a corrupt outbox and foreign or invalid stored events', () => {
    storage.setItem(`funnel:events:${SESSION}`, '{not json');
    expect(makeQueue().pending()).toBe(0);

    const valid = makeQueue();
    valid.push('step_viewed', 'intro', {});
    const [event] = storedEvents();
    storage.setItem(
      `funnel:events:${SESSION}`,
      JSON.stringify([event, event, { ...event, session_id: 'other' }, { broken: true }]),
    );
    expect(refresh().pending()).toBe(1);

    storage.setItem(`funnel:events:${SESSION}`, '{"events":[]}');
    expect(refresh().pending()).toBe(0);
  });

  it('works in memory when storage throws', async () => {
    const fail = (): never => {
      throw new Error('SecurityError');
    };
    const throwing: StorageLike = {
      getItem: fail,
      setItem: fail,
      removeItem: fail,
      get length() {
        return fail();
      },
      key: fail,
    };
    const queue = makeQueue({ storage: throwing });
    expect(() => {
      push(queue, 2);
    }).not.toThrow();
    expect(queue.pending()).toBe(2);
    await queue.flush();
    expect(sentIds(0).length).toBe(2);
    expect(queue.pending()).toBe(0);
  });

  it('works without storage at all', () => {
    const queue = makeQueue({ storage: null });
    push(queue, 1);
    expect(queue.pending()).toBe(1);
  });
});

describe('outboxes of other sessions', () => {
  const OLD = '01900000-0000-7000-8000-000000000002';
  const OLDER = '01900000-0000-7000-8000-000000000003';

  /** Leaves `count` unsent events of session `id` in storage, like a closed tab would. */
  function leaveBehind(id: string, count: number): string[] {
    // Its own requests never answer, so it neither sends nor drains anything.
    const old = makeQueue(
      { beacon: () => false, send: () => new Promise(() => undefined) },
      { ...CONTEXT, sessionId: id },
    );
    push(old, count);
    old.dispose();
    return storedEvents(storage.data.get(`funnel:events:${id}`)).map((e) => e.event_id);
  }

  it('sends them once and removes their keys when the server answered for all', async () => {
    const oldIds = leaveBehind(OLD, 3);
    makeQueue();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentIds(0)).toEqual(oldIds);
    expect(server.requests[0]?.every((e) => e.session_id === OLD)).toBe(true);
    expect(storage.data.has(`funnel:events:${OLD}`)).toBe(false);
    expect(storage.data.has(`funnel:seq:${OLD}`)).toBe(false);
  });

  it('keeps them when the request fails, and keeps events the server did not mention', async () => {
    const oldIds = leaveBehind(OLD, 2);
    const olderIds = leaveBehind(OLDER, 2);
    server.replies.push(
      () => new Error('offline'),
      (events) => ({
        ...ack(events.slice(0, 1), () => 'duplicate'),
      }),
    );
    makeQueue();
    await vi.advanceTimersByTimeAsync(0);
    const left = (id: string) =>
      storedEvents(storage.data.get(`funnel:events:${id}`)).map((e) => e.event_id);
    expect(left(OLD)).toEqual(oldIds);
    expect(left(OLDER)).toEqual(olderIds.slice(1));
  });

  it('removes a bare client_seq key of another session without a request', async () => {
    storage.data.set(`funnel:seq:${OLD}`, '7');
    makeQueue();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.data.has(`funnel:seq:${OLD}`)).toBe(false);
    expect(server.send).not.toHaveBeenCalled();
  });

  it('halves a refused old batch and drops only the event refused alone', async () => {
    const [first, second] = leaveBehind(OLD, 2);
    const refused = () => ({ status: 400, json: null });
    server.replies.push(refused, refused);
    makeQueue();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests.map((r) => r.length)).toEqual([2, 1]);
    expect(storedEvents(storage.data.get(`funnel:events:${OLD}`)).map((e) => e.event_id)).toEqual([
      second,
    ]);
    expect(warn).toHaveBeenCalledWith(`Old event ${String(first)} dropped`);
  });

  it('sends at most 100 old events per queue and keeps the rest', async () => {
    const ids = leaveBehind(OLD, 150);
    makeQueue();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentIds(0)).toEqual(ids.slice(0, 100));
    expect(storedEvents(storage.data.get(`funnel:events:${OLD}`)).map((e) => e.event_id)).toEqual(
      ids.slice(100),
    );
  });

  it('a drain still running at dispose leaves storage alone and sends nothing more', async () => {
    const oldIds = leaveBehind(OLD, 2);
    const olderIds = leaveBehind(OLDER, 2);
    let answer: (() => void) | undefined;
    server.replies.push((events) => ack(events, () => 'accepted'));
    const send = vi.fn((body: BatchBody) => {
      const reply = server.send(body);
      return new Promise<Response>((resolve) => {
        answer = () => {
          void reply.then(resolve);
        };
      });
    });
    const queue = makeQueue({ send });
    queue.dispose();
    answer?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    const left = (id: string) =>
      storedEvents(storage.data.get(`funnel:events:${id}`)).map((e) => e.event_id);
    expect(left(OLD)).toEqual(oldIds);
    expect(left(OLDER)).toEqual(olderIds);
  });
});

describe('default send through lib/api.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('maps a network error and 503 to retries and a 400 to a dropped event, keeping the id', async () => {
    const bodies: string[] = [];
    const replies: (() => Response)[] = [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => json(503, { error: { code: 'unavailable', message: 'down' } }),
      () => json(400, { error: { code: 'invalid_request', message: 'bad' } }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        bodies.push(z.string().parse(init.body));
        const reply = replies.shift();
        if (!reply) throw new Error('unexpected request');
        return Promise.resolve().then(reply);
      }),
    );
    const queue = createEventQueue(CONTEXT, {
      beacon: () => true,
      storage,
      now: () => Date.parse('2026-10-02T10:00:00.000Z'),
      uuid: () => uuidv7(),
      onHidden: () => () => undefined,
      warn,
    });
    queues.push(queue);
    queue.push('step_viewed', 'intro', {});
    await queue.flush();
    expect(queue.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(queue.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(bodies).toHaveLength(3);
    const ids = bodies.map((body) =>
      z
        .object({ events: ClientEventSchema.array() })
        .parse(JSON.parse(body))
        .events.map((e) => e.event_id),
    );
    expect(new Set(ids.flat()).size).toBe(1);
    expect(queue.pending()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('removes events the server accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        const { events } = z
          .object({ events: ClientEventSchema.array() })
          .parse(JSON.parse(z.string().parse(init.body)));
        return Promise.resolve(json(200, ack(events, () => 'accepted').json));
      }),
    );
    const queue = createEventQueue(CONTEXT, {
      beacon: () => true,
      storage,
      onHidden: () => () => undefined,
      warn,
    });
    queues.push(queue);
    queue.push('step_viewed', 'intro', {});
    await queue.flush();
    expect(queue.pending()).toBe(0);
  });
});
