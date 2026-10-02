import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEventSchema } from '@funnel/shared';
import { z } from 'zod';
import { createEventSink, createTracker, type EventSink } from './tracking.ts';

describe('track', () => {
  it('forwards only events of the session catalog', () => {
    const push = vi.fn<EventSink['push']>();
    const sink: EventSink = { push, pending: () => 0 };
    const track = createTracker(sink, [{ name: 'step_viewed', properties: [] }]);
    track('step_viewed', 'intro', { step_type: 'info' });
    track('recommendation_expanded', 'result', { source: 'cta' });
    track('step_viewed', null);
    expect(push.mock.calls).toEqual([
      ['step_viewed', 'intro', { step_type: 'info' }],
      ['step_viewed', null, {}],
    ]);
  });
});

describe('live sink', () => {
  const SESSION_ID = '01900000-0000-7000-8000-00000000000a';
  const response = {
    session: { id: SESSION_ID, funnelVersion: 1, experimentId: 'exp-v1', variant: 'B' as const },
    funnel: { meta: { funnelId: 'workstyle-planner' } },
  };
  let data: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    data = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
        get length() {
          return data.size;
        },
        key: (index: number) => [...data.keys()][index] ?? null,
      },
    });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('builds events from the session and survives a stop and a restart', () => {
    const sink = createEventSink(response);
    const close = sink.open();
    sink.push('step_viewed', 'intro', { step_type: 'info' });
    expect(sink.pending()).toBe(1);
    const [stored] = ClientEventSchema.array().parse(
      JSON.parse(data.get(`funnel:events:${SESSION_ID}`) ?? '[]'),
    );
    expect(stored).toMatchObject({
      session_id: SESSION_ID,
      funnel_id: 'workstyle-planner',
      funnel_version: 1,
      experiment_id: 'exp-v1',
      variant: 'B',
      client_seq: 0,
    });
    close();
    expect(sink.pending()).toBe(0);
    // React restarted the effect: a new queue takes over the stored outbox and seq.
    const closeAgain = sink.open();
    sink.push('step_viewed', 'intro', {});
    expect(sink.pending()).toBe(2);
    closeAgain();
  });

  it('a push after close is stored and beaconed alone, with no queue', async () => {
    const fetchSpy = vi.fn(() => new Promise<never>(() => undefined));
    vi.stubGlobal('fetch', fetchSpy);
    // Another session's leftovers: a full queue would start draining them over the network.
    data.set('funnel:events:01900000-0000-7000-8000-0000000000ff', '[]');
    const sink = createEventSink(response);
    const close = sink.open();
    sink.push('step_viewed', 'intro', {});
    close();
    fetchSpy.mockClear();
    const doc = z
      .object({ addEventListener: z.custom<ReturnType<typeof vi.fn>>() })
      .parse(document);
    doc.addEventListener.mockClear();
    vi.clearAllTimers();
    const beacon = vi.fn<(url: string, body: unknown) => boolean>(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });

    sink.push('step_completed', 'intro', { next_step_id: 'team_size' });

    expect(sink.pending()).toBe(0);
    const stored = ClientEventSchema.array().parse(
      JSON.parse(data.get(`funnel:events:${SESSION_ID}`) ?? '[]'),
    );
    expect(stored.map((e) => [e.name, e.client_seq])).toEqual([
      ['step_viewed', 0],
      ['step_completed', 1],
    ]);
    expect(stored[1]).toMatchObject({ variant: 'B', funnel_version: 1, step_id: 'intro' });
    expect(data.get(`funnel:seq:${SESSION_ID}`)).toBe('2');
    // No queue was started for the late event: no request, no timer, no listener.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.addEventListener).not.toHaveBeenCalled();
    // Only the late event is beaconed (the stored outbox is not sent again).
    expect(beacon).toHaveBeenCalledTimes(1);
    const body = beacon.mock.calls[0]?.[1];
    if (!(body instanceof Blob)) throw new Error('beacon body is not a Blob');
    const sent = z
      .object({ events: ClientEventSchema.array() })
      .parse(JSON.parse(await body.text()));
    expect(sent.events.map((e) => e.event_id)).toEqual([stored[1]?.event_id]);
  });
});
