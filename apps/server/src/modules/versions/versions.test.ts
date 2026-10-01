import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '@funnel/shared';
import { z } from 'zod';
import { seedIfEmpty } from '../../db/seed.ts';
import { configJson, createTestApp, testClock, type TestApp } from '../../test/harness.ts';
import { createVersionsRepo } from './repo.ts';
import { createVersionsService } from './service.ts';

const FUNNEL = 'workstyle-planner';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(seed = true) {
  t = await createTestApp({ seed });
  const repo = createVersionsRepo(t.handle.db);
  const clock = testClock();
  return { db: t.handle.db, repo, clock, service: createVersionsService(repo, clock) };
}

function domainError(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

describe('seed', () => {
  it('publishes v1 as the active version and stores v2 as a draft', async () => {
    const { repo, service } = await setup();
    expect(repo.list().map((v) => [v.version, v.state])).toEqual([
      [1, 'published'],
      [2, 'draft'],
    ]);
    expect(service.active(FUNNEL).version).toBe(1);
    expect(repo.latestActivation(FUNNEL)).toMatchObject({
      version: 1,
      action: 'publish',
      fromVersion: null,
      note: 'seed',
    });
  });

  it('takes the release note from the config', async () => {
    const { repo } = await setup();
    expect(repo.get(FUNNEL, 2)?.releaseNote).toMatch(/meeting-load/);
  });

  it('does nothing once any version exists', async () => {
    const { db, repo } = await setup();
    expect(seedIfEmpty(db)).toBe(false);
    expect(repo.list()).toHaveLength(2);
  });

  it('rolls back completely and forgets what it read when a config is broken', async () => {
    const { repo, service } = await setup(false);
    expect(() => service.seedIfEmpty(configJson('funnel-v1.json'), [{ broken: true }])).toThrow(
      DomainError,
    );
    expect(repo.isEmpty()).toBe(true);
    expect(service.findActive(FUNNEL)).toBeNull();
  });
});

describe('upload', () => {
  it('stores a new config as a draft with its lint report', async () => {
    const { repo, service, clock } = await setup();
    const res = service.upload(configJson('funnel-v2.json', { version: 3 }), 'third');
    expect(res.created).toBe(true);
    expect(res.lint.errors).toEqual([]);
    expect(repo.get(FUNNEL, 3)).toMatchObject({
      state: 'draft',
      releaseNote: 'third',
      createdAt: clock.now().toISOString(),
    });
    expect(repo.get(FUNNEL, 3)?.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent for the same config', async () => {
    const { repo, service } = await setup();
    const again = service.upload(configJson('funnel-v2.json'));
    expect(again.created).toBe(false);
    expect(again.row.version).toBe(2);
    expect(repo.list()).toHaveLength(2);
  });

  it('rejects a config that does not match the schema with the issues', async () => {
    const { service } = await setup();
    const err = domainError(() => service.upload({ funnelId: FUNNEL }));
    expect(err.code).toBe('unprocessable');
    const { issues } = z.object({ issues: z.array(z.string()) }).parse(err.details);
    expect(issues).toContain('schemaVersion: Invalid input: expected string, received undefined');
  });

  it.each([
    ['a version number already taken', { version: 2, title: 'changed' }, 'version_order'],
    ['another funnel', { version: 3, funnelId: 'other-funnel' }, 'funnel_id'],
  ])('rejects %s, which cannot be stored', async (_name, patch, code) => {
    const { repo, service } = await setup();
    const err = domainError(() => service.upload(configJson('funnel-v2.json', patch)));
    expect(err.code).toBe('unprocessable');
    expect(err.details).toEqual({ issues: [expect.stringMatching(new RegExp(`^${code}: `))] });
    expect(repo.list()).toHaveLength(2);
  });

  it('stores a draft with other lint errors so they can be reviewed', async () => {
    const { repo, service } = await setup();
    const res = service.upload(
      configJson('funnel-v2.json', { version: 3, defaultResultId: 'missing' }),
    );
    expect(res.created).toBe(true);
    expect(res.lint.errors.map((e) => e.code)).toContain('unknown_result');
    expect(repo.get(FUNNEL, 3)?.state).toBe('draft');
  });
});

describe('publish', () => {
  it('makes the draft published and active in one journal row', async () => {
    const { repo, service } = await setup();
    const activation = service.publish(FUNNEL, 2, 'go');
    expect(activation).toMatchObject({ version: 2, action: 'publish', fromVersion: 1, note: 'go' });
    expect(repo.get(FUNNEL, 2)?.state).toBe('published');
    expect(service.active(FUNNEL).version).toBe(2);
  });

  it('is blocked by lint errors and changes nothing', async () => {
    const { repo, service } = await setup();
    service.upload(configJson('funnel-v2.json', { version: 3, defaultResultId: 'missing' }));
    const err = domainError(() => service.publish(FUNNEL, 3));
    expect(err.code).toBe('unprocessable');
    expect(err.details).toMatchObject({
      errors: [expect.objectContaining({ code: 'unknown_result' })],
    });
    expect(repo.get(FUNNEL, 3)?.state).toBe('draft');
    expect(service.active(FUNNEL).version).toBe(1);
  });

  it('refuses a published or unknown version', async () => {
    const { service } = await setup();
    expect(domainError(() => service.publish(FUNNEL, 1)).code).toBe('conflict');
    expect(domainError(() => service.publish(FUNNEL, 9)).code).toBe('not_found');
  });

  it('drops the cached active version and is stored in the journal', async () => {
    const { repo, service, clock } = await setup();
    expect(service.active(FUNNEL).version).toBe(1);
    service.publish(FUNNEL, 2);
    expect(service.active(FUNNEL).version).toBe(2);
    expect(createVersionsService(repo, clock).active(FUNNEL).version).toBe(2);
  });

  it('allows publishing an older draft after a newer one', async () => {
    const { service } = await setup();
    service.upload(configJson('funnel-v2.json', { version: 3 }));
    service.publish(FUNNEL, 3);
    expect(service.publish(FUNNEL, 2)).toMatchObject({ version: 2, fromVersion: 3 });
    expect(service.active(FUNNEL).version).toBe(2);
  });
});

describe('stored configs', () => {
  it('are parsed once and returned from the cache afterwards', async () => {
    const { db, service } = await setup();
    const first = service.config(FUNNEL, 1);
    db.run(sql`update funnel_versions set config_json = '{}' where version = 1`);
    expect(service.config(FUNNEL, 1)).toBe(first);
  });

  it('report an unknown version and a funnel without an active version', async () => {
    const { service } = await setup(false);
    expect(domainError(() => service.config(FUNNEL, 1)).code).toBe('not_found');
    expect(domainError(() => service.active(FUNNEL)).code).toBe('not_found');
  });

  it('report a stored config that no longer parses as an internal error', async () => {
    const { db, service } = await setup();
    db.run(sql`update funnel_versions set config_json = '{}' where version = 2`);
    const err = domainError(() => service.config(FUNNEL, 2));
    expect(err.code).toBe('internal');
  });

  it('do not remember funnels without an active version', async () => {
    const { repo, clock, service } = await setup(false);
    expect(service.findActive(FUNNEL)).toBeNull();
    // Seeded through another instance, so this one's caches are not reset by the seed.
    createVersionsService(repo, clock).seedIfEmpty(configJson('funnel-v1.json'), []);
    expect(service.findActive(FUNNEL)?.version).toBe(1);
  });
});

describe('GET /api/funnel/:funnelId/active', () => {
  it('returns only the meta of the active version', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: `/api/funnel/${FUNNEL}/active` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      funnelId: FUNNEL,
      version: 1,
      title: "Find your team's operating style",
    });
  });

  it('answers 404 for a funnel that was never published', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/funnel/nope/active' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
