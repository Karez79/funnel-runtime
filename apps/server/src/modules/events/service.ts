// Event ingest (CLAUDE.md 7.2, 7.3). A valid envelope always gets 200 with a status per
// event: each event is checked on its own, so one broken event never costs the others.
// Everything analytics trusts comes from the session row, not from the client: version,
// experiment, variant and UTM are copied from the session, and a client that claims
// otherwise is stored with the server's values and a `context_mismatch` flag (6.3). The
// catalog and the property whitelist are those of the session's PINNED version, so an
// event a version does not know is rejected and a raw answer has no key to travel under.
// Deduplication is the event_id primary key; ordering does not matter because analytics
// counts sets of sessions (11.2), and `out_of_order` is only a data-quality flag.
// Rejected items are kept for the data-quality panel, but never with property values:
// those are exactly where a raw answer would sit.
import {
  catalogEvent,
  ClientEventSchema,
  filterProperties,
  isServerOnly,
  type BatchResponseSchema,
  type ClientEvent,
  type EventProperties,
  type REJECT_REASONS,
} from '@funnel/shared';
import type { z } from 'zod';
import type { Clock } from '../../clock.ts';
import type { VersionsService } from '../versions/service.ts';
import type { EventsRepo, IngestSession } from './repo.ts';

type RejectReason = (typeof REJECT_REASONS)[number];
type BatchResponse = z.input<typeof BatchResponseSchema>;
type EventResult = BatchResponse['results'][number];

/** Raw rejected items are stored up to this many bytes (CLAUDE.md 5). */
const RAW_LIMIT_BYTES = 4096;

interface Checked {
  event: ClientEvent;
  session: IngestSession;
  properties: EventProperties;
  flags: Record<string, unknown>;
}

/** What the stream of ingest results (Live events, 11.1) needs to know about one item. */
interface IngestOutcome {
  result: EventResult;
  name: string | null;
  sessionId: string | null;
  stepId: string | null;
  version: number | null;
  variant: IngestSession['variant'] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (item: unknown, key: string): string | null => {
  const value = isRecord(item) ? item[key] : undefined;
  return typeof value === 'string' ? value : null;
};

/** The item as JSON with property values replaced by their keys, cut to 4 KB. */
function rawForStorage(item: unknown): string {
  const redacted =
    isRecord(item) && isRecord(item.properties)
      ? { ...item, properties: Object.keys(item.properties) }
      : item;
  const json = JSON.stringify(redacted);
  const bytes = Buffer.from(json);
  return bytes.length <= RAW_LIMIT_BYTES ? json : bytes.subarray(0, RAW_LIMIT_BYTES).toString();
}

/** A client claim differs from the session; UTM only counts when the client sent one. */
function mismatch(event: ClientEvent, session: IngestSession): boolean {
  const claimed = (value: string | undefined, actual: string | null) =>
    value !== undefined && value.trim() !== '' && value.trim() !== actual;
  return (
    event.funnel_id !== session.funnelId ||
    event.funnel_version !== session.funnelVersion ||
    event.experiment_id !== session.experimentId ||
    event.variant !== session.variant ||
    claimed(event.utm_source, session.utmSource) ||
    claimed(event.utm_medium, session.utmMedium) ||
    claimed(event.utm_campaign, session.utmCampaign)
  );
}

export function createEventsService(repo: EventsRepo, versions: VersionsService, clock: Clock) {
  return {
    ingest(envelope: { batch_id?: string | undefined; events: unknown[] }): {
      response: BatchResponse;
      outcomes: IngestOutcome[];
    } {
      const receivedAt = clock.now().toISOString();
      const batchId = envelope.batch_id ?? null;
      // Per batch: sessions read once, and the highest client_seq stored so far per
      // session, advanced as events are accepted (better-sqlite3 is synchronous, so
      // nothing else writes between these reads and the insert below).
      const sessionCache = new Map<string, IngestSession | undefined>();
      const maxSeq = new Map<string, number | null>();
      const sessionOf = (id: string) => {
        if (!sessionCache.has(id)) sessionCache.set(id, repo.session(id));
        return sessionCache.get(id);
      };

      /** The event ready to store, or why it is rejected. */
      function check(item: unknown): Checked | RejectReason {
        const parsed = ClientEventSchema.safeParse(item);
        if (!parsed.success) return 'invalid_event';
        const event = parsed.data;
        const session = sessionOf(event.session_id);
        if (!session) return 'unknown_session';
        const config = versions.config(session.funnelId, session.funnelVersion);
        const definition = catalogEvent(config.events.allowed, event.name);
        if (!definition) return 'unknown_event';
        if (isServerOnly(event.name)) return 'server_only';
        const sequence = config.experiment.variants[session.variant].stepSequence;
        if (event.step_id !== null && !sequence.includes(event.step_id)) {
          return 'unknown_step';
        }
        const { properties, dropped } = filterProperties(
          definition,
          event.properties,
          config.events.privacy,
        );
        if (!maxSeq.has(session.id)) maxSeq.set(session.id, repo.maxClientSeq(session.id));
        const highest = maxSeq.get(session.id) ?? null;
        const flags = {
          ...(dropped.length > 0 ? { dropped_props: dropped } : {}),
          ...(mismatch(event, session) ? { context_mismatch: true } : {}),
          ...(highest !== null && event.client_seq < highest ? { out_of_order: true } : {}),
        };
        maxSeq.set(session.id, Math.max(highest ?? event.client_seq, event.client_seq));
        return { event, session, properties, flags };
      }

      const items = envelope.events.map((item) => {
        const checked = check(item);
        return typeof checked === 'string'
          ? { ok: false as const, item, reason: checked }
          : { ok: true as const, checked };
      });

      const accepted = items.flatMap((i) => (i.ok ? [i.checked] : []));
      const inserted = repo.writeBatch(
        accepted.map(({ event, session, properties, flags }) => ({
          eventId: event.event_id,
          sessionId: session.id,
          name: event.name,
          funnelId: session.funnelId,
          funnelVersion: session.funnelVersion,
          experimentId: session.experimentId,
          variant: session.variant,
          stepId: event.step_id,
          utmSource: session.utmSource,
          utmMedium: session.utmMedium,
          utmCampaign: session.utmCampaign,
          clientTs: event.client_timestamp,
          serverTs: receivedAt,
          clientSeq: event.client_seq,
          origin: 'client' as const,
          propsJson: JSON.stringify(properties),
          flagsJson: JSON.stringify(flags),
        })),
        items.flatMap((i) =>
          i.ok
            ? []
            : [
                {
                  batchId,
                  eventId: stringField(i.item, 'event_id'),
                  reason: i.reason,
                  rawJson: rawForStorage(i.item),
                  receivedAt,
                },
              ],
        ),
        { batchId, receivedAt },
      );

      let next = 0;
      const outcomes = items.map((i): IngestOutcome => {
        if (!i.ok) {
          const sessionId = stringField(i.item, 'session_id');
          const session = sessionId === null ? undefined : sessionOf(sessionId);
          return {
            result: {
              event_id: stringField(i.item, 'event_id'),
              status: 'rejected',
              reason: i.reason,
            },
            name: stringField(i.item, 'name'),
            sessionId,
            stepId: stringField(i.item, 'step_id'),
            version: session?.funnelVersion ?? null,
            variant: session?.variant ?? null,
          };
        }
        const { event, session } = i.checked;
        const isNew = inserted[next++] ?? false;
        return {
          result: { event_id: event.event_id, status: isNew ? 'accepted' : 'duplicate' },
          name: event.name,
          sessionId: session.id,
          stepId: event.step_id,
          version: session.funnelVersion,
          variant: session.variant,
        };
      });

      const results = outcomes.map((o) => o.result);
      const count = (status: EventResult['status']) =>
        results.filter((r) => r.status === status).length;
      return {
        response: {
          results,
          accepted: count('accepted'),
          duplicates: count('duplicate'),
          rejected: count('rejected'),
        },
        outcomes,
      };
    },
  };
}
export type EventsService = ReturnType<typeof createEventsService>;
