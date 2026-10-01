import Fastify from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { contract, LiveEntrySchema, type LiveEntry } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { sseStreams } from '../../plugins/sse.ts';
import { adminAuth, createTestApp, type TestApp } from '../../test/harness.ts';
import { createLiveBus } from './bus.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function entry(n: number): LiveEntry {
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
): Promise<{ text: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (!done(text)) {
    if (Date.now() > deadline) throw new Error(`stream timed out, got: ${text}`);
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  reader.releaseLock();
  return { text, reader };
}

const dataLines = (text: string): LiveEntry[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => LiveEntrySchema.parse(JSON.parse(line.slice('data: '.length))));

describe('live bus', () => {
  it('keeps the last entries, oldest first', () => {
    const bus = createLiveBus(3);
    bus.publish([1, 2, 3, 4, 5].map(entry));
    expect(bus.recent().map((e) => e.eventId)).toEqual(['e-3', 'e-4', 'e-5']);
  });

  it('delivers new entries to subscribers until they unsubscribe', () => {
    const bus = createLiveBus(50);
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

    await post([event, { ...event, event_id: uuidv7(), name: 'nope' }]);
    const next = await readUntil(body, (text) => dataLines(text).length >= 2);
    expect(dataLines(next.text).map((e) => [e.status, e.reason])).toEqual([
      ['duplicate', null],
      ['rejected', 'unknown_event'],
    ]);
    controller.abort();
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
