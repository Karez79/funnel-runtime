// The second iteration as one script (CLAUDE.md 13.2 Phase 7): against a running server,
// through its HTTP API only, the next config goes in as a draft, gets published (no
// redeploy), old sessions finish on their pinned version, new ones run the new version,
// a rollback brings new sessions back, and the database schema never changes.
//
// Visitors are the generator's own (journey.ts): the same session, state, event and
// result handling, driven by the shared engine, with synthetic traffic and the generator
// key. Here they behave on purpose rather than at random: they never drop off, pause
// exactly where the scenario needs it, and always click the result CTA.
//
// Re-runs: the config upload is idempotent (same hash → same version). If the version
// is already published from an earlier run, it is activated again instead of published,
// and if a broken earlier run left it active, the script rolls back first so it always
// starts from the version before it.
import { readFileSync } from 'node:fs';
import { parseConfig, type VariantKey } from '@funnel/shared';
import { v7 as uuidv7 } from 'uuid';
import { createDelivery } from './delivery.ts';
import { secretHint } from './env.ts';
import { createClient, type Client } from './http.ts';
import {
  resumeVisitor,
  startVisitor,
  walk,
  type Context,
  type Persona,
  type Plan,
  type Visitor,
  type WalkOptions,
} from './journey.ts';
import { sessionRng } from './random.ts';

export interface DemoOptions {
  readonly baseUrl: string;
  readonly generatorKey: string;
  readonly admin: { readonly user: string; readonly password: string };
  /** The next config to publish; configs/funnel-v3.json by default. */
  readonly configPath?: string;
  readonly log?: (line: string) => void;
}

export interface DemoCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

const DEFAULT_CONFIG = new URL('../../configs/funnel-v3.json', import.meta.url);
const NOTE = 'pnpm demo:iteration2';
const SEED = 2;
/** Sessions per group; a group grows until it has both variants (hash assignment). */
const GROUP = { min: 4, max: 12 } as const;
/** The step v3 removes from variant B: a v2 session of B pauses right on it. */
const REMOVED_IN_B = 'tool_count';
/** The branch v3 adds and the result it leads to. */
const NEW_BRANCH = { step: 'security_constraints', result: 'regulated_scale' } as const;

/** Hybrid on the old version: every step of v2 is on its path. */
const HYBRID: Persona = {
  name: 'hybrid',
  weight: 1,
  answers: { work_mode: 'hybrid', async_maturity: 'medium', meeting_hours: 8 },
};
/** Compliance on the new version: opens the new branch and ends on the new result. */
const COMPLIANCE: Persona = {
  name: 'compliance',
  weight: 1,
  answers: {
    work_mode: 'hybrid',
    priorities: ['compliance'],
    [NEW_BRANCH.step]: 'regulated',
    meeting_hours: 8,
    async_maturity: 'medium',
  },
};

const variants = (visitors: readonly Visitor[]) => new Set(visitors.map((v) => v.variant));
const list = (visitors: readonly Visitor[]) =>
  visitors.map((v) => `${v.variant}@v${String(v.version)}`).join(', ');

export async function runIterationDemo(options: DemoOptions): Promise<DemoCheck[]> {
  const log = options.log ?? (() => undefined);
  const checks: DemoCheck[] = [];
  const check = (label: string, ok: boolean, detail: string) => {
    checks.push({ label, ok, detail });
  };

  const raw: unknown = JSON.parse(readFileSync(options.configPath ?? DEFAULT_CONFIG, 'utf8'));
  const parsed = parseConfig(raw);
  if (!parsed.ok) {
    check('The config file parses', false, parsed.issues.join('; '));
    return checks;
  }
  const target = parsed.config.version;
  const call = createClient(options);
  const delivery = createDelivery(call, {
    batchSize: 20,
    resend: () => false,
    onDate: () => undefined,
  });

  let index = 0;
  const plan = (persona: Persona, override: VariantKey | null = null): Plan => ({
    index,
    rng: sessionRng(SEED, index++),
    persona,
    utm: null,
    override,
    shuffled: false,
    backs: 0,
    mismatch: false,
    pauseAfter: null,
  });
  const play = { mayDrop: false, clickCta: true } satisfies WalkOptions;

  let activatedTarget = false;
  try {
    let active = (await call('activeVersion')).data.version;
    if (active.version === target) {
      log(`v${String(target)} is active from an earlier run: rolling back first.`);
      await call('rollback', { body: { note: `${NOTE}: start from the previous version` } });
      active = (await call('activeVersion')).data.version;
    }
    const baseline = active.version;
    const ctx: Context = { call, delivery, funnelId: active.funnelId, onDate: () => undefined };
    const schemaBefore = (await call('dbSchema')).data;
    const v = (n: number) => `v${String(n)}`;

    /** Starts sessions until the group has both variants; a missing one is forced (QA). */
    const group = async (persona: Persona): Promise<Visitor[]> => {
      const out: Visitor[] = [];
      while (out.length < GROUP.min || (variants(out).size < 2 && out.length < GROUP.max)) {
        out.push(await startVisitor(ctx, plan(persona)));
      }
      for (const variant of ['A', 'B'] as const) {
        if (!variants(out).has(variant)) out.push(await startVisitor(ctx, plan(persona, variant)));
      }
      return out;
    };

    // 1. Sessions on the active version: the first of A finishes, the others stop
    // half-way, those of B right on the step the new version removes from B.
    log(`Active version: ${v(baseline)}. Starting sessions on it…`);
    const old = await group(HYBRID);
    const done = old.find((o) => o.variant === 'A');
    for (const visitor of old) {
      const { sequence } = visitor.funnel;
      const stopAt =
        visitor === done
          ? undefined
          : visitor.variant === 'B' && sequence.includes(REMOVED_IN_B)
            ? REMOVED_IN_B
            : sequence[Math.floor(sequence.length / 2)];
      await walk(ctx, visitor, { ...play, ...(stopAt ? { stopAt } : {}) });
    }
    const paused = old.filter((o) => o.outcome === 'paused');
    const onRemoved = paused.find((o) => o.state.currentStepId === REMOVED_IN_B);
    check(
      `Sessions start on the active version ${v(baseline)}`,
      old.every((o) => o.version === baseline),
      `${String(old.length)} sessions (${list(old)}), ${String(paused.length)} left half-way`,
    );
    check(
      `A variant B session is paused on ${REMOVED_IN_B}`,
      onRemoved?.variant === 'B',
      onRemoved ? `session ${onRemoved.id}` : 'none',
    );

    // 2. The new config goes in as a draft through the admin API.
    const upload = (await call('uploadVersion', { query: {}, body: raw })).data;
    const { errors, warnings } = upload.lint;
    check(
      `${v(target)} uploaded through POST /api/admin/versions`,
      upload.version.version === target && errors.length === 0,
      `${upload.created ? 'new draft' : `already stored (same hash), ${upload.version.state}`}; ` +
        `lint: ${String(errors.length)} errors, ${String(warnings.length)} warnings`,
    );
    for (const w of warnings) log(`  lint warning: ${w.message}`);
    const diff = (
      await call('versionDiff', { params: { v: target }, query: { against: 'active' } })
    ).data;
    log(`  diff against ${v(baseline)}: ${String(diff.changes.length)} changes`);
    for (const c of diff.changes) log(`    ${c.message}`);

    // 3. Publish it, or activate it again when an earlier run already published it.
    const republish = upload.version.state === 'published';
    const body = { note: NOTE };
    if (republish) await call('activateVersion', { params: { v: target }, body });
    else await call('publishVersion', { params: { v: target }, body });
    activatedTarget = true;
    const now = (await call('activeVersion')).data.version.version;
    check(
      `${v(target)} ${republish ? 'activated again (published on an earlier run)' : 'published'} without a redeploy`,
      now === target,
      `active version: ${v(now)}`,
    );

    // 4. The paused sessions come back: still on the old version, and they finish.
    for (const visitor of paused) {
      await resumeVisitor(ctx, visitor);
      await walk(ctx, visitor, play);
    }
    check(
      `Paused sessions finish on their pinned ${v(baseline)}`,
      paused.length > 0 && paused.every((o) => o.version === baseline && o.outcome === 'result'),
      `${String(paused.length)} sessions reached their result`,
    );
    check(
      `The variant B session answers ${REMOVED_IN_B} on ${v(baseline)} and reaches its result`,
      onRemoved?.outcome === 'result' && onRemoved.state.answers[REMOVED_IN_B] !== undefined,
      onRemoved ? `result ${String(onRemoved.resultId)}` : 'none',
    );

    // 5. New sessions run the new version; one of B stops on the new branch for later.
    const fresh = await group(COMPLIANCE);
    const late = fresh.findLast((f) => f.variant === 'B');
    for (const visitor of fresh) {
      await walk(ctx, visitor, visitor === late ? { ...play, stopAt: NEW_BRANCH.step } : play);
    }
    const finished = fresh.filter((f) => f.outcome === 'result');
    check(
      `New sessions start on ${v(target)}`,
      fresh.every((f) => f.version === target),
      `${String(fresh.length)} sessions (${list(fresh)})`,
    );
    const freshB = fresh.filter((f) => f.variant === 'B');
    check(
      `Variant B of ${v(target)} has no ${REMOVED_IN_B}`,
      freshB.length > 0 &&
        freshB.every((f) => !f.funnel.sequence.includes(REMOVED_IN_B) && !f.seen.has(REMOVED_IN_B)),
      `${String(freshB.length)} B sessions`,
    );
    check(
      `Compliance branch: priorities → ${NEW_BRANCH.step} → ${NEW_BRANCH.result}`,
      finished.length > 0 &&
        finished.every((f) => f.seen.has(NEW_BRANCH.step) && f.resultId === NEW_BRANCH.result),
      `${String(finished.length)} sessions`,
    );

    await delivery.drain();
    const freshIds = new Set(fresh.map((f) => f.id));
    const expanded = delivery
      .report()
      .delivered.filter(
        (d) => d.event.name === 'recommendation_expanded' && freshIds.has(d.event.session_id),
      ).length;
    check(
      `recommendation_expanded accepted from ${v(target)} sessions`,
      expanded === finished.length && delivery.report().surprises.length === 0,
      `${String(expanded)} accepted, one per CTA click`,
    );
    const from = old[0];
    if (!from) throw new Error('no session on the old version');
    const { data: refused } = await call('eventsBatch', {
      body: {
        events: [
          {
            event_id: uuidv7(),
            session_id: from.id,
            name: 'recommendation_expanded',
            client_timestamp: new Date().toISOString(),
            client_seq: from.seq + 1,
            funnel_id: from.funnelId,
            funnel_version: from.version,
            experiment_id: from.experimentId,
            variant: from.variant,
            step_id: 'result',
            properties: {},
          },
        ],
      },
    });
    const answer = refused.results[0];
    check(
      `…and rejected from a ${v(baseline)} session (not in its catalog)`,
      answer?.status === 'rejected' && answer.reason === 'unknown_event',
      answer ? `${answer.status}${answer.status === 'rejected' ? ` ${answer.reason}` : ''}` : '—',
    );

    // 6. Roll back: new sessions are on the old version again, begun ones stay on theirs.
    await call('rollback', { body });
    activatedTarget = false;
    const back = (await call('activeVersion')).data.version.version;
    check(`Rolled back to ${v(baseline)}`, back === baseline, `active version: ${v(back)}`);
    const after = [await startVisitor(ctx, plan(HYBRID)), await startVisitor(ctx, plan(HYBRID))];
    for (const visitor of after) await walk(ctx, visitor, play);
    check(
      `New sessions after the rollback start on ${v(baseline)}`,
      after.every((a) => a.version === baseline && a.outcome === 'result'),
      list(after),
    );
    if (late) {
      await resumeVisitor(ctx, late);
      await walk(ctx, late, play);
    }
    check(
      `A ${v(target)} session begun before the rollback finishes on ${v(target)}`,
      late?.version === target && late.outcome === 'result',
      late ? `result ${String(late.resultId)}` : 'none',
    );
    await delivery.drain();

    // 7. Analytics of every version stay available; the new event is counted for the new one.
    const { versions } = (await call('analyticsFilters')).data;
    const started: string[] = [];
    let other: number | undefined;
    for (const { version } of versions) {
      const summary = (await call('analyticsSummary', { query: { version: String(version) } }))
        .data;
      started.push(`${v(version)}: ${String(summary.kpis.all.started)} started`);
      if (version === target) {
        other = summary.otherEvents.find((e) => e.name === 'recommendation_expanded')?.sessions;
      }
    }
    const listed = new Set(versions.map((x) => x.version));
    check(
      'Analytics available for every published version',
      listed.has(baseline) && listed.has(target) && started.length === versions.length,
      started.join(' · '),
    );
    check(
      `Other events of ${v(target)} list recommendation_expanded`,
      other !== undefined && other >= expanded,
      `${String(other ?? 0)} sessions`,
    );

    // 8. No DDL ran at any point.
    const schemaAfter = (await call('dbSchema')).data;
    check(
      'Database schema unchanged',
      schemaAfter.hash === schemaBefore.hash && schemaAfter.migrations === schemaBefore.migrations,
      `sqlite_master ${schemaAfter.hash.slice(0, 12)}…, ${String(schemaAfter.objects)} objects, ` +
        `${String(schemaAfter.migrations)} migrations`,
    );
    check(
      'Every ingest answer was the expected one',
      delivery.report().surprises.length === 0,
      delivery.report().surprises.join('; ') || `${String(delivery.report().batches)} batches`,
    );
  } catch (error) {
    // A refused secret names the variable to export, like generate and verify do.
    const reason = secretHint(error) ?? (error instanceof Error ? error.message : String(error));
    check('The demo ran to the end', false, reason);
    if (activatedTarget) {
      // Leave the server as it was found: the new version must not stay active by
      // accident. Only if it still is: a rollback that reached the server but whose
      // answer was lost must not be followed by a second one, which would move the
      // server off the previous version too.
      const undo = await undoActivation(call, target);
      check(`v${String(target)} is not left active`, !undo.startsWith('failed'), undo);
    }
  }
  return checks;
}

/** Rolls back only while `target` is the active version; says what it did. */
async function undoActivation(call: Client, target: number): Promise<string> {
  try {
    const active = (await call('activeVersion')).data.version.version;
    if (active !== target) return `already off v${String(target)}: v${String(active)} is active`;
    await call('rollback', { body: { note: `${NOTE}: undo after a failure` } });
    return 'rolled back';
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
