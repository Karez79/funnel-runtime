// Integration test of `pnpm demo:iteration2` (CLAUDE.md 13.2 Phase 7) against a real
// server on a temp database, set up like prod before the second iteration: v1 and v2
// published, v2 active, v3 not yet uploaded. The demo must pass, leave v2 active, pass
// again on a re-run (v3 already published), and report a ✘ when something is wrong.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../apps/server/src/clock.ts';
import {
  configJson,
  createTestApp,
  TEST_ENV,
  type TestApp,
} from '../apps/server/src/test/harness.ts';
import { runIterationDemo, type DemoCheck } from './lib/demo.ts';
import { createClient } from './lib/http.ts';

let t: TestApp | undefined;
let dir: string | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const secrets = {
  generatorKey: TEST_ENV.generatorKey,
  admin: { user: TEST_ENV.adminUser, password: TEST_ENV.adminPassword },
};

/** A server like prod before Phase 7: v2 active over v1, with a v1 session. */
async function prodLike() {
  t = await createTestApp({ clock: systemClock });
  const baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
  const call = createClient({ baseUrl, ...secrets });
  await call('createSession', { body: { funnelId: 'workstyle-planner', utm: {} } });
  await call('publishVersion', { params: { v: 2 }, body: {} });
  return { baseUrl, call };
}

const failures = (checks: readonly DemoCheck[]) => checks.filter((c) => !c.ok);

describe('pnpm demo:iteration2', () => {
  it('publishes v3, rolls back to v2 and passes again when re-run', async () => {
    const { baseUrl, call } = await prodLike();
    const first = await runIterationDemo({ baseUrl, ...secrets });
    expect(failures(first)).toEqual([]);
    expect(first.map((c) => c.label)).toEqual([
      'Sessions start on the active version v2',
      'A variant B session is paused on tool_count',
      'v3 uploaded through POST /api/admin/versions',
      'v3 published without a redeploy',
      'Paused sessions finish on their pinned v2',
      'The variant B session answers tool_count on v2 and reaches its result',
      'New sessions start on v3',
      'Variant B of v3 has no tool_count',
      'Compliance branch: priorities → security_constraints → regulated_scale',
      'recommendation_expanded accepted from v3 sessions',
      '…and rejected from a v2 session (not in its catalog)',
      'Rolled back to v2',
      'New sessions after the rollback start on v2',
      'A v3 session begun before the rollback finishes on v3',
      'Analytics available for every published version',
      'Other events of v3 list recommendation_expanded',
      'Database schema unchanged',
      'Every ingest answer was the expected one',
    ]);
    expect((await call('activeVersion')).data.version.version).toBe(2);

    const again = await runIterationDemo({ baseUrl, ...secrets });
    expect(failures(again)).toEqual([]);
    expect(again.map((c) => c.label)).toContain(
      'v3 activated again (published on an earlier run) without a redeploy',
    );
    expect(again.find((c) => c.label.startsWith('v3 uploaded'))?.detail).toMatch(
      /^already stored \(same hash\), published; lint: 0 errors, 3 warnings$/,
    );
    const { activations } = (await call('listVersions')).data;
    // Newest first: both runs are in the append-only journal.
    expect(activations.slice(0, 5).map((a) => [a.action, a.version])).toEqual([
      ['rollback', 2],
      ['activate', 3],
      ['rollback', 2],
      ['publish', 3],
      ['publish', 2],
    ]);
    expect((await call('activeVersion')).data.version.version).toBe(2);
  });

  it('publishes v3 that is already stored as a draft, as on prod after step 1', async () => {
    const { baseUrl, call } = await prodLike();
    await call('uploadVersion', { query: {}, body: configJson('funnel-v3.json') });
    const checks = await runIterationDemo({ baseUrl, ...secrets });
    expect(failures(checks)).toEqual([]);
    expect(checks.find((c) => c.label.startsWith('v3 uploaded'))?.detail).toBe(
      'already stored (same hash), draft; lint: 0 errors, 3 warnings',
    );
    expect(checks.map((c) => c.label)).toContain('v3 published without a redeploy');
    expect((await call('activeVersion')).data.version.version).toBe(2);
  });

  it('starts from the previous version when an earlier run left v3 active', async () => {
    const { baseUrl, call } = await prodLike();
    await call('uploadVersion', { query: {}, body: configJson('funnel-v3.json') });
    await call('publishVersion', { params: { v: 3 }, body: {} });
    const checks = await runIterationDemo({ baseUrl, ...secrets });
    expect(failures(checks)).toEqual([]);
    expect((await call('activeVersion')).data.version.version).toBe(2);
  });

  it('reports a ✘ and leaves the active version alone when the config cannot be published', async () => {
    const { baseUrl, call } = await prodLike();
    dir = mkdtempSync(join(tmpdir(), 'demo-'));
    const path = join(dir, 'broken-v3.json');
    // Lint error: the result rule points to a result that does not exist.
    writeFileSync(path, JSON.stringify(configJson('funnel-v3.json', { defaultResultId: 'nope' })));
    const checks = await runIterationDemo({ baseUrl, ...secrets, configPath: path });
    expect(failures(checks).map((c) => c.label)).toContain(
      'v3 uploaded through POST /api/admin/versions',
    );
    expect(failures(checks).at(-1)?.label).toBe('The demo ran to the end');
    expect((await call('activeVersion')).data.version.version).toBe(2);
  });

  /** The request reaches the server, but the script never sees the answer. */
  function loseAnswerOnce(path: string) {
    const realFetch = globalThis.fetch;
    let lost = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const res = await realFetch(input, init);
      const url = input instanceof Request ? input.url : input.toString();
      if (!lost && url.endsWith(path)) {
        lost = true;
        throw new TypeError('fetch failed');
      }
      return res;
    });
  }

  it.each([
    // The publish went through: the error path must undo it, once.
    ['/api/admin/versions/3/publish', 'rolled back'],
    // The rollback went through: the error path must not roll back a second time.
    ['/api/admin/rollback', 'already off v3: v2 is active'],
  ])('leaves v2 active when the answer to %s is lost', async (path, undo) => {
    const { baseUrl, call } = await prodLike();
    loseAnswerOnce(path);
    const checks = await runIterationDemo({ baseUrl, ...secrets });
    vi.restoreAllMocks();
    expect(failures(checks).map((c) => [c.label, c.detail])).toEqual([
      ['The demo ran to the end', 'fetch failed'],
    ]);
    expect(checks.at(-1)).toEqual({ label: 'v3 is not left active', ok: true, detail: undo });
    expect((await call('activeVersion')).data.version.version).toBe(2);
  });

  it('names the variables to export when the server refuses the secrets', async () => {
    const { baseUrl } = await prodLike();
    const checks = await runIterationDemo({
      baseUrl,
      generatorKey: 'wrong',
      admin: { user: 'admin', password: 'wrong' },
    });
    expect(checks).toEqual([
      {
        label: 'The demo ran to the end',
        ok: false,
        detail:
          "GET /api/admin/versions/active: Admin credentials required. Export ADMIN_USER and ADMIN_PASSWORD with the server's values.",
      },
    ]);
  });
});
