import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEventSchema, type ClientEvent } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
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
  utm: { source: 'linkedin', medium: null, campaign: 'spring_launch' },
};

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
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

function makeQueue(overrides: Partial<EventQueueDeps> = {}): EventQueue {
  const queue = createEventQueue(CONTEXT, {
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

    const [event] = JSON.parse(storage.data.get(`funnel:events:${SESSION}`) ?? '[]') as unknown[];
    const parsed = ClientEventSchema.parse(event);
    expect(parsed).toEqual({
      event_id: expect.any(String) as string,
      session_id: SESSION,
      name: 'answer_submitted',
      client_timestamp: '2026-10-02T10:00:00.000Z',
      client_seq: 0,
      funnel_id: 'workstyle-planner',
      funnel_version: 1,
      experiment_id: 'question-order-and-result-framing-v1',
      variant: 'B',
      step_id: 'team_size',
      utm_source: 'linkedin',
      utm_campaign: 'spring_launch',
      properties: { answer_kind: 'number' },
    });
    expect(parsed).not.toHaveProperty('utm_medium');
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
    const stored = JSON.parse(storage.data.get(`funnel:events:${SESSION}`) ?? '[]') as {
      event_id: string;
    }[];
    expect(stored.map((e) => e.event_id)).toEqual([left]);
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
  it('beacons the whole outbox in batches of 100 and keeps it', () => {
    const beacon = vi.fn<(body: BatchBody) => boolean>(() => true);
    const queue = makeQueue({ beacon });
    push(queue, 5);
    hidden?.();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0].events).toHaveLength(5);
    expect(queue.pending()).toBe(5);
  });

  it('stops when the browser refuses a beacon', () => {
    const beacon = vi.fn<(body: BatchBody) => boolean>(() => false);
    const queue = makeQueue({ beacon });
    push(queue, 9);
    for (let i = 0; i < 25; i += 1) queue.push('back_clicked', 'team_size', {});
    hidden?.();
    expect(beacon).toHaveBeenCalledTimes(1);
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
    const storedIds = (JSON.parse(stored ?? '[]') as { event_id: string }[]).map((e) => e.event_id);
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

    const stored = JSON.parse(storage.data.get(`funnel:events:${SESSION}`) ?? '[]') as unknown[];
    expect(stored).toHaveLength(3);
    expect(next.pending()).toBe(3);
  });

  it('ignores a corrupt outbox and foreign or invalid stored events', () => {
    storage.setItem(`funnel:events:${SESSION}`, '{not json');
    expect(makeQueue().pending()).toBe(0);

    const valid = makeQueue();
    valid.push('step_viewed', 'intro', {});
    const [event] = JSON.parse(storage.data.get(`funnel:events:${SESSION}`) ?? '[]') as object[];
    storage.setItem(
      `funnel:events:${SESSION}`,
      JSON.stringify([event, event, { ...event, session_id: 'other' }, { broken: true }]),
    );
    expect(refresh().pending()).toBe(1);

    storage.setItem(`funnel:events:${SESSION}`, '{"events":[]}');
    expect(refresh().pending()).toBe(0);
  });

  it('works in memory when storage throws', async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
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
