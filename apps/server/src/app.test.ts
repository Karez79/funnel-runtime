import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { basicAuth } from './plugins/auth.ts';
import { loadEnv } from './env.ts';
import { adminAuth, createTestApp, type TestApp } from './test/harness.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('GET /api/health', () => {
  it('reports build version and a working database', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'test', db: 'ok' });
  });

  it('returns 503 when the database is gone', async () => {
    t = await createTestApp();
    t.handle.close();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'error' });
    t.handle.close = () => undefined;
  });

  it('sets a same-origin content security policy', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('migrations', () => {
  it('create every table from the data model', async () => {
    t = await createTestApp();
    const rows = t.handle.db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not glob '__*' and name != 'sqlite_sequence' order by name`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'events',
      'funnel_activations',
      'funnel_versions',
      'ingest_log',
      'rejected_events',
      'sessions',
    ]);
  });
});

describe('unknown routes and static web', () => {
  it('answers unknown API paths with a JSON 404', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('serves index.html for client-side routes when the web build exists', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'funnel-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>funnel</title>');
    try {
      t = await createTestApp({ webDist: dist });
      const res = await t.app.inject({ method: 'GET', url: '/s/team_size' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>funnel</title>');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('basic auth', () => {
  async function guarded(header: string | undefined): Promise<number> {
    t = await createTestApp();
    t.app.get('/api/admin/probe', { preHandler: basicAuth('admin', 'secret') }, () => ({
      ok: true,
    }));
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/admin/probe',
      headers: header === undefined ? {} : { authorization: header },
    });
    return res.statusCode;
  }

  it('accepts the configured credentials', async () => {
    expect(await guarded(adminAuth)).toBe(200);
  });

  it.each([
    ['no header', undefined],
    ['wrong password', `Basic ${Buffer.from('admin:nope').toString('base64')}`],
    ['no separator', `Basic ${Buffer.from('admin').toString('base64')}`],
    ['other scheme', 'Bearer abc'],
  ])('rejects %s with 401', async (_name, header) => {
    expect(await guarded(header)).toBe(401);
  });
});

describe('loadEnv', () => {
  it('uses local defaults outside production', () => {
    const env = loadEnv({});
    expect(env).toMatchObject({ port: 3000, adminUser: 'admin', buildVersion: 'dev' });
  });

  it('refuses to start in production without secrets', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/ADMIN_USER/);
  });

  it('takes the build version from the Railway commit', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      ADMIN_USER: 'u',
      ADMIN_PASSWORD: 'p',
      GENERATOR_KEY: 'k',
      RAILWAY_GIT_COMMIT_SHA: 'abcdef1234',
      PORT: '8080',
    });
    expect(env).toMatchObject({ buildVersion: 'abcdef1', port: 8080 });
  });
});
