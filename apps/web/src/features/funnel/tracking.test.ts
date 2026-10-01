import { describe, expect, it, vi } from 'vitest';
import { createTracker, type EventSink } from './tracking.ts';

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
