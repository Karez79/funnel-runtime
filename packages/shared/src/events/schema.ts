// Event shapes (CLAUDE.md 7.1, 7.3), shared by the client queue, ingest and the generator.
// The batch envelope accepts any items: each event is validated on its own, so one broken
// event is rejected alone and never fails the batch. Version, variant and UTM sent by the
// client are kept only to detect a mismatch; the server takes them from the session.
import { z } from 'zod';
import { VARIANTS } from '../config/schema.ts';

export const MAX_BATCH_EVENTS = 100;

export const ClientEventSchema = z.object({
  event_id: z.uuid(),
  session_id: z.string().min(1),
  name: z.string().min(1),
  client_timestamp: z.iso.datetime({ offset: true }),
  client_seq: z.number().int().nonnegative(),
  funnel_id: z.string().min(1),
  funnel_version: z.number().int().positive(),
  experiment_id: z.string().min(1),
  variant: z.enum(VARIANTS),
  step_id: z.string().min(1).nullable(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  // Values are checked after the whitelist (catalog.ts), so an extra key with a nested
  // value is dropped and flagged rather than failing the whole event.
  properties: z.record(z.string(), z.unknown()),
});
export type ClientEvent = z.infer<typeof ClientEventSchema>;
/** Properties as stored: whitelisted, flat values only. */
export type EventProperties = Record<string, string | number | boolean | null>;

export const BatchEnvelopeSchema = z.object({
  batch_id: z.string().min(1).max(100).optional(),
  events: z.array(z.unknown()).max(MAX_BATCH_EVENTS),
});

export const REJECT_REASONS = [
  'invalid_event',
  'unknown_session',
  'unknown_event',
  'server_only',
  'unknown_step',
] as const;

/** `event_id` is null when the item had no readable id. Only a rejection has a reason. */
const EventResult = z.discriminatedUnion('status', [
  z.object({ event_id: z.string().nullable(), status: z.enum(['accepted', 'duplicate']) }),
  z.object({
    event_id: z.string().nullable(),
    status: z.literal('rejected'),
    reason: z.enum(REJECT_REASONS),
  }),
]);

export const BatchResponseSchema = z.object({
  results: z.array(EventResult),
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});
