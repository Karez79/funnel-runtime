// Funnel e2e (CLAUDE.md 12) against the production build. The seed publishes
// configs/funnel-v1.json (active) and loads funnel-v2.json as a draft; live sessions run
// on v1, the preview test uses the v2 draft. `?variant=` pins the variant (QA override),
// so step orders are known. Each test runs in a fresh browser context: a new session.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const progress = (page: Page) => page.getByRole('progressbar', { name: 'Progress' });

async function next(page: Page, path: RegExp) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(path);
}

async function number(page: Page, value: number, path: RegExp) {
  await page.getByRole('spinbutton').fill(String(value));
  await next(page, path);
}

async function choose(page: Page, label: string, path: RegExp) {
  await page.getByRole('radio', { name: label }).click();
  await next(page, path);
}

async function start(page: Page, variant: 'A' | 'B') {
  await page.goto(`/?variant=${variant}`);
  await expect(page).toHaveURL(/\/s\/intro/);
  await page.getByRole('button', { name: variant === 'A' ? 'Start' : 'Show me' }).click();
}

test('variant A, hybrid branch: to the result and the CTA', async ({ page }) => {
  await start(page, 'A');
  await expect(page).toHaveURL(/\/s\/team_size/);
  await number(page, 12, /work_mode/);
  await choose(page, 'Hybrid', /priorities/);
  await page.getByRole('checkbox', { name: 'Decision speed' }).click();
  await page.getByRole('checkbox', { name: 'Deep-focus time' }).click();
  await expect(page.getByText('2 of 3 selected')).toBeVisible();
  await next(page, /timezone_span/);
  await choose(page, 'Mostly the same hours', /office_days/);
  await number(page, 2, /async_maturity/);
  await choose(page, 'Important decisions are documented', /tool_count/);
  await number(page, 6, /\/s\/result/);

  await expect(heading(page)).toHaveText('Structured hybrid');
  await expect(page.getByText('What a week could look like')).toBeVisible();
  const cta = page.getByRole('button', { name: 'View the action list' });
  await expect(cta).toHaveAttribute('aria-expanded', 'false');
  await cta.click();
  await expect(cta).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('list', { name: '30-day plan' })).toBeVisible();
});

test('the result follows the answers after Back and a changed answer', async ({ page }) => {
  await start(page, 'A');
  await number(page, 12, /work_mode/);
  await choose(page, 'Hybrid', /priorities/);
  await page.getByRole('checkbox', { name: 'Team connection' }).click();
  await next(page, /timezone_span/);
  await choose(page, 'Mostly the same hours', /office_days/);
  await number(page, 3, /async_maturity/);
  await choose(page, 'Mostly discussed in meetings', /tool_count/);
  await number(page, 4, /\/s\/result/);
  await expect(heading(page)).toHaveText('Structured hybrid');

  await page.goBack();
  await expect(page).toHaveURL(/tool_count/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/async_maturity/);
  await choose(page, 'Written context is the default', /tool_count/);
  await next(page, /\/s\/result/);
  await expect(heading(page)).toHaveText('Async-native');
});

test('rapid Enter presses move one step at a time and stay consistent', async ({
  page,
  request,
}) => {
  await start(page, 'A');
  await number(page, 7, /work_mode/);
  await choose(page, 'Fully remote', /priorities/);
  await page.getByRole('checkbox', { name: 'Decision speed' }).click();
  await next(page, /timezone_span/);
  // Esc, not the Back button: Enter on a focused Back button would go back again.
  // Each Back is pressed after the previous move has rendered (keys during a move are
  // dropped on purpose).
  await page.keyboard.press('Escape');
  await expect(heading(page)).toHaveText('What should the operating model improve?');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/work_mode/);
  await expect(heading(page)).toHaveText('Where does the team work most of the time?');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Enter');
  // A choice made while the move renders must not split screen and saved state.
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  await expect(heading(page)).not.toHaveText('Where does the team work most of the time?');
  await page.waitForLoadState('networkidle');
  const reached = /\/s\/([a-z_]+)/.exec(page.url())?.[1];
  const shown = await heading(page).textContent();
  // The server has the step that is on screen.
  const id: unknown = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('funnel:workstyle-planner:session'))) ?? 'null',
  );
  expect(typeof id).toBe('string');
  const stored: unknown = await (await request.get(`/api/sessions/${String(id)}`)).json();
  expect(stored).toMatchObject({ session: { state: { currentStepId: reached } } });
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/s/${reached ?? 'missing'}`));
  await expect(heading(page)).toHaveText(shown ?? 'missing');
});

test('after a click on Back, a digit and Enter change the answer and continue', async ({
  page,
}) => {
  await start(page, 'A');
  await number(page, 9, /work_mode/);
  await choose(page, 'Hybrid', /priorities/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(heading(page)).toHaveText('Where does the team work most of the time?');
  await page.keyboard.press('3');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/priorities/);
  await expect(progress(page)).toHaveAttribute('aria-valuetext', '3 of 7');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('radio', { name: 'Mostly in the office' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('a refresh in the middle keeps the step and the answers', async ({ page }) => {
  await start(page, 'A');
  await number(page, 30, /work_mode/);
  await choose(page, 'Hybrid', /priorities/);
  await page.reload();
  await expect(page).toHaveURL(/\/s\/priorities/);
  await expect(heading(page)).toHaveText('What should the operating model improve?');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/work_mode/);
  await expect(page.getByRole('radio', { name: 'Hybrid' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue('30');
});

test('Back returns to the previous visible step, also with the browser button', async ({
  page,
}) => {
  await start(page, 'A');
  await number(page, 5, /work_mode/);
  await choose(page, 'Fully remote', /priorities/);
  await page.getByRole('checkbox', { name: 'Faster onboarding' }).click();
  await next(page, /timezone_span/);
  // office_days is hidden for remote teams: the next step is async_maturity.
  await choose(page, 'More than 6 hours apart', /async_maturity/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/timezone_span/);
  await expect(page.getByRole('radio', { name: 'More than 6 hours apart' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.goBack();
  await expect(page).toHaveURL(/priorities/);
  await expect(page.getByRole('checkbox', { name: 'Faster onboarding' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/work_mode/);
  // Forward does not skip ahead: the URL returns to the current step.
  await page.goForward();
  await expect(page).toHaveURL(/work_mode/);
  await expect(heading(page)).toHaveText('Where does the team work most of the time?');
});

test('?variant=B gives the step order of variant B', async ({ page }) => {
  await start(page, 'B');
  await expect(page).toHaveURL(/\/s\/work_mode/);
  await choose(page, 'Hybrid', /timezone_span/);
  await choose(page, 'Mostly the same hours', /team_size/);
  await number(page, 9, /async_maturity/);
  await expect(heading(page)).toHaveText('How are decisions documented today?');
});

test('progress counts only visible questions: remote has fewer than hybrid', async ({ page }) => {
  await start(page, 'A');
  await number(page, 8, /work_mode/);
  await page.getByRole('radio', { name: 'Fully remote' }).click();
  await expect(progress(page)).toHaveAttribute('aria-valuetext', '2 of 6');
  await page.getByRole('radio', { name: 'Hybrid' }).click();
  await expect(progress(page)).toHaveAttribute('aria-valuetext', '2 of 7');
  // Keyboard: 1 picks the first option, Enter continues.
  await page.keyboard.press('1');
  await expect(progress(page)).toHaveAttribute('aria-valuetext', '2 of 6');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/priorities/);
});

test('an invalid answer shows the config message and is not saved', async ({ page }) => {
  await start(page, 'A');
  await expect(page).toHaveURL(/team_size/);
  await page.waitForLoadState('networkidle');
  const saves: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT') saves.push(r.postData() ?? '');
  });
  await page.getByRole('spinbutton').fill('500');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('For this demo, enter a value up to 200.');
  await expect(page).toHaveURL(/team_size/);
  await page.getByRole('spinbutton').fill('20');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(saves).toEqual([]);
});

/** Answers whatever step is shown (first option, the lowest number) until the result. */
async function walkToResult(page: Page) {
  for (let i = 0; i < 15; i += 1) {
    const title = await heading(page).textContent();
    if (await page.getByRole('button', { name: /action list|changes/ }).count()) return;
    if (await page.getByRole('spinbutton').count()) {
      const min = await page.getByRole('spinbutton').getAttribute('min');
      await page.getByRole('spinbutton').fill(min === null || min === '0' ? '1' : min);
    } else if (await page.getByRole('radio').count()) {
      await page.getByRole('radio').first().click();
    } else if (await page.getByRole('checkbox').count()) {
      await page.getByRole('checkbox').first().click();
    }
    await page.getByRole('button').last().click();
    await expect(heading(page)).not.toHaveText(title ?? '');
  }
  throw new Error('the result was not reached');
}

test('preview runs a version in memory: no session, no events', async ({ page, request }) => {
  const before = await request.get('/api/admin/versions');
  const total = (body: unknown) =>
    JSON.stringify(body)
      .match(/"totalSessions":\d+/g)
      ?.join() ?? '';
  const sessionsBefore = total(await before.json());
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });

  // The draft v2: preview works on a version that is not active.
  await page.goto('/admin/preview/2?variant=B');
  await expect(page.getByText('Preview, not tracked')).toBeVisible();
  await expect(page.getByText('Version 2, variant B')).toBeVisible();
  // v2 variant B texts, straight from the config.
  await expect(heading(page)).toHaveText('Is your team losing time to the way it works?');
  await page.getByRole('button', { name: 'Check our setup' }).click();
  await expect(heading(page)).toHaveText('Where does the team work most of the time?');
  await walkToResult(page);
  const cta = page.getByRole('button', { name: /action list|changes/ });
  await cta.click();
  await expect(cta).toHaveAttribute('aria-expanded', 'true');

  const after = await request.get('/api/admin/versions');
  expect(total(await after.json())).toBe(sessionsBefore);
  expect(writes).toEqual([]);
});
