// E2E of CLAUDE.md 12: after the traffic generator runs against the built app, the
// dashboard's Data quality panel says the numbers match its ground truth. The generator
// uploads the ground truth itself, so this is the same path as on prod.
import { generateTraffic } from '../scripts/lib/generator.ts';
import { E2E_ADMIN, E2E_BASE_URL, E2E_GENERATOR_KEY } from './env.ts';
import { expect, test } from './fixtures.ts';

test('after the generator the dashboard matches its ground truth', async ({ page }) => {
  test.setTimeout(120_000);
  // A page of an earlier spec may still flush its outbox with sendBeacon when it closes;
  // ingest rows carry no session, so such a straggler inside the run's window would be
  // counted in Data quality. Let it land before the window opens.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const run = await generateTraffic({
    baseUrl: E2E_BASE_URL,
    sessions: 100,
    seed: 7,
    publishNext: true,
    generatorKey: E2E_GENERATOR_KEY,
    admin: { user: E2E_ADMIN.username, password: E2E_ADMIN.password },
  });
  expect(run.upload.differences).toEqual([]);

  await page.goto('/admin');
  const quality = page.getByRole('table', { name: 'Data quality' });
  await expect(quality.getByRole('row', { name: /Matches generator ground truth/ })).toContainText(
    'Yes',
  );
});
