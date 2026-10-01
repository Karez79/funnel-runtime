import { expect, test } from '@playwright/test';

test('health reports a working database', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
});

test('the web app is served from the same origin without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/s/team_size');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
