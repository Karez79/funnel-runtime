import { DomainError } from '@funnel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, errorDetails } from './api.ts';

function respond(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const health = { status: 'ok', version: 'test', db: 'ok' };

describe('call', () => {
  it('builds method, path params, query and JSON body from the contract', async () => {
    const fetchMock = stubFetch(
      respond(201, {
        activation: {
          id: 1,
          version: 2,
          action: 'publish',
          fromVersion: 1,
          note: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );
    await call('publishVersion', { params: { v: 2 }, body: { note: 'go' } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/versions/2/publish');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ note: 'go' }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('encodes path params and skips undefined query values', async () => {
    const fetchMock = stubFetch(respond(200, { funnel: {} }));
    await expect(
      call('previewVersion', { params: { v: 3 }, query: { variant: 'B' } }),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/versions/3/preview?variant=B');
    const fetchNoQuery = stubFetch(respond(200, { funnel: {} }));
    await expect(
      call('previewVersion', { params: { v: 3 }, query: { variant: undefined } }),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(fetchNoQuery.mock.calls[0]?.[0]).toBe('/api/admin/versions/3/preview');

    const fetch2 = stubFetch(respond(404, { error: { code: 'not_found', message: 'nope' } }));
    await expect(call('getSession', { params: { id: 'a/b' } })).rejects.toBeInstanceOf(DomainError);
    expect(fetch2.mock.calls[0]?.[0]).toBe('/api/sessions/a%2Fb');
  });

  it('parses the response with the route schema', async () => {
    stubFetch(respond(200, { ...health, extra: true }));
    await expect(call('health', {})).resolves.toEqual(health);
  });

  it('rejects a response that does not match the contract', async () => {
    stubFetch(respond(200, { status: 'broken' }));
    await expect(call('health', {})).rejects.toMatchObject({ code: 'internal' });
  });

  it('turns the error envelope into a DomainError with code, status and details', async () => {
    const details = { state: { answers: {}, history: [], currentStepId: 'intro' }, stateRev: 4 };
    stubFetch(respond(409, { error: { code: 'conflict', message: 'stale', details } }));
    const error = await call('saveState', {
      params: { id: 's1' },
      body: { state: { answers: {}, history: [], currentStepId: 'intro' }, baseRev: 1 },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'conflict', status: 409, message: 'stale' });
    expect(errorDetails('saveState', 'conflict', error)).toEqual(details);
    expect(errorDetails('saveState', 'unprocessable', error)).toBeUndefined();
    // Details that do not match the contract are not handed out as typed.
    const broken = new DomainError('conflict', 'stale', { stateRev: 'x' });
    expect(errorDetails('saveState', 'conflict', broken)).toBeUndefined();
  });

  it('maps an error without the envelope by its status', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(call('health', {})).rejects.toMatchObject({ code: 'unavailable' });
    stubFetch(new Response('gone', { status: 410 }));
    await expect(call('health', {})).rejects.toMatchObject({ code: 'gone' });
    stubFetch(new Response('teapot', { status: 418 }));
    await expect(call('health', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('reports a network failure as unavailable and passes aborts through', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(call('health', {})).rejects.toMatchObject({ code: 'unavailable' });
    const abort = new DOMException('aborted', 'AbortError');
    stubFetch(abort);
    await expect(call('health', {})).rejects.toBe(abort);
  });

  it('sends keepalive and the abort signal when asked', async () => {
    const fetchMock = stubFetch(respond(200, health));
    const controller = new AbortController();
    await call('health', {}, { keepalive: true, signal: controller.signal });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      keepalive: true,
      signal: controller.signal,
      credentials: 'same-origin',
    });
  });
});
