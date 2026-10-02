import { connect } from 'node:net';
import Fastify from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { contract, LiveEntrySchema, type LiveEntry, type LiveEntryDraft } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { sseStreams } from '../../plugins/sse.ts';
import { adminAuth, createTestApp, type TestApp } from '../../test/harness.ts';
import { createLiveBus } from './bus.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function entry(n: number): LiveEntryDraft {
  return {
    receivedAt: '2026-10-01T12:00:00.000Z',
    eventId: `e-${String(n)}`,
    sessionId: null,
    name: null,
    stepId: null,
    version: null,
    variant: null,
    status: 'accepted',
    reason: null,
  };
}

/** Reads an open text stream until `done(text)` holds; fails after a timeout. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  done: (text: string) => boolean,
  timeoutMs = 3000,
): Promise<{ text: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`stream timed out, got: ${text}`));
    }, timeoutMs);
  });
  try {
    while (!done(text)) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return { text };
}

/** Polls until `check()` holds (server-side effects of a client disconnect are async). */
async function eventually(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const dataLines = (text: string): LiveEntry[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => LiveEntrySchema.parse(JSON.parse(line.slice('data: '.length))));

describe('live bus', () => {
  it('keeps the last entries, oldest first', () => {
    const bus = createLiveBus(3, () => 0);
    bus.publish([1, 2, 3, 4, 5].map(entry));
    expect(bus.recent().map((e) => e.eventId)).toEqual(['e-3', 'e-4', 'e-5']);
  });

  it('numbers entries with a seq that only grows, also across restarts', () => {
    let clock = 1_000;
    const bus = createLiveBus(10, () => clock);
    // The same event three times in one batch: three entries, three numbers.
    bus.publish([entry(1), entry(1), entry(1)]);
    const first = bus.recent().map((e) => e.seq);
    expect(first).toEqual([1_000_000, 1_000_001, 1_000_002]);
    // A restarted server (a new bus) a moment later continues above the old numbers.
    clock = 1_001;
    const restarted = createLiveBus(10, () => clock);
    restarted.publish([entry(2)]);
    expect(restarted.recent()[0]?.seq).toBeGreaterThan(Math.max(...first));
  });

  it('delivers new entries to subscribers until they unsubscribe', () => {
    const bus = createLiveBus(50, () => 0);
    const seen: (string | null)[] = [];
    const stop = bus.subscribe((e) => seen.push(e.eventId));
    bus.publish([entry(1)]);
    stop();
    bus.publish([entry(2)]);
    expect(seen).toEqual(['e-1']);
  });
});

describe('GET /api/live', () => {
  it('requires admin credentials', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/live' });
    expect(res.statusCode).toBe(401);
  });

  it('streams the backlog on connect, then every ingest result', async () => {
    t = await createTestApp();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { funnelId: 'workstyle-planner' },
    });
    const { session } = contract.createSession.response.parse(created.json());
    const event = {
      event_id: uuidv7(),
      session_id: session.id,
      name: 'step_viewed',
      client_timestamp: '2026-10-01T12:00:01.000Z',
      client_seq: 1,
      funnel_id: 'workstyle-planner',
      funnel_version: session.funnelVersion,
      experiment_id: session.experimentId,
      variant: session.variant,
      step_id: 'intro',
      properties: {},
    };
    const post = (events: unknown[]) =>
      t?.app.inject({ method: 'POST', url: '/api/events/batch', payload: { events } });
    await post([event]);

    const base = await t.app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const res = await fetch(`${base}/api/live`, {
      headers: { authorization: adminAuth },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = res.body;
    if (!body) throw new Error('no body');

    const backlog = await readUntil(body, (text) => dataLines(text).length >= 1);
    expect(dataLines(backlog.text)).toMatchObject([
      {
        eventId: event.event_id,
        sessionId: session.id,
        name: 'step_viewed',
        stepId: 'intro',
        version: session.funnelVersion,
        variant: session.variant,
        status: 'accepted',
        reason: null,
      },
    ]);

    const rejectedId = uuidv7();
    await post([event, { ...event, event_id: rejectedId, name: 'nope' }]);
    const next = await readUntil(body, (text) => dataLines(text).length >= 2);
    expect(dataLines(next.text)).toMatchObject([
      { eventId: event.event_id, status: 'duplicate', reason: null },
      {
        eventId: rejectedId,
        sessionId: session.id,
        name: 'nope',
        // A rejected event of a known session still shows the session's version and variant.
        version: session.funnelVersion,
        variant: session.variant,
        status: 'rejected',
        reason: 'unknown_event',
      },
    ]);
    expect(t.services.live.subscribers()).toBe(1);
    controller.abort();
    await eventually(() => t?.services.live.subscribers() === 0);
  });

  it('gives every result of a batch its own entry, even for the same event', async () => {
    t = await createTestApp();
    const id = uuidv7();
    const item = { event_id: id, name: 'nope' };
    await t.app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload: { events: [item, item, item] },
    });
    const entries = t.services.live.recent();
    expect(entries.map((e) => e.eventId)).toEqual([id, id, id]);
    expect(new Set(entries.map((e) => e.seq)).size).toBe(3);
  });

  it('cuts untrusted strings of rejected items short', async () => {
    t = await createTestApp();
    await t.app.inject({
      method: 'POST',
      url: '/api/events/batch',
      payload: { events: [{ event_id: 'x'.repeat(10_000), name: 'n'.repeat(10_000) }] },
    });
    const [entry] = t.services.live.recent();
    expect(entry?.eventId).toHaveLength(200);
    expect(entry?.name).toHaveLength(200);
  });

  it('streams without credentials when ADMIN_AUTH=off', async () => {
    t = await createTestApp({ env: { adminAuth: { mode: 'off' } } });
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 });
    const res = await fetch(`${base}/api/live`);
    expect(res.status).toBe(200);
    const body = res.body;
    if (!body) throw new Error('no body');
    await readUntil(body, (text) => text.includes(': connected'));
    await body.cancel();
  });

  it('ends open streams when the server shuts down', async () => {
    t = await createTestApp();
    const base = await t.app.listen({ host: '127.0.0.1', port: 0 });
    const res = await fetch(`${base}/api/live`, { headers: { authorization: adminAuth } });
    const body = res.body;
    if (!body) throw new Error('no body');
    await readUntil(body, (text) => text.includes(': connected'));
    await t.close();
    t = undefined;
    const rest = await readUntil(body, () => false);
    expect(rest.text).toBe('');
  });
});

describe('sse plugin', () => {
  it('destroys a stream whose unsent buffer grows past the cap', async () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    const start = sseStreams(app, 60_000);
    let ended = false;
    let destroyedOnClose: boolean | undefined;
    app.get('/flood', (_req, reply) => {
      const stream = start(reply);
      stream.onClose(() => {
        ended = true;
        // Read at once: the kernel may drain the buffer later on its own, which would
        // hide a plain `end()` that leaves the socket open behind a queued FIN.
        destroyedOnClose = reply.raw.destroyed;
      });
      const chunk = 'x'.repeat(64 * 1024);
      for (let i = 0; i < 200 && !ended; i++) stream.send(chunk);
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    // A raw socket that never reads: nothing drains, so the buffer only grows.
    const socket = connect(address.port, '127.0.0.1');
    socket.pause();
    socket.write('GET /flood HTTP/1.1\r\nHost: localhost\r\n\r\n');
    try {
      await eventually(() => ended);
      // `end()` would only queue a FIN behind the 1 MB already buffered and keep the
      // socket (and buffer) until the peer leaves; the slow client must be cut off now.
      expect(destroyedOnClose).toBe(true);
    } finally {
      socket.destroy();
      await app.close();
    }
  });

  it('sends a heartbeat comment while the stream is idle', async () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    const start = sseStreams(app, 20);
    app.get('/stream', (_req, reply) => {
      start(reply);
    });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const res = await fetch(`${base}/stream`);
      const body = res.body;
      if (!body) throw new Error('no body');
      const { text } = await readUntil(body, (s) => s.split(': heartbeat').length > 2);
      expect(text.startsWith(': connected\n\n')).toBe(true);
    } finally {
      await app.close();
    }
  });
});
