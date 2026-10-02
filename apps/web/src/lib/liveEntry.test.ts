import { describe, expect, it } from 'vitest';
import { parseLiveEntry } from './liveEntry.ts';

const entry = {
  seq: 7,
  receivedAt: '2026-10-02T10:00:00.000Z',
  eventId: 'e1',
  sessionId: 's1',
  name: 'step_viewed',
  stepId: 'team_size',
  version: 1,
  variant: 'A',
  status: 'duplicate',
  reason: null,
};

describe('parseLiveEntry', () => {
  it('returns a valid entry', () => {
    expect(parseLiveEntry(JSON.stringify(entry))).toEqual(entry);
  });

  it('drops data that is not JSON or not an entry', () => {
    expect(parseLiveEntry('not json')).toBeNull();
    expect(parseLiveEntry('{"seq":"x"}')).toBeNull();
  });
});
