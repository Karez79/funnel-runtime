import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { contract, DomainError, type RouteDef } from '@funnel/shared';
import { z } from 'zod';
import { route } from './plugins/route.ts';
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
    expect(res.json()).toEqual({
      error: {
        code: 'unavailable',
        message: 'Database unavailable',
        details: { version: 'test', db: 'error' },
      },
    });
  });

  it('sets a same-origin content security policy', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('GET /api/admin/schema', () => {
  it('fingerprints the schema for admins: stable on reads, different after any DDL', async () => {
    t = await createTestApp();
    const app = t.app;
    const read = async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/schema',
        headers: { authorization: adminAuth },
      });
      expect(res.statusCode).toBe(200);
      return contract.dbSchema.response.parse(res.json());
    };
    expect((await app.inject({ method: 'GET', url: '/api/admin/schema' })).statusCode).toBe(401);
    const first = await read();
    expect(first.migrations).toBeGreaterThan(0);
    expect(await read()).toEqual(first);
    t.handle.db.run(sql`create index sessions_result_idx on sessions(result_id)`);
    const after = await read();
    expect(after.hash).not.toBe(first.hash);
    expect(after.objects).toBe(first.objects + 1);
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
      'ground_truth',
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

  it('accepts a web build path relative to the working directory', async () => {
    const dist = mkdtempSync(join(process.cwd(), '.tmp-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>rel</title>');
    try {
      t = await createTestApp({ env: { webDist: relative(process.cwd(), dist) } });
      const res = await t.app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('<title>rel</title>');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('serves index.html for client-side routes when the web build exists', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'funnel-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>funnel</title>');
    try {
      t = await createTestApp({ env: { webDist: dist } });
      const res = await t.app.inject({ method: 'GET', url: '/s/team_size' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>funnel</title>');
      const head = await t.app.inject({
        method: 'HEAD',
        url: '/admin/versions',
        headers: { authorization: adminAuth },
      });
      expect(head.statusCode).toBe(200);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('asks for admin credentials before serving an admin page', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'funnel-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>funnel</title>');
    try {
      t = await createTestApp({ env: { webDist: dist } });
      for (const url of [
        '/admin',
        '/admin/live?session=1',
        '/admin/versions',
        '/Admin',
        '//admin',
        '/%61dmin',
      ]) {
        const res = await t.app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(401);
        expect(res.headers['www-authenticate']).toContain('Basic');
      }
      // A malformed escape never reaches the page: Fastify rejects the URL first.
      const malformed = await t.app.inject({ method: 'GET', url: '/admin/%E0%A4%A' });
      expect(malformed.statusCode).toBe(400);
      const page = await t.app.inject({
        method: 'GET',
        url: '/admin',
        headers: { authorization: adminAuth },
      });
      expect(page.statusCode).toBe(200);
      // Not an admin page: the funnel stays public.
      expect((await t.app.inject({ method: 'GET', url: '/administer' })).statusCode).toBe(200);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('ADMIN_AUTH=off', () => {
  it('opens admin APIs and admin pages without credentials', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'funnel-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>funnel</title>');
    try {
      t = await createTestApp({ env: { adminAuth: { mode: 'off' }, webDist: dist } });
      for (const url of [
        '/api/admin/schema',
        '/api/admin/versions',
        '/api/admin/versions/active',
        '/api/admin/versions/2/preview?variant=B',
        '/api/analytics/filters',
        '/api/analytics/summary',
        '/admin',
        '/admin/versions',
      ]) {
        const res = await t.app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
      }
      // Credentials a script still sends are simply ignored.
      const withCreds = await t.app.inject({
        method: 'POST',
        url: '/api/admin/versions/2/publish',
        headers: { authorization: 'Basic d3Jvbmc6d3Jvbmc=' },
      });
      expect(withCreds.statusCode).toBe(200);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('contract routes', () => {
  const probe = {
    method: 'POST',
    path: '/api/admin/probe',
    auth: 'admin',
    status: 201,
    bodyLimit: 64,
    body: z.object({ n: z.number().int() }),
    response: z.object({ doubled: z.number() }),
  } as const satisfies RouteDef;

  async function call(headers: Record<string, string>, payload: string) {
    t = await createTestApp();
    route(t.app, probe, (req) => {
      if (req.body.n < 0) throw new DomainError('conflict', 'negative', { n: req.body.n });
      if (req.body.n === 13) throw new Error('secret internals');
      return { doubled: req.body.n * 2 };
    });
    return t.app.inject({
      method: 'POST',
      url: probe.path,
      headers: { 'content-type': 'application/json', ...headers },
      payload,
    });
  }
  const auth = { authorization: adminAuth };

  it('runs the handler with the declared success status', async () => {
    const res = await call(auth, '{"n":2}');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ doubled: 4 });
  });

  it('checks credentials before parsing the body', async () => {
    const res = await call({}, '{not json');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'unauthorized', message: 'Admin credentials required' },
    });
  });

  it.each([
    ['wrong password', `Basic ${Buffer.from('admin:nope').toString('base64')}`],
    ['no separator', `Basic ${Buffer.from('admin').toString('base64')}`],
    ['other scheme', 'Bearer abc'],
  ])('rejects %s with 401', async (_name, header) => {
    const res = await call({ authorization: header }, '{"n":1}');
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['malformed JSON', '{not json', 400, 'invalid_request'],
    ['schema violation', '{"n":1.5}', 400, 'invalid_request'],
    [
      'body over the route limit',
      JSON.stringify({ n: 1, pad: 'x'.repeat(100) }),
      413,
      'payload_too_large',
    ],
  ])('renders %s in the shared envelope', async (_name, payload, status, code) => {
    const res = await call(auth, payload);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ error: { code } });
  });

  it('renders a DomainError with its status and details', async () => {
    const res = await call(auth, '{"n":-1}');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'conflict', message: 'negative', details: { n: -1 } },
    });
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await call(auth, '{"n":13}');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'Internal server error' } });
  });
});

describe('loadEnv', () => {
  it('uses local defaults outside production', () => {
    const env = loadEnv({});
    expect(env).toMatchObject({ port: 3000, buildVersion: 'dev' });
  });

  it('refuses to start in production without secrets', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/ADMIN_USER/);
  });

  it('keeps Basic Auth on by default and opens the admin only with ADMIN_AUTH=off', () => {
    expect(loadEnv({}).adminAuth).toEqual({ mode: 'basic', user: 'admin', password: 'admin' });
    expect(
      loadEnv({ ADMIN_AUTH: 'basic', ADMIN_USER: 'u', ADMIN_PASSWORD: 'p' }).adminAuth,
    ).toEqual({ mode: 'basic', user: 'u', password: 'p' });
    // Production needs no admin credentials when the admin is deliberately open.
    const open = loadEnv({ NODE_ENV: 'production', ADMIN_AUTH: 'off', GENERATOR_KEY: 'k' });
    expect(open.adminAuth).toEqual({ mode: 'off' });
    expect(() => loadEnv({ ADMIN_AUTH: 'none' })).toThrow(/ADMIN_AUTH/);
  });

  it('reads the client IP from X-Real-IP in production only, unless configured', () => {
    const prod = {
      NODE_ENV: 'production',
      ADMIN_USER: 'u',
      ADMIN_PASSWORD: 'p',
      GENERATOR_KEY: 'k',
    };
    expect(loadEnv(prod).clientIpHeader).toBe('x-real-ip');
    expect(loadEnv({ ...prod, CLIENT_IP_HEADER: '' }).clientIpHeader).toBeNull();
    expect(loadEnv({ CLIENT_IP_HEADER: 'CF-Connecting-IP' }).clientIpHeader).toBe(
      'cf-connecting-ip',
    );
    expect(loadEnv({}).clientIpHeader).toBeNull();
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
