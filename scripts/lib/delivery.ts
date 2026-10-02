// Event delivery of the generator, with the faults ingest must survive (CLAUDE.md 9.1):
// copies of an event in the same or the next batch, whole batches sent again as after a
// timeout, sessions whose events arrive shuffled, and a few broken events.
//
// Batches go out one at a time, so the order the server processes them in is the order
// they leave here. That lets the generator keep its own record of what it expects: the
// first delivery of an event is stored, every later copy is a duplicate, and an event
// whose `client_seq` is below the highest one already delivered for its session is out
// of order (7.3). The ground truth is built from this record, never from the server's
// answers; the answers are only compared with it, to report surprises early.
import type { ClientEvent, REJECT_REASONS } from '@funnel/shared';
import type { Client } from './http.ts';

type RejectReason = (typeof REJECT_REASONS)[number];

interface Item {
  readonly event: ClientEvent;
  readonly mismatch: boolean;
}

/** How an event is sent besides once: a copy in its own batch or in the next one. */
export type Copy = 'none' | 'same' | 'next';

export interface Outgoing {
  readonly event: ClientEvent;
  readonly copy: Copy;
  /** The event claims a context that differs from its session (7.3 context_mismatch). */
  readonly mismatch: boolean;
}

export interface Delivered {
  readonly event: ClientEvent;
  readonly outOfOrder: boolean;
  readonly contextMismatch: boolean;
  /** Server time of the batch that stored it. */
  readonly serverTs: string;
}

export interface DeliveryOptions {
  readonly batchSize: number;
  /** Whether the batch just sent goes out a second time, as after a timeout. */
  readonly resend: () => boolean;
  /** Called with the server's Date of every answer. */
  readonly onDate: (date: Date) => void;
}

export function createDelivery(call: Client, options: DeliveryOptions) {
  const pending: Outgoing[] = [];
  let carried: Item[] = [];
  const delivered = new Map<string, Delivered>();
  const highestSeq = new Map<string, number>();
  const rejected = new Map<RejectReason, number>();
  const surprises: string[] = [];
  let duplicates = 0;
  let batches = 0;
  let resent = 0;
  let queue: Promise<void> = Promise.resolve();

  /** What the server must answer for `event`, updating the record as the server would. */
  function expect(
    event: ClientEvent,
    mismatch: boolean,
    serverTs: string,
  ): 'accepted' | 'duplicate' {
    const highest = highestSeq.get(event.session_id);
    highestSeq.set(event.session_id, Math.max(highest ?? event.client_seq, event.client_seq));
    if (delivered.has(event.event_id)) {
      duplicates += 1;
      return 'duplicate';
    }
    delivered.set(event.event_id, {
      event,
      outOfOrder: highest !== undefined && event.client_seq < highest,
      contextMismatch: mismatch,
      serverTs,
    });
    return 'accepted';
  }

  async function post(items: readonly Item[]): Promise<void> {
    batches += 1;
    const batchId = `generator-${String(batches)}`;
    const { data, date } = await call('eventsBatch', {
      body: { batch_id: batchId, events: items.map((i) => i.event) },
    });
    options.onDate(date);
    items.forEach((item, i) => {
      const want = expect(item.event, item.mismatch, date.toISOString());
      const got = data.results[i]?.status;
      if (got !== want) {
        surprises.push(
          `${batchId} ${item.event.name} ${item.event.event_id}: ${String(got)}, expected ${want}`,
        );
      }
    });
  }

  async function sendBatch(group: readonly Outgoing[]): Promise<void> {
    const items: Item[] = carried;
    carried = [];
    for (const { event, mismatch, copy } of group) {
      items.push({ event, mismatch });
      if (copy === 'same') items.push({ event, mismatch });
      if (copy === 'next') carried.push({ event, mismatch });
    }
    await post(items);
    if (options.resend()) {
      resent += 1;
      await post(items);
    }
  }

  /** Runs after everything queued before it: batches never overlap. */
  function serial(task: () => Promise<void>): Promise<void> {
    queue = queue.then(task);
    return queue;
  }

  return {
    /** Queues events; full batches go out in the order they were queued. */
    enqueue(events: readonly Outgoing[]): Promise<void> {
      pending.push(...events);
      return serial(async () => {
        while (pending.length >= options.batchSize) {
          await sendBatch(pending.splice(0, options.batchSize));
        }
      });
    },

    /** Sends everything left, including copies carried over to a next batch. */
    drain(): Promise<void> {
      return serial(async () => {
        while (pending.length > 0 || carried.length > 0) {
          await sendBatch(pending.splice(0, options.batchSize));
        }
      });
    },

    /** Items the server must reject, each with the reason it must give. */
    sendBroken(items: readonly { item: unknown; reason: RejectReason }[]): Promise<void> {
      return serial(async () => {
        batches += 1;
        const { data, date } = await call('eventsBatch', {
          body: { batch_id: `generator-broken`, events: items.map((i) => i.item) },
        });
        options.onDate(date);
        items.forEach(({ reason }, i) => {
          rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
          const got = data.results[i];
          const gotReason = got?.status === 'rejected' ? got.reason : got?.status;
          if (gotReason !== reason)
            surprises.push(`broken #${String(i)}: ${String(gotReason)}, expected ${reason}`);
        });
      });
    },

    /** The record the ground truth is built from. */
    report() {
      return {
        delivered: [...delivered.values()],
        duplicates,
        // The analytics API lists reasons in ascending order (SQL ORDER BY reason).
        rejected: [...rejected]
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)),
        batches,
        resent,
        surprises,
      };
    },
  };
}
export type Delivery = ReturnType<typeof createDelivery>;
