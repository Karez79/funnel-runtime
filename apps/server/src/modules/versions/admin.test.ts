import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorBody } from '@funnel/shared';
import { z } from 'zod';
import { adminAuth, configJson, createTestApp, type TestApp } from '../../test/harness.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const auth = { authorization: adminAuth };

async function api(method: 'GET' | 'POST', url: string, payload?: unknown) {
  if (!t) throw new Error('no app');
  const res = await t.app.inject({
    method,
    url,
    headers: auth,
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    ...(payload === undefined ? {} : { headers: { ...auth, 'content-type': 'application/json' } }),
  });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

const activeVersion = async () => {
  const res = await api('GET', '/api/funnel/workstyle-planner/active');
  return res.body.version;
};

describe('admin auth', () => {
  it.each([
    ['GET', '/api/admin/versions'],
    ['POST', '/api/admin/versions/2/publish'],
    ['POST', '/api/admin/rollback'],
    ['GET', '/api/admin/versions/2/preview'],
  ] as const)('%s %s needs credentials', async (method, url) => {
    t = await createTestApp();
    const res = await t.app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/admin/versions', () => {
  it('lists versions with state, activity and session counts, and the journal', async () => {
    t = await createTestApp();
    const res = await api('GET', '/api/admin/versions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      versions: [
        expect.objectContaining({
          version: 1,
          state: 'published',
          active: true,
          activatedAt: '2026-10-01T12:00:00.000Z',
          activeSessions: 0,
          totalSessions: 0,
        }),
        expect.objectContaining({
          version: 2,
          state: 'draft',
          active: false,
          activatedAt: null,
          releaseNote:
            'Adds meeting-load input and a meeting-heavy result while preserving the v1 schema.',
        }),
      ],
      activations: [expect.objectContaining({ version: 1, action: 'publish', fromVersion: null })],
    });
  });

  it('counts sessions in progress separately from finished and expired ones', async () => {
    t = await createTestApp();
    const insert = (id: string, expiresAt: string, resultId: string | null) =>
      t?.handle.db.run(sql`insert into sessions (id, funnel_id, funnel_version, experiment_id,
        variant, variant_source, state_json, result_id, created_at, updated_at, expires_at)
        values (${id}, 'workstyle-planner', 1, 'x', 'A', 'hash', '{}', ${resultId},
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', ${expiresAt})`);
    insert('in-progress', '2026-10-09T00:00:00.000Z', null);
    insert('finished', '2026-10-09T00:00:00.000Z', 'async_first');
    insert('expired', '2026-09-01T00:00:00.000Z', null);
    const res = await api('GET', '/api/admin/versions');
    expect(res.body.versions).toEqual([
      expect.objectContaining({ version: 1, activeSessions: 1, totalSessions: 3 }),
      expect.objectContaining({ version: 2, activeSessions: 0, totalSessions: 0 }),
    ]);
  });

  it('answers 404 before anything is stored', async () => {
    t = await createTestApp({ seed: false });
    expect((await api('GET', '/api/admin/versions')).status).toBe(404);
    expect((await api('GET', '/api/admin/versions/active')).status).toBe(404);
  });
});

describe('GET /api/admin/versions/active', () => {
  it('returns the active version and its config as uploaded', async () => {
    t = await createTestApp();
    const res = await api('GET', '/api/admin/versions/active');
    expect(res.status).toBe(200);
    expect(res.body.version).toMatchObject({ version: 1, active: true });
    // `status` is not part of the schema but is kept as uploaded (4.1).
    expect(res.body.config).toMatchObject({ version: 1, status: 'published' });
  });
});

describe('POST /api/admin/versions', () => {
  const upload = (config: unknown, query = '') =>
    api('POST', `/api/admin/versions${query}`, config);

  it('stores a draft and reports lint; the same config again is not a new version', async () => {
    t = await createTestApp();
    const config = configJson('funnel-v2.json', { version: 3 });
    const first = await upload(config, '?releaseNote=Third');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      created: true,
      version: { version: 3, state: 'draft', releaseNote: 'Third', active: false },
      lint: { errors: [] },
    });
    const again = await upload(config);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ created: false, version: { version: 3 } });
  });

  it('answers 422 with the schema issues', async () => {
    t = await createTestApp();
    const res = await upload({ funnelId: 'workstyle-planner' });
    expect(res.status).toBe(422);
    const { error } = ErrorBody.parse(res.body);
    expect(error.code).toBe('unprocessable');
    expect(z.object({ issues: z.array(z.string()) }).parse(error.details).issues).toContain(
      'version: Invalid input: expected number, received undefined',
    );
  });
});

describe('GET /api/admin/versions/:v/diff', () => {
  it('compares a draft with the active version by default', async () => {
    t = await createTestApp();
    const res = await api('GET', '/api/admin/versions/2/diff');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, against: 1, lint: { errors: [] } });
    expect(res.body.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'step_added', subject: 'meeting_hours' }),
      ]),
    );
  });

  it('compares with an explicit version, and a version with itself has no changes', async () => {
    t = await createTestApp();
    const res = await api('GET', '/api/admin/versions/2/diff?against=2');
    expect(res.body).toMatchObject({ version: 2, against: 2, changes: [] });
  });

  it('answers 404 for an unknown version', async () => {
    t = await createTestApp();
    expect((await api('GET', '/api/admin/versions/9/diff')).status).toBe(404);
    expect((await api('GET', '/api/admin/versions/2/diff?against=9')).status).toBe(404);
  });
});

describe('GET /api/admin/versions/:v/preview', () => {
  it('resolves any stored version for a variant without creating sessions or events', async () => {
    t = await createTestApp();
    const res = await api('GET', '/api/admin/versions/2/preview?variant=B');
    expect(res.status).toBe(200);
    expect(res.body.funnel).toMatchObject({ meta: { version: 2, variant: 'B' } });
    const rows = t.handle.db.get<{ s: number; e: number }>(
      sql`select (select count(*) from sessions) as s, (select count(*) from events) as e`,
    );
    expect(rows).toEqual({ s: 0, e: 0 });
  });

  it('uses variant A by default', async () => {
    t = await createTestApp();
    const res = await api('GET', '/api/admin/versions/1/preview');
    expect(res.body.funnel).toMatchObject({ meta: { variant: 'A' } });
  });
});

describe('test 4: publish and rollback', () => {
  it('blocks publishing a version with lint errors', async () => {
    t = await createTestApp();
    await api(
      'POST',
      '/api/admin/versions',
      configJson('funnel-v2.json', { version: 3, defaultResultId: 'missing' }),
    );
    const res = await api('POST', '/api/admin/versions/3/publish', {});
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: { details: { errors: [expect.objectContaining({ code: 'unknown_result' })] } },
    });
    expect(await activeVersion()).toBe(1);
  });

  it('publishes v2, rolls back to v1 and keeps the whole journal', async () => {
    t = await createTestApp();
    const published = await api('POST', '/api/admin/versions/2/publish', { note: 'ship it' });
    expect(published.status).toBe(200);
    expect(published.body.activation).toMatchObject({
      version: 2,
      action: 'publish',
      fromVersion: 1,
      note: 'ship it',
    });
    expect(await activeVersion()).toBe(2);

    const rolledBack = await api('POST', '/api/admin/rollback');
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.activation).toMatchObject({
      version: 1,
      action: 'rollback',
      fromVersion: 2,
    });
    expect(await activeVersion()).toBe(1);

    const list = await api('GET', '/api/admin/versions');
    expect(list.body.activations).toEqual([
      expect.objectContaining({ version: 1, action: 'rollback', fromVersion: 2 }),
      expect.objectContaining({ version: 2, action: 'publish', fromVersion: 1 }),
      expect.objectContaining({ version: 1, action: 'publish', fromVersion: null }),
    ]);
    // Both versions are still stored and published; nothing was deleted.
    expect(list.body.versions).toEqual([
      expect.objectContaining({ version: 1, state: 'published', active: true }),
      expect.objectContaining({ version: 2, state: 'published', active: false }),
    ]);
  });

  it('answers 409 when there is nothing to roll back to', async () => {
    t = await createTestApp();
    const res = await api('POST', '/api/admin/rollback', {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'conflict' } });
  });

  it('activates any published version and refuses drafts and the active one', async () => {
    t = await createTestApp();
    expect((await api('POST', '/api/admin/versions/2/activate')).status).toBe(409);
    await api('POST', '/api/admin/versions/2/publish');
    expect((await api('POST', '/api/admin/versions/2/activate')).status).toBe(409);
    const res = await api('POST', '/api/admin/versions/1/activate', { note: 'back' });
    expect(res.status).toBe(200);
    expect(res.body.activation).toMatchObject({ version: 1, action: 'activate', fromVersion: 2 });
    expect(await activeVersion()).toBe(1);
    expect((await api('POST', '/api/admin/versions/9/activate')).status).toBe(404);
  });

  it('refuses to publish a published version again', async () => {
    t = await createTestApp();
    expect((await api('POST', '/api/admin/versions/1/publish')).status).toBe(409);
  });
});
