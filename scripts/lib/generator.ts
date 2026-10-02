// Synthetic traffic and its ground truth (CLAUDE.md 9.1). The run goes through the real
// HTTP API only. With `publishNext` it starts ~40% of the sessions on the active version,
// leaves some of them half-way, publishes the next draft through the admin API, starts
// the rest on the new version and then finishes the paused ones, which must still be on
// their pinned version.
//
// The ground truth is the shared `aggregate` applied to the generator's own record of
// what it did (sessions it created, events it delivered first, copies it sent again,
// items it broke on purpose), not to anything the server reports, so `verify` compares
// two independent computations of the same definition. Every check is limited to the
// run's time window on the server's own clock: it opens at the exact creation time of
// the first session (`createdAt` of the session response) and closes one second after
// the last Date header, so traffic just before or after the run is not counted. Every
// check also asks for `traffic=generator`: on a public URL real visitors can start
// sessions, re-send beacons or send rejected events inside the window, and the server
// counts only rows written with the generator key, all of which are in the journal.
import {
  aggregate,
  AnalyticsFiltersSchema,
  coversSessions,
  VARIANTS,
  type AnalyticsEvent,
  type AnalyticsSession,
  type AnalyticsVersion,
  type GroundTruth,
  type REJECT_REASONS,
  type VariantKey,
} from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { createDelivery } from './delivery.ts';
import { createClient } from './http.ts';
import {
  PERSONAS,
  resumeVisitor,
  startVisitor,
  walk,
  type Context,
  type Plan,
  type Utm,
  type Visitor,
} from './journey.ts';
import { chance, int, mulberry32, sessionRng, weighted } from './random.ts';

export const MIN_SESSIONS = 100;

export interface GenerateOptions {
  readonly baseUrl: string;
  readonly sessions: number;
  readonly seed: number;
  readonly publishNext: boolean;
  readonly generatorKey: string;
  readonly admin: { readonly user: string; readonly password: string };
  /** Sessions walking at the same time. */
  readonly concurrency?: number;
  readonly log?: (line: string) => void;
}

const CAMPAIGNS: readonly (Utm & { weight: number })[] = [
  { campaign: 'spring_launch', source: 'google', medium: 'cpc', weight: 30 },
  { campaign: 'partner_webinar', source: 'partner', medium: 'referral', weight: 20 },
  { campaign: 'linkedin_retarget', source: 'linkedin', medium: 'paid_social', weight: 25 },
  { campaign: 'newsletter_may', source: 'newsletter', medium: 'email', weight: 15 },
];
const NO_UTM_SHARE = 0.1;
/** Overrides are QA traffic, hidden by default (9.1: four of them). */
const OVERRIDES: readonly VariantKey[] = ['A', 'B', 'A', 'B'];
const SHARE_BEFORE_PUBLISH = 0.4;
const PAUSED_SHARE = 0.35;
const SHUFFLED_SHARE = 0.1;
const BACK_SHARE = 0.2;
/** One session in this many sends an event with the wrong variant. */
const MISMATCH_EVERY = 40;
const BATCH_SIZE = 20;
const RESEND_SHARE = 0.1;
/** The window closes one second past the last Date header (second precision). */
const SECOND = 1000;
/** The campaign the campaign-filtered check uses. */
const CHECK_CAMPAIGN = 'spring_launch';

function plans(options: GenerateOptions, split: boolean): { before: Plan[]; after: Plan[] } {
  const { sessions: n, seed } = options;
  const overrideAt = new Map(
    OVERRIDES.map((variant, k) => [Math.floor(((k + 1) * n) / 5), variant]),
  );
  const before: Plan[] = [];
  const after: Plan[] = [];
  const cut = split ? Math.round(n * SHARE_BEFORE_PUBLISH) : n;
  for (let index = 0; index < n; index++) {
    const rng = sessionRng(seed, index);
    const override = overrideAt.get(index) ?? null;
    const early = index < cut;
    const plan: Plan = {
      index,
      rng,
      persona: weighted(rng, PERSONAS),
      utm: chance(rng, NO_UTM_SHARE) ? null : weighted(rng, CAMPAIGNS),
      override,
      shuffled: chance(rng, SHUFFLED_SHARE),
      backs: chance(rng, BACK_SHARE) ? int(rng, 1, 2) : 0,
      mismatch: override === null && index % MISMATCH_EVERY === MISMATCH_EVERY / 4,
      pauseAfter:
        split && early && override === null && chance(rng, PAUSED_SHARE) ? int(rng, 1, 3) : null,
    };
    (early ? before : after).push(plan);
  }
  return { before, after };
}

/** Runs `task` over `items` with at most `limit` in flight. */
async function pool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function generateTraffic(options: GenerateOptions) {
  if (options.sessions < MIN_SESSIONS) {
    throw new Error(`--sessions must be at least ${String(MIN_SESSIONS)}`);
  }
  const log = options.log ?? (() => undefined);
  const call = createClient(options);
  const window = { last: 0 };
  const onDate = (date: Date) => {
    window.last = Math.max(window.last, date.getTime());
  };
  const runRng = mulberry32(options.seed);
  const delivery = createDelivery(call, {
    batchSize: BATCH_SIZE,
    resend: () => chance(runRng, RESEND_SHARE),
    onDate,
  });

  const active = (await call('activeVersion')).data.version;
  const funnelId = active.funnelId;
  const { versions } = (await call('listVersions')).data;
  const draft = options.publishNext
    ? versions
        .filter((v) => v.state === 'draft' && v.version > active.version)
        .sort((a, b) => a.version - b.version)[0]
    : undefined;
  if (options.publishNext && !draft) {
    log(
      `No draft newer than v${String(active.version)}: every session starts on the active version.`,
    );
  }

  const ctx: Context = { call, delivery, funnelId, onDate };
  const visitors: Visitor[] = [];
  const { before, after } = plans(options, draft !== undefined);
  const concurrency = options.concurrency ?? 4;
  const run = async (plan: Plan) => {
    const visitor = await startVisitor(ctx, plan);
    visitors.push(visitor);
    await walk(ctx, visitor);
  };

  log(`Starting ${String(before.length)} sessions on v${String(active.version)}…`);
  await pool(before, concurrency, run);
  let published: number | null = null;
  if (draft) {
    await call('publishVersion', {
      params: { v: draft.version },
      body: { note: 'pnpm generate --publish-next' },
    });
    published = draft.version;
    log(`Published v${String(draft.version)}; ${String(after.length)} new sessions start on it.`);
  }
  const paused = visitors.filter((v) => v.outcome === 'paused');
  await pool(after, concurrency, run);
  log(`Finishing ${String(paused.length)} paused sessions on their pinned version…`);
  await pool(paused, concurrency, async (visitor) => {
    await resumeVisitor(ctx, visitor);
    await walk(ctx, visitor, false);
  });
  await delivery.drain();
  await delivery.sendBroken(brokenItems(visitors));
  onDate((await call('health')).date);

  const { truth, skipped } = await groundTruth(options, call, visitors, delivery.report(), window);
  const upload = (await call('uploadGroundTruth', { body: truth })).data;
  return { truth, skipped, upload, published, visitors, delivery: delivery.report() };
}

type RejectReason = (typeof REJECT_REASONS)[number];

/** A few items ingest must reject, one per reason it can tell from the item alone. */
function brokenItems(visitors: readonly Visitor[]): { item: unknown; reason: RejectReason }[] {
  const visitor = visitors.find((v) => v.plan.override === null) ?? visitors[0];
  if (!visitor) return [];
  const base = {
    session_id: visitor.id,
    client_timestamp: new Date().toISOString(),
    client_seq: 0,
    funnel_id: visitor.funnelId,
    funnel_version: visitor.version,
    experiment_id: visitor.experimentId,
    variant: visitor.variant,
    step_id: null,
    properties: {},
  };
  return [
    { item: { ...base, event_id: uuidv7(), name: 'confetti_shown' }, reason: 'unknown_event' },
    {
      item: { ...base, event_id: uuidv7(), session_id: uuidv7(), name: 'step_viewed' },
      reason: 'unknown_session',
    },
    { item: { ...base, name: 'step_viewed' }, reason: 'invalid_event' },
    { item: { ...base, event_id: uuidv7(), name: 'session_started' }, reason: 'server_only' },
  ];
}

type Report = ReturnType<ReturnType<typeof createDelivery>['report']>;

async function groundTruth(
  options: GenerateOptions,
  call: ReturnType<typeof createClient>,
  visitors: readonly Visitor[],
  report: Report,
  window: { last: number },
): Promise<{ truth: GroundTruth; skipped: string[] }> {
  const listed = (await call('listVersions')).data.versions.filter((v) => v.state === 'published');
  const versions: AnalyticsVersion[] = [];
  for (const v of listed) {
    const [A, B] = await Promise.all(
      VARIANTS.map(async (variant) => {
        const { data } = await call('previewVersion', {
          params: { v: v.version },
          query: { variant },
        });
        return data.funnel;
      }),
    );
    if (!A || !B) throw new Error(`preview of v${String(v.version)} failed`);
    versions.push({ version: v.version, active: v.active, funnels: { A, B } });
  }

  const sessions: AnalyticsSession[] = visitors.map((v) => ({
    id: v.id,
    version: v.version,
    variant: v.variant,
    trafficType: v.plan.override === null ? 'synthetic' : 'qa',
    utmSource: v.plan.utm?.source ?? null,
    utmCampaign: v.plan.utm?.campaign ?? null,
    resultId: v.resultId,
    createdAt: v.createdAt,
  }));
  const events: AnalyticsEvent[] = [
    // The server writes `session_started` itself with every session (6.2).
    ...visitors.map((v) => ({
      eventId: `srv:session_started:${v.id}`,
      sessionId: v.id,
      name: 'session_started',
      stepId: null,
      serverTs: v.createdAt,
      properties: {},
    })),
    ...report.delivered.map((d) => ({
      eventId: d.event.event_id,
      sessionId: d.event.session_id,
      name: d.event.name,
      stepId: d.event.step_id,
      serverTs: d.serverTs,
      properties: d.event.properties,
      outOfOrder: d.outOfOrder,
      contextMismatch: d.contextMismatch,
    })),
  ];

  const from = visitors.map((v) => v.createdAt).sort()[0] ?? new Date(window.last).toISOString();
  const to = new Date(window.last + SECOND).toISOString();
  const touched = [...new Set(visitors.map((v) => v.version))].sort((a, b) => a - b);
  const checks = touched.flatMap((version) => {
    const base = { version: String(version), from, to, traffic: 'generator' };
    const name = `v${String(version)}`;
    return [
      { name, query: base },
      { name: `${name} · QA included`, query: { ...base, includeQa: 'true' } },
      {
        name: `${name} · campaign ${CHECK_CAMPAIGN}`,
        query: { ...base, campaign: CHECK_CAMPAIGN },
      },
      { name: `${name} · variant B`, query: { ...base, variant: 'B' } },
    ];
  });
  const skipped: string[] = [];
  const truth: GroundTruth = {
    generatedAt: new Date(window.last).toISOString(),
    seed: options.seed,
    sessions: visitors.length,
    checks: checks
      .map(({ name, query }) => ({
        name,
        query,
        expected: aggregate({
          sessions,
          events,
          versions,
          ingest: { duplicates: report.duplicates, rejected: report.rejected },
          filters: AnalyticsFiltersSchema.parse(query),
          now: new Date(window.last),
        }),
      }))
      // A check without sessions proves nothing and the server refuses it, e.g. a
      // campaign no session of a version came from; the CLI lists what was left out.
      .filter((check) => {
        if (coversSessions(check.expected)) return true;
        skipped.push(check.name);
        return false;
      }),
  };
  return { truth, skipped };
}
