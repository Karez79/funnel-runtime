import { describe, expect, it, vi } from 'vitest';
import { createEventSink, createTracker, NOOP_SINK, type EventSink } from './tracking.ts';

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

  it('the no-op sink drops everything; live sessions use it until the event queue lands', () => {
    NOOP_SINK.push('step_viewed', null, {});
    expect(NOOP_SINK.pending()).toBe(0);
    expect(createEventSink).toBeTypeOf('function');
  });
});
