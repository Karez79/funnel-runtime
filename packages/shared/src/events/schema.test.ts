import { describe, expect, it } from 'vitest';
import { BatchEnvelopeSchema, BatchResponseSchema, ClientEventSchema } from './schema.ts';

const event = {
  event_id: '01928f5e-7b3a-7c4d-9e2f-0123456789ab',
  session_id: '01928f5e-7b3a-7c4d-9e2f-0123456789ac',
  name: 'step_viewed',
  client_timestamp: '2026-10-01T10:00:00.000Z',
  client_seq: 3,
  funnel_id: 'workstyle-planner',
  funnel_version: 1,
  experiment_id: 'question-order-and-result-framing-v1',
  variant: 'A',
  step_id: 'team_size',
  utm_source: 'linkedin',
  properties: { step_type: 'number', visible_step_index: 1, visible_step_count: 6 },
};

describe('ClientEventSchema', () => {
  it('accepts a well-formed event, with or without UTM fields', () => {
    expect(ClientEventSchema.safeParse(event).success).toBe(true);
    const noUtm = Object.fromEntries(Object.entries(event).filter(([k]) => k !== 'utm_source'));
    expect(ClientEventSchema.safeParse(noUtm).success).toBe(true);
    expect(ClientEventSchema.safeParse({ ...event, step_id: null }).success).toBe(true);
  });

  it.each([
    ['event_id', { event_id: 'not-a-uuid' }],
    ['session_id', { session_id: '' }],
    ['client_timestamp', { client_timestamp: 'yesterday' }],
    ['client_seq', { client_seq: -1 }],
    ['variant', { variant: 'C' }],
    ['properties', { properties: 'none' }],
    ['name', { name: '' }],
  ])('rejects a bad %s', (_field, patch) => {
    expect(ClientEventSchema.safeParse({ ...event, ...patch }).success).toBe(false);
  });
});

describe('BatchEnvelopeSchema', () => {
  it('accepts any items, so one broken event cannot fail the batch', () => {
    const res = BatchEnvelopeSchema.safeParse({
      batch_id: 'b1',
      events: [event, { junk: true }, 42],
    });
    expect(res.success).toBe(true);
  });

  it('rejects a broken envelope and more than 100 events', () => {
    expect(BatchEnvelopeSchema.safeParse({ events: 'x' }).success).toBe(false);
    expect(BatchEnvelopeSchema.safeParse({}).success).toBe(false);
    expect(BatchEnvelopeSchema.safeParse({ events: Array(101).fill(event) }).success).toBe(false);
    expect(BatchEnvelopeSchema.safeParse({ events: [] }).success).toBe(true);
  });
});

describe('BatchResponseSchema', () => {
  it('requires a reason exactly for rejected results', () => {
    const ok = (results: unknown[]) =>
      BatchResponseSchema.safeParse({ results, accepted: 0, duplicates: 0, rejected: 0 }).success;
    expect(ok([{ event_id: 'e', status: 'accepted' }])).toBe(true);
    expect(ok([{ event_id: null, status: 'rejected', reason: 'invalid_event' }])).toBe(true);
    expect(ok([{ event_id: 'e', status: 'rejected' }])).toBe(false);
  });
});
