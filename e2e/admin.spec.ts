// Admin e2e (CLAUDE.md 12): publishing and rolling back through the Versions page while a
// session started on the old version keeps it. Sessions are created through the public
// API, exactly as the funnel does; the admin is driven through the UI.
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { expect, test } from './fixtures.ts';

const FUNNEL = 'workstyle-planner';

const SessionBody = z.object({
  session: z.object({ id: z.string(), funnelVersion: z.number() }),
});
const SessionFull = z.object({
  session: z.object({
    id: z.string(),
    funnelVersion: z.number(),
    experimentId: z.string(),
    variant: z.enum(['A', 'B']),
  }),
});

async function newSession(request: APIRequestContext) {
  const res = await request.post('/api/sessions', { data: { funnelId: FUNNEL } });
  expect(res.status()).toBe(201);
  return SessionBody.parse(await res.json()).session;
}

async function pinnedVersion(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/sessions/${id}`);
  expect(res.ok()).toBe(true);
  return SessionBody.parse(await res.json()).session.funnelVersion;
}

test('publishing v2 moves new sessions only, and rolling back returns to v1', async ({
  page,
  request,
}) => {
  const onV1 = await newSession(request);
  expect(onV1.funnelVersion).toBe(1);

  await page.goto('/admin/versions');
  await expect(page.getByRole('heading', { name: 'Changes in version 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish version 2' }).click();
  const publish = page.getByRole('dialog', { name: 'Publish version 2?' });
  await expect(publish).toContainText('will finish on version 1');
  await publish.getByRole('button', { name: 'Publish version 2' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published version 2' })).toBeVisible();

  const onV2 = await newSession(request);
  expect(onV2.funnelVersion).toBe(2);
  // Pinned: the session started before publishing stays on v1.
  expect(await pinnedVersion(request, onV1.id)).toBe(1);

  await page.getByRole('button', { name: 'Roll back to version 1' }).click();
  const rollback = page.getByRole('dialog', { name: 'Roll back to version 1?' });
  await expect(rollback).toContainText('will finish on version 2');
  await rollback.getByRole('button', { name: 'Roll back to version 1' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Rolled back to version 1' }),
  ).toBeVisible();

  expect((await newSession(request)).funnelVersion).toBe(1);
  expect(await pinnedVersion(request, onV2.id)).toBe(2);
  await expect(page.getByRole('list').getByText('Rolled back to version 1')).toBeVisible();
});

test('the dashboard shows the active version and its numbers', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Funnel analytics' })).toBeVisible();
  await expect(page.getByText('Started to CTA', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Funnel journey' })).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('table', { name: /Steps of the funnel/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Data quality' })).toBeVisible();
});

test('the command palette opens with Control+K and navigates', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Funnel analytics' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search and commands' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('versions');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Versions', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/versions$/);
});

test('Live events shows a resent batch as ignored duplicates', async ({ page, request }) => {
  await page.goto('/admin/live');
  await expect(page.getByText(/^Streaming/)).toBeVisible();
  const session = await newSession(request);
  const full = SessionFull.parse(
    await (await request.get(`/api/sessions/${session.id}`)).json(),
  ).session;
  const batch = {
    events: [
      {
        event_id: randomUUID(),
        session_id: full.id,
        name: 'step_viewed',
        client_timestamp: new Date().toISOString(),
        client_seq: 1,
        funnel_id: FUNNEL,
        funnel_version: full.funnelVersion,
        experiment_id: full.experimentId,
        variant: full.variant,
        step_id: 'intro',
        properties: {},
      },
    ],
  };
  // The same batch twice, as after a timeout: stored once, then ignored.
  for (const status of ['accepted', 'duplicate']) {
    const res = await request.post('/api/events/batch', { data: batch });
    expect(res.ok()).toBe(true);
    expect(JSON.stringify(await res.json())).toContain(`"status":"${status}"`);
  }
  await page.getByPlaceholder('Filter by session id').fill(full.id);
  await expect(page.getByRole('cell', { name: 'Stored', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Ignored duplicate', exact: true })).toBeVisible();
});
