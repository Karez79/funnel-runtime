// Accessibility e2e (CLAUDE.md 10, 13.2 Phase 8): axe scans every funnel step type, the
// result, the admin pages, the confirmation dialog and the command palette against WCAG 2.x
// A/AA. Serious and critical violations fail the test; no rule is disabled. Reduced motion
// is on so contrast is measured on settled screens, not mid-transition.
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { audit } from './axe.ts';
import { expect, test } from './fixtures.ts';

async function next(page: Page, path: RegExp) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(path);
}

const VersionList = z.object({
  versions: z.array(z.object({ version: z.number(), state: z.enum(['draft', 'published']) })),
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('every funnel step type, a validation error and the result pass axe', async ({ page }) => {
  await page.goto('/?variant=A');
  await expect(page).toHaveURL(/\/s\/intro/);
  await audit(page); // info

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/team_size/);
  await audit(page); // number
  await page.getByRole('spinbutton').fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await audit(page); // number with an error
  await page.getByRole('spinbutton').fill('12');
  await next(page, /work_mode/);
  await audit(page); // single-select

  await page.getByRole('radio', { name: 'Hybrid' }).click();
  await next(page, /priorities/);
  await page.getByRole('checkbox', { name: 'Decision speed' }).click();
  await audit(page); // multi-select with a selection
  await next(page, /timezone_span/);
  await page.getByRole('radio', { name: 'Mostly the same hours' }).click();
  await next(page, /office_days/);
  await page.getByRole('spinbutton').fill('2');
  await next(page, /async_maturity/);
  await page.getByRole('radio', { name: 'Important decisions are documented' }).click();
  await next(page, /tool_count/);
  await page.getByRole('spinbutton').fill('6');
  await next(page, /\/s\/result/);

  await expect(page.getByText('What a week could look like')).toBeVisible();
  await audit(page); // result
  await page.getByRole('button', { name: 'View the action list' }).click();
  await expect(page.getByRole('list', { name: '30-day plan' })).toBeVisible();
  await audit(page); // result with the plan open
});

test('the funnel passes axe on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?variant=B');
  await expect(page).toHaveURL(/\/s\/intro/);
  await audit(page);
  await page.getByRole('button', { name: 'Show me' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await audit(page);
});

test('admin dashboard, journey popover and table pass axe', async ({ page, request }) => {
  // One live session, so the journey has steps (the funnel tests above are QA sessions).
  const res = await request.post('/api/sessions', { data: { funnelId: 'workstyle-planner' } });
  expect(res.status()).toBe(201);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Funnel journey' })).toBeVisible();
  await audit(page);
  await page
    .getByRole('button', { name: /Team size/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Team size' })).toBeVisible();
  await audit(page); // step popover
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('table', { name: /Steps of the funnel/ })).toBeVisible();
  await audit(page);
});

test('versions page and a confirmation dialog pass axe', async ({ page, request }) => {
  await page.goto('/admin/versions');
  await expect(page.getByRole('heading', { name: 'Versions', exact: true })).toBeVisible();
  await audit(page);
  // Whatever state earlier specs left: a draft opens "Publish version N?", otherwise a
  // published version that is not active opens "Activate…?" or "Roll back to…?".
  const res = await request.get('/api/admin/versions');
  expect(res.ok()).toBe(true);
  const { versions } = VersionList.parse(await res.json());
  const draft = versions.find((v) => v.state === 'draft');
  const action =
    draft === undefined
      ? page.getByRole('button', { name: /^(Activate|Roll back to) version \d+$/ }).first()
      : page.getByRole('button', { name: `Publish version ${String(draft.version)}` });
  await action.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await audit(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('live events and the command palette pass axe', async ({ page }) => {
  await page.goto('/admin/live');
  await expect(page.getByText(/^Streaming/)).toBeVisible();
  await audit(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search and commands' })).toBeVisible();
  await audit(page);
});

test('admin pages pass axe on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A funnel visit, so Live events has rows to audit in its stacked phone layout.
  await page.goto('/');
  await expect(page.locator('[data-step="intro"]')).toBeVisible();
  for (const [path, heading] of [
    ['/admin', 'Funnel journey'],
    ['/admin/versions', 'Versions'],
    ['/admin/live', 'Live events'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (path === '/admin/live') {
      await expect(page.getByRole('cell', { name: 'step_viewed' }).first()).toBeVisible();
    }
    await audit(page);
  }
});
