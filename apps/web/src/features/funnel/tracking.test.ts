import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEventSchema } from '@funnel/shared';
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
});
