import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, createSharedServices } from '../../app.ts';
import { createTestApp, TEST_ENV, testClock, type TestApp } from '../../test/harness.ts';
import { createRetentionRepo } from './repo.ts';
import { createRetentionService } from './service.ts';

let t: TestApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await t?.close();
  t = undefined;
});

const ANSWERS = { work_mode: 'hybrid', team_size: 12 };

function insertSession(
  id: string,
  expiresAt: string,
  state = JSON.stringify({ answers: ANSWERS, history: ['intro'], currentStepId: 'team_size' }),
) {
  t?.handle.db.run(sql`insert into sessions (id, funnel_id, funnel_version, experiment_id,
    variant, variant_source, state_json, created_at, updated_at, expires_at)
    values (${id}, 'workstyle-planner', 1, 'x', 'A', 'hash', ${state},
    '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ${expiresAt})`);
}

function stateOf(id: string) {
  const row = t?.handle.db.get<{ state: string }>(
    sql`select state_json as state from sessions where id = ${id}`,
  );
  const state: unknown = JSON.parse(row?.state ?? 'null');
  return state;
}

async function setup() {
  t = await createTestApp();
  const clock = testClock('2026-10-01T12:00:00.000Z');
  const service = createRetentionService(createRetentionRepo(t.handle.db), clock, t.app.log);
  return { clock, service };
}

describe('expired answers cleanup', () => {
  it('empties answers of expired sessions only and keeps the rest of the state', async () => {
    const { service } = await setup();
    insertSession('expired', '2026-10-01T11:59:59.000Z');
    insertSession('alive', '2026-10-01T12:00:01.000Z');
    expect(service.sweep()).toBe(1);
    expect(stateOf('expired')).toEqual({
      answers: {},
      history: ['intro'],
      currentStepId: 'team_size',
    });
    expect(stateOf('alive')).toMatchObject({ answers: ANSWERS });
    // Already empty: nothing to do the second time.
    expect(service.sweep()).toBe(0);
  });

  it('skips malformed states instead of failing the whole sweep', async () => {
    const { service } = await setup();
    const expired = '2026-09-02T00:00:00.000Z';
    insertSession('broken', expired, '{not json');
    insertSession('no-answers', expired, JSON.stringify({ history: [], currentStepId: 'intro' }));
    insertSession('null-answers', expired, JSON.stringify({ answers: null }));
    insertSession('valid', expired);
    expect(service.sweep()).toBe(1);
    expect(stateOf('valid')).toMatchObject({ answers: {} });
    expect(stateOf('no-answers')).toEqual({ history: [], currentStepId: 'intro' });
    expect(stateOf('null-answers')).toEqual({ answers: null });
  });

  it('logs a failed sweep instead of throwing at start', async () => {
    t = await createTestApp();
    const errors: unknown[] = [];
    const log = { ...t.app.log, info: () => undefined, error: (o: unknown) => errors.push(o) };
    const failing = createRetentionService(
      {
        clearExpiredAnswers: () => {
          throw new Error('disk gone');
        },
      },
      testClock(),
      log,
    );
    const stop = failing.start();
    stop();
    expect(errors).toHaveLength(1);
  });

  it('keeps the session row for analytics', async () => {
    const { service } = await setup();
    insertSession('expired', '2026-09-02T00:00:00.000Z');
    service.sweep();
    const count = t?.handle.db.get<{ n: number }>(sql`select count(*) as n from sessions`);
    expect(count).toEqual({ n: 1 });
  });

  it('sweeps at start and then on every interval until stopped', async () => {
    const { clock, service } = await setup();
    vi.useFakeTimers();
    insertSession('soon', '2026-10-01T12:30:00.000Z');
    const stop = service.start(1000);
    expect(stateOf('soon')).toMatchObject({ answers: ANSWERS });
    clock.advance(60 * 60 * 1000);
    vi.advanceTimersByTime(1000);
    expect(stateOf('soon')).toMatchObject({ answers: {} });
    stop();
    insertSession('later', '2026-10-01T12:30:00.000Z');
    vi.advanceTimersByTime(5000);
    expect(stateOf('later')).toMatchObject({ answers: ANSWERS });
  });

  it('runs when the server starts', async () => {
    t = await createTestApp();
    insertSession('expired', '2026-09-02T00:00:00.000Z');
    await t.app.close();
    // A second app on the same database sweeps on build.
    const clock = testClock();
    const app = await buildApp(
      TEST_ENV,
      t.handle.db,
      createSharedServices(t.handle.db, clock),
      clock,
    );
    expect(stateOf('expired')).toMatchObject({ answers: {} });
    await app.close();
  });
});
