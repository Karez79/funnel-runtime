import type { LiveEntry } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import { isNewProcess, KEEP_ROWS, mergeRows } from './rows.ts';

const entry = (seq: number, status: LiveEntry['status'] = 'duplicate'): LiveEntry => ({
  seq,
  receivedAt: '2026-10-01T12:00:00.000Z',
  eventId: 'same-event',
  sessionId: 's1',
  name: 'step_viewed',
  stepId: 'intro',
  version: 1,
  variant: 'A',
  status,
  reason: null,
});

describe('mergeRows', () => {
  it('keeps the same event three times in one batch as three rows', () => {
    const batch = [entry(1, 'accepted'), entry(2), entry(3)];
    expect(mergeRows([], batch).map((r) => r.seq)).toEqual([3, 2, 1]);
  });

  it('drops the backlog replayed on reconnect and keeps what is new', () => {
    const shown = mergeRows([], [entry(1), entry(2), entry(3)]);
    const replay = [entry(2), entry(3), entry(4)];
    expect(mergeRows(shown, replay).map((r) => r.seq)).toEqual([4, 3, 2, 1]);
  });

  it('keeps only the newest rows', () => {
    const many = Array.from({ length: KEEP_ROWS + 5 }, (_, i) => entry(i + 1));
    const rows = mergeRows([], many);
    expect(rows).toHaveLength(KEEP_ROWS);
    expect(rows[0]?.seq).toBe(KEEP_ROWS + 5);
  });
});

describe('isNewProcess', () => {
  it('starts over only when a reconnect reaches another server process', () => {
    expect(isNewProcess(null, 'boot-1')).toBe(false); // the first connect
    expect(isNewProcess('boot-1', 'boot-1')).toBe(false); // a reconnect to the same process
    expect(isNewProcess('boot-1', 'boot-2')).toBe(true); // a redeploy
  });
});
