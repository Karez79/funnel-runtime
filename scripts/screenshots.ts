// `pnpm screenshots` (CLAUDE.md 15.1): the README images are produced by a script, not
// by hand, so they can be re-created after any UI change. It starts the production build
// on a fresh temporary SQLite file (as the e2e config does) on a free port, fills it with
// the traffic generator (`--publish-next`: v1 → v2), uploads configs/funnel-v3.json as a
// draft (not published) for the Versions diff, then drives Chromium through the admin and the
// funnel and writes PNGs plus a short animated WebP of a walk to docs/images/.
// Reduced motion keeps the stills stable; the animation keeps motion on, since showing
// the step transitions is its point. The server and the temp DB are removed on any exit.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { generateTraffic } from './lib/generator.ts';
import { createClient } from './lib/http.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/images');
const WEB_DIST = join(ROOT, 'apps/web/dist');
const FUNNEL = 'workstyle-planner';
const ADMIN = { username: 'shots-admin', password: 'shots-password' } as const;
const GENERATOR_KEY = 'shots-generator-key';
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
/** The animation is downscaled for the README; the cap is CLAUDE.md 15.1's 3 MB. */
const ANIMATION = { width: 360, fps: 12, maxBytes: 3 * 1024 * 1024 } as const;

const write = (line: string) => process.stdout.write(`${line}\n`);

/** Answers of the walk (variant A of v2, hybrid branch), keyed by `data-step`. */
const ANSWERS: Record<string, number | readonly string[]> = {
  team_size: 12,
  work_mode: ['Hybrid'],
  priorities: ['Decision speed', 'Deep-focus time'],
  timezone_span: ['Mostly the same hours'],
  office_days: 2,
  meeting_hours: 6,
  async_maturity: ['Important decisions are documented'],
  tool_count: 6,
};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('the server exited during start-up');
    const ok = await fetch(`${baseUrl}/api/health`)
      .then((res) => res.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('the server did not answer /api/health within 30 s');
}

function startServer(port: number, databasePath: string): ChildProcess {
  return spawn(process.execPath, ['apps/server/src/main.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: databasePath,
      WEB_DIST,
      LOG_LEVEL: 'warn',
      ADMIN_USER: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
      GENERATOR_KEY,
      RATE_LIMIT_SESSIONS: '600',
      RATE_LIMIT_EVENTS: '600',
    },
  });
}

/** The real second-iteration config as a draft, never published here: the Versions diff. */
async function uploadDraft(baseUrl: string): Promise<number> {
  const config: unknown = JSON.parse(readFileSync(join(ROOT, 'configs/funnel-v3.json'), 'utf8'));
  const call = createClient({
    baseUrl,
    admin: { user: ADMIN.username, password: ADMIN.password },
  });
  const { data } = await call('uploadVersion', { query: {}, body: config });
  return data.version.version;
}

/** Sends one small batch twice, as after a timeout: the second copy is all duplicates. */
async function sendBatchTwice(baseUrl: string): Promise<void> {
  const call = createClient({ baseUrl });
  const { data } = await call('createSession', { body: { funnelId: FUNNEL } });
  const s = data.session;
  const event = (seq: number, name: string, stepId: string) => ({
    event_id: uuidv7(),
    session_id: s.id,
    name,
    client_timestamp: new Date().toISOString(),
    client_seq: seq,
    funnel_id: FUNNEL,
    funnel_version: s.funnelVersion,
    experiment_id: s.experimentId,
    variant: s.variant,
    step_id: stepId,
    properties: {},
  });
  const batch = {
    events: [
      event(1, 'step_viewed', 'intro'),
      event(2, 'step_viewed', 'team_size'),
      event(3, 'answer_submitted', 'team_size'),
    ],
  };
  await call('eventsBatch', { body: batch });
  await new Promise((resolve) => setTimeout(resolve, 600));
  await call('eventsBatch', { body: batch });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  write(`  ${name}.png`);
}

async function adminShots(browser: Browser, baseUrl: string, draft: number): Promise<void> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: DESKTOP,
    httpCredentials: ADMIN,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  await page.goto('/admin');
  await page.getByRole('heading', { name: 'Funnel journey' }).waitFor();
  await page.getByText('Loading analytics…').waitFor({ state: 'hidden' });
  await page
    .getByRole('table', { name: 'Data quality' })
    .getByRole('row', { name: /Matches generator ground truth/ })
    .getByText('Yes')
    .waitFor();
  await shoot(page, 'dashboard', true);

  await page.getByRole('heading', { name: 'Funnel journey' }).scrollIntoViewIfNeeded();
  await page.locator('[data-journey-target="step"][data-hot="true"]').first().click();
  await page.locator('[popover]:popover-open').first().waitFor();
  await shoot(page, 'journey-popover');

  await page.goto('/admin/versions');
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.getByRole('heading', { name: `Changes in version ${String(draft)}` }).waitFor();
  await page.getByText('Comparing…').waitFor({ state: 'hidden' });
  await page.mouse.move(0, DESKTOP.height - 1);
  await shoot(page, 'versions-diff', true);

  await page.goto('/admin/live');
  await page.getByText(/^Streaming/).waitFor();
  await sendBatchTwice(baseUrl);
  await page.getByRole('cell', { name: 'Ignored duplicate', exact: true }).nth(2).waitFor();
  await shoot(page, 'live-events');
  await context.close();
}

/** Walks variant A from the intro to the result, calling `onStep` on each answered step. */
async function walk(page: Page, onStep: (stepId: string) => Promise<void>): Promise<void> {
  await page.goto('/?variant=A');
  await page.locator('[data-step="intro"]').waitFor();
  await onStep('intro');
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 15; i += 1) {
    await page.waitForURL(/\/s\/(?!intro)/);
    const stepId = (await page.locator('[data-step]').getAttribute('data-step')) ?? '';
    if (stepId === 'result') break;
    const answer = ANSWERS[stepId];
    if (typeof answer === 'number') {
      await page.getByRole('spinbutton').fill(String(answer));
    } else if (answer !== undefined) {
      for (const label of answer) {
        await page.getByRole(answer.length > 1 ? 'checkbox' : 'radio', { name: label }).click();
      }
    } else {
      throw new Error(`no answer planned for step ${stepId}`);
    }
    await onStep(stepId);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL((url) => !url.pathname.endsWith(`/s/${stepId}`));
  }
  await page.getByText('What a week could look like').waitFor();
  await onStep('result');
}

async function funnelShots(browser: Browser, baseUrl: string): Promise<void> {
  const sizes = [
    ['1440', { viewport: DESKTOP }],
    ['390', { viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ] as const satisfies readonly (readonly [string, BrowserContextOptions])[];
  for (const [suffix, options] of sizes) {
    const context = await browser.newContext({
      ...options,
      baseURL: baseUrl,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await walk(page, async (stepId) => {
      if (stepId === 'work_mode') await shoot(page, `funnel-question-${suffix}`);
      if (stepId === 'result') await shoot(page, `funnel-result-${suffix}`, true);
    });
    await context.close();
  }
}

async function animation(browser: Browser, baseUrl: string, workDir: string): Promise<void> {
  const recordingStart = Date.now();
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: MOBILE,
    recordVideo: { dir: workDir, size: MOBILE },
    // Steps swap in place: at a few frames per second the slide of the view transition
    // shows up as the card jumping sideways and half out of the frame.
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  // The first frames are a blank page while the app loads; the animation starts at the intro.
  let skipSeconds = 0;
  await walk(page, async (stepId) => {
    if (stepId === 'intro') skipSeconds = (Date.now() - recordingStart) / 1000;
    await page.waitForTimeout(700);
  });
  await page.waitForTimeout(1200);
  const video = page.video();
  await context.close();
  if (video === null) throw new Error('no video was recorded');
  const webm = await video.path();
  const out = join(OUT, 'funnel-walkthrough.webp');
  const ffmpeg = spawnSync(
    'ffmpeg',
    [
      ...['-y', '-loglevel', 'error', '-ss', skipSeconds.toFixed(2), '-i', webm],
      ...['-vf', `fps=${String(ANIMATION.fps)},scale=${String(ANIMATION.width)}:-1:flags=lanczos`],
      ...['-c:v', 'libwebp_anim', '-quality', '70', '-loop', '0', '-an', out],
    ],
    { stdio: 'inherit' },
  );
  if (ffmpeg.status !== 0) throw new Error('ffmpeg failed to convert the walk video');
  const bytes = statSync(out).size;
  if (bytes > ANIMATION.maxBytes) {
    throw new Error(`funnel-walkthrough.webp is ${String(bytes)} bytes, over 3 MB`);
  }
  write(`  funnel-walkthrough.webp (${String(Math.round(bytes / 1024))} KB)`);
}

async function main(): Promise<void> {
  // Checked first: a missing encoder must not fail the run after the PNGs are overwritten.
  const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (encoders.status !== 0 || !encoders.stdout.includes('libwebp_anim')) {
    throw new Error('pnpm screenshots needs ffmpeg with the libwebp_anim encoder on PATH');
  }
  // Always rebuilt (a few seconds): a stale dist would quietly screenshot an old UI.
  write('Building the web app…');
  const build = spawnSync('pnpm', ['--filter', '@funnel/web', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (build.status !== 0) throw new Error('web build failed');
  mkdirSync(OUT, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'funnel-shots-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const server = startServer(port, join(workDir, 'shots.db'));
  let browser: Browser | null = null;
  try {
    await waitForHealth(baseUrl, server);
    write(`Server on ${baseUrl}; generating traffic…`);
    const run = await generateTraffic({
      baseUrl,
      sessions: 150,
      seed: 42,
      publishNext: true,
      generatorKey: GENERATOR_KEY,
      admin: { user: ADMIN.username, password: ADMIN.password },
    });
    if (!run.upload.matches) throw new Error('the generator run does not match its ground truth');
    const draft = await uploadDraft(baseUrl);
    write(`Draft version ${String(draft)} uploaded; taking screenshots…`);
    browser = await chromium.launch();
    await adminShots(browser, baseUrl, draft);
    await funnelShots(browser, baseUrl);
    await animation(browser, baseUrl, workDir);
    write(`Done: ${OUT}`);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    if (server.exitCode === null) {
      await new Promise((resolve) => server.once('exit', resolve));
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
