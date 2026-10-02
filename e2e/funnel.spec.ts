// Funnel e2e (CLAUDE.md 12) against the production build. The seed publishes
// configs/funnel-v1.json (active) and loads funnel-v2.json as a draft; live sessions run
// on v1, the preview test uses the v2 draft. `?variant=` pins the variant (QA override),
// so step orders are known. Each test runs in a fresh browser context: a new session.
import type { Page } from '@playwright/test';
import { contract } from '@funnel/shared';
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
  // The plan opens in place: the week labels appear over the recommendations.
  await expect(page.getByText('Week 1', { exact: true })).toBeHidden();
  await cta.click();
  await expect(cta).toHaveAttribute('aria-expanded', 'true');
  const plan = page.getByRole('list', { name: '30-day plan' });
  await expect(plan).toBeVisible();
  await expect(plan.getByText('Week 1', { exact: true })).toBeVisible();
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
  // Each queued key may still start a move after the previous one renders; wait until the
  // URL, the rendered step and the server agree and stay that way (no network request
  // marks the end of a view transition, so networkidle is not enough).
  const id: unknown = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('funnel:workstyle-planner:session'))) ?? 'null',
  );
  expect(typeof id).toBe('string');
  const snapshot = async () => {
    const url = /\/s\/([a-z_]+)/.exec(page.url())?.[1] ?? '';
    const rendered = (await page.locator('[data-step]').getAttribute('data-step')) ?? '';
    const stored = contract.getSession.response.parse(
      await (await request.get(`/api/sessions/${String(id)}`)).json(),
    );
    const server = stored.session.state.currentStepId;
    return `${url}|${rendered}|${server}`;
  };
  // On failure the received value is the last `url|rendered|server` snapshot.
  let previous = '';
  await expect
    .poll(
      async () => {
        const now = await snapshot();
        const [url, rendered, server] = now.split('|');
        const settled = now === previous && url === rendered && rendered === server;
        previous = now;
        return settled ? 'settled' : now;
      },
      { intervals: [300], timeout: 10_000 },
    )
    .toBe('settled');
  const reached = previous.split('|')[0];
  // Every move is one step from a rendered state: from work_mode (remote) the queued keys
  // can only reach these steps, in order; a stale move would skip or branch elsewhere.
  expect(['priorities', 'timezone_span', 'async_maturity']).toContain(reached);
  const shown = await heading(page).textContent();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/s/${reached ?? 'missing'}`));
  await expect(heading(page)).toHaveText(shown ?? 'missing');
});

test('rapid browser Back presses land on the step the URL says', async ({ page, request }) => {
  await start(page, 'A');
  await number(page, 7, /work_mode/);
  await choose(page, 'Fully remote', /priorities/);
  await page.getByRole('checkbox', { name: 'Decision speed' }).click();
  await next(page, /timezone_span/);
  // Three Backs a few milliseconds apart: each arrives while the previous move renders.
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i += 1) {
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
  });
  await expect(page).toHaveURL(/\/s\/team_size/);
  await expect(page.locator('[data-step]')).toHaveAttribute('data-step', 'team_size');
  await expect(page.getByRole('spinbutton')).toHaveValue('7');
  const id: unknown = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('funnel:workstyle-planner:session'))) ?? 'null',
  );
  await expect
    .poll(async () => {
      const res = await request.get(`/api/sessions/${String(id)}`);
      return contract.getSession.response.parse(await res.json()).session.state.currentStepId;
    })
    .toBe('team_size');
  await expect(page).toHaveURL(/\/s\/team_size/);
  // The history entries were not rewritten: the one before team_size is still intro.
  await page.goBack();
  await expect(page).toHaveURL(/\/s\/intro/);
  await expect(page.locator('[data-step]')).toHaveAttribute('data-step', 'intro');
});

// A consistency guard for the cancel path, not a reproduction of the race: the base code
// also passes it.
test('a quick Back and Forward keep URL, screen and saved state together', async ({
  page,
  request,
}) => {
  await start(page, 'A');
  await number(page, 7, /work_mode/);
  await choose(page, 'Fully remote', /priorities/);
  await page.evaluate(async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 3));
    history.forward();
  });
  const id: unknown = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('funnel:workstyle-planner:session'))) ?? 'null',
  );
  // Either the Back is cancelled by the Forward (priorities) or it finished first and the
  // Forward is replaced by the current step (work_mode); never a split between the three.
  await expect
    .poll(
      async () => {
        const url = /\/s\/([a-z_]+)/.exec(page.url())?.[1] ?? '';
        const rendered = (await page.locator('[data-step]').getAttribute('data-step')) ?? '';
        const res = await request.get(`/api/sessions/${String(id)}`);
        const server = contract.getSession.response.parse(await res.json()).session.state
          .currentStepId;
        return url === rendered && rendered === server ? url : `${url}|${rendered}|${server}`;
      },
      { intervals: [200] },
    )
    .toMatch(/^(priorities|work_mode)$/);
});

test('a browser Back during a Continue move cancels it and goes back', async ({
  page,
  request,
}) => {
  await start(page, 'A');
  await number(page, 7, /work_mode/);
  await choose(page, 'Fully remote', /priorities/);
  await page.getByRole('checkbox', { name: 'Decision speed' }).click();
  // Enter starts the move to timezone_span; the Back lands before it renders.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    history.back();
  });
  const id: unknown = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('funnel:workstyle-planner:session'))) ?? 'null',
  );
  await expect
    .poll(
      async () => {
        const url = /\/s\/([a-z_]+)/.exec(page.url())?.[1] ?? '';
        const rendered = (await page.locator('[data-step]').getAttribute('data-step')) ?? '';
        const res = await request.get(`/api/sessions/${String(id)}`);
        const server = contract.getSession.response.parse(await res.json()).session.state
          .currentStepId;
        return `${url}|${rendered}|${server}`;
      },
      { intervals: [200] },
    )
    .toBe('work_mode|work_mode|work_mode');
  // The cancelled Continue saved nothing: the answer is still there, the entry is intact.
  await page.goBack();
  await expect(page).toHaveURL(/\/s\/team_size/);
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
  // The URL changes before the move renders; a Forward during the move would cancel it
  // and stay on priorities (the step the URL shows), see the rapid Back test.
  await expect(heading(page)).toHaveText('Where does the team work most of the time?');
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
    if ((await progress(page).getAttribute('aria-valuetext')) === 'Done') return;
    const title = await heading(page).textContent();
    if (await page.getByRole('spinbutton').count()) {
      const min = await page.getByRole('spinbutton').getAttribute('min');
      await page.getByRole('spinbutton').fill(min === null || min === '0' ? '1' : min);
    } else if (await page.getByRole('radio').count()) {
      await page.getByRole('radio').first().click();
    } else if (await page.getByRole('checkbox').count()) {
      await page.getByRole('checkbox').first().click();
    }
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(heading(page)).not.toHaveText(title ?? '');
  }
  throw new Error('the result was not reached');
}

test.describe('conflict', () => {
  test.use({ allowedConsoleErrors: [/status of 409/] });

  test('a 409 on save shows the state the server has', async ({ page, request }) => {
    await start(page, 'A');
    await number(page, 11, /work_mode/);
    await page.waitForLoadState('networkidle');
    const id: unknown = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('funnel:workstyle-planner:session'))) ??
        'null',
    );
    // Another tab already moved this session: the next save is rejected with its state.
    const server: unknown = await (await request.get(`/api/sessions/${String(id)}`)).json();
    expect(server).toMatchObject({ session: { state: { currentStepId: 'work_mode' } } });
    await page.route(
      '**/api/sessions/*/state',
      (route) =>
        route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conflict',
              message: 'stale',
              details: {
                state: {
                  answers: { team_size: 40 },
                  history: ['intro'],
                  currentStepId: 'team_size',
                },
                stateRev: 1,
              },
            },
          },
        }),
      { times: 1 },
    );
    await choose(page, 'Hybrid', /team_size/);
    await expect(heading(page)).toHaveText('How many people are on the team?');
    await expect(page.getByRole('spinbutton')).toHaveValue('40');
  });
});

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
  const cta = page.locator('button[aria-expanded]');
  await cta.click();
  await expect(cta).toHaveAttribute('aria-expanded', 'true');

  const after = await request.get('/api/admin/versions');
  expect(total(await after.json())).toBe(sessionsBefore);
  expect(writes).toEqual([]);
});

test('every number step shows its lower bound as a placeholder next to the unit', async ({
  page,
}) => {
  // v2 variant A (preview of the draft) has all four number steps of the configs.
  await page.goto('/admin/preview/2?variant=A');
  await page.getByRole('button', { name: 'Start' }).click();
  const field = page.getByRole('spinbutton');
  const card = page.locator('[data-step]');
  await expect(card).toHaveAttribute('data-step', 'team_size');
  const seen: string[] = [];
  for (let i = 0; i < 15; i += 1) {
    const stepId = (await card.getAttribute('data-step')) ?? '';
    if (stepId === 'result') break;
    if (await field.count()) {
      seen.push(stepId);
      const min = await field.getAttribute('min');
      await expect(field).toHaveAttribute('placeholder', min ?? '');
      await expect(field).toHaveValue('');
      await expect(field).toBeFocused();
      // The placeholder is a hint, not an answer.
      await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
      const unit = page.locator('label', { has: field }).locator('span');
      await expect(unit).toBeVisible();
      const label = page.locator('label', { has: field });
      const [box, unitBox, labelBox] = await Promise.all([
        field.boundingBox(),
        unit.boundingBox(),
        label.boundingBox(),
      ]);
      if (!box || !unitBox || !labelBox) throw new Error('no layout');
      // The field is as wide as its one-digit placeholder (52px digits), not a wide box…
      expect(box.width).toBeLessThan(48);
      // …so number and unit form one group centred in the field.
      const groupCentre = (box.x + unitBox.x + unitBox.width) / 2;
      expect(Math.abs(groupCentre - (labelBox.x + labelBox.width / 2))).toBeLessThan(2);
      // −/+ on an empty field start from the placeholder.
      await page.getByRole('button', { name: 'Increase' }).click();
      await expect(field).toHaveValue(String(Number(min) + 1));
      // Typing replaces it like any value.
      await field.fill('3');
      await expect(field).toHaveValue('3');
      await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    } else if (await page.getByRole('radio', { name: 'Hybrid' }).count()) {
      await page.getByRole('radio', { name: 'Hybrid' }).click();
    } else if (await page.getByRole('radio').count()) {
      await page.getByRole('radio').first().click();
    } else if (await page.getByRole('checkbox').count()) {
      await page.getByRole('checkbox').first().click();
    }
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(card).not.toHaveAttribute('data-step', stepId);
  }
  expect(seen).toEqual(['team_size', 'office_days', 'meeting_hours', 'tool_count']);
});
