// Events e2e (CLAUDE.md 7.4, 7.5, 11.1): a real pass through the funnel must deliver
// every client event of 7.5 to the server, and the Live events stream must show them.
// The stream is opened before the pass, so it sees each ingest result as it happens.
import { LIVE_STREAM, LiveEntrySchema, type LiveEntry } from '@funnel/shared';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { E2E_ADMIN, E2E_BASE_URL } from './env.ts';
import { expect, test } from './fixtures.ts';

/** Collects Live events entries in the background until `stop()`. */
async function openLive(): Promise<{ entries: LiveEntry[]; stop: () => void }> {
  const controller = new AbortController();
  const auth = Buffer.from(`${E2E_ADMIN.username}:${E2E_ADMIN.password}`).toString('base64');
  const res = await fetch(`${E2E_BASE_URL}${LIVE_STREAM.path}`, {
    headers: { authorization: `Basic ${auth}` },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const body = res.body;
  if (!body) throw new Error('no stream body');
  const entries: LiveEntry[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            entries.push(LiveEntrySchema.parse(JSON.parse(line.slice('data: '.length))));
          }
        }
      }
    } catch {
      // Aborted by stop().
    }
  })();
  return {
    entries,
    stop: () => {
      controller.abort();
    },
  };
}

async function next(page: Page, path: RegExp) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(path);
}

test('a pass through the funnel delivers every client event to the server', async ({ page }) => {
  const live = await openLive();
  try {
    await page.goto('/?variant=A');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('spinbutton').fill('12');
    await next(page, /work_mode/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/team_size/);
    await next(page, /work_mode/);
    await page.getByRole('radio', { name: 'Fully remote' }).click();
    await next(page, /priorities/);
    await page.getByRole('checkbox', { name: 'Decision speed' }).click();
    await next(page, /timezone_span/);
    await page.getByRole('radio', { name: 'Mostly the same hours' }).click();
    await next(page, /async_maturity/);
    await page.getByRole('radio', { name: 'Important decisions are documented' }).click();
    await next(page, /tool_count/);
    await page.getByRole('spinbutton').fill('6');
    await next(page, /\/s\/result/);
    await page.locator('button[aria-expanded]').click();

    const stored: unknown = await page.evaluate(() =>
      localStorage.getItem('funnel:workstyle-planner:session'),
    );
    const sessionId = z.string().parse(JSON.parse(z.string().parse(stored)));
    const mine = () => live.entries.filter((e) => e.sessionId === sessionId);
    const expected = [
      'step_viewed',
      'answer_submitted',
      'step_completed',
      'back_clicked',
      'result_viewed',
      'cta_clicked',
    ];
    // The queue flushes every 2 s or at 10 events.
    await expect
      .poll(() => new Set(mine().map((e) => e.name)), { timeout: 10_000 })
      .toEqual(new Set(expected));
    // Stored once, however often it was re-sent (beacon, retries): dedup by event_id.
    await expect
      .poll(() => mine().filter((e) => e.name === 'cta_clicked' && e.status === 'accepted').length)
      .toBe(1);
    // Every event passed the catalog, the whitelist and the step check of the session.
    expect(mine().filter((e) => e.status === 'rejected')).toEqual([]);
    expect(mine().every((e) => e.version === 1 && e.variant === 'A')).toBe(true);
    // Nothing is left in the outbox once the server has answered.
    await expect
      .poll(() =>
        page.evaluate((id) => localStorage.getItem(`funnel:events:${id}`) ?? '[]', sessionId),
      )
      .toBe('[]');
  } finally {
    live.stop();
  }
});
