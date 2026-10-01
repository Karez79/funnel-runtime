// Counts reviewer findings from PR comments, so AGENT_LOG/TIMELINE numbers come from
// data instead of memory (two hand-counted claims in Phase 0 were wrong).
// Every reviewer comment ends with `Blockers: N, majors: N, minors: N.` counting the
// findings that are new in that round; re-reviews list still-open ones separately.
// Usage: pnpm review:stats [--from <pr>] [--to <pr>]
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const REPO = 'Karez79/funnel-runtime';
const COUNTS = /Blockers:\s*(\d+),\s*majors:\s*(\d+),\s*minors:\s*(\d+)/gi;
const VERDICT = /##\s*Reviewer[^\n]*?(APPROVE|CHANGES REQUESTED)/i;

const Pr = z.object({ number: z.number(), title: z.string(), state: z.string() });
const Comment = z.object({ body: z.string(), created_at: z.string() });

function gh(args: string[]): unknown {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

interface Round {
  verdict: string;
  blockers: number;
  majors: number;
  minors: number;
}

function roundsOf(pr: number): Round[] {
  // --slurp wraps every page in its own array.
  const comments = z
    .array(z.array(Comment))
    .parse(gh(['api', '--paginate', '--slurp', `repos/${REPO}/issues/${pr}/comments`]))
    .flat();
  return comments.flatMap((c) => {
    // Only reviewer comments count, and only their final counts line (earlier lines may
    // quote a previous round).
    if (!/^\s*##\s*Re(view|-review)/i.test(c.body)) return [];
    const counts = [...c.body.matchAll(COUNTS)].at(-1);
    if (!counts) return [];
    return [
      {
        verdict: VERDICT.exec(c.body)?.[1]?.toUpperCase() ?? '?',
        blockers: Number(counts[1]),
        majors: Number(counts[2]),
        minors: Number(counts[3]),
      },
    ];
  });
}

const { values } = parseArgs({
  options: { from: { type: 'string' }, to: { type: 'string' } },
});
const from = Number(values.from ?? 0);
const to = Number(values.to ?? Number.MAX_SAFE_INTEGER);

const prs = z
  .array(Pr)
  .parse(
    gh([
      'pr',
      'list',
      '-R',
      REPO,
      '--state',
      'all',
      '--limit',
      '500',
      '--json',
      'number,title,state',
    ]),
  )
  .filter((p) => p.number >= from && p.number <= to)
  .sort((a, b) => a.number - b.number);

const lines = [
  '| PR | Rounds | Blockers | Majors | Minors | Last verdict | Title |',
  '|---|---|---|---|---|---|---|',
];
const total = { prs: 0, rounds: 0, blockers: 0, majors: 0, minors: 0 };
for (const pr of prs) {
  const rounds = roundsOf(pr.number);
  if (rounds.length === 0) continue;
  const sum = (k: 'blockers' | 'majors' | 'minors') => rounds.reduce((n, r) => n + r[k], 0);
  total.prs += 1;
  total.rounds += rounds.length;
  total.blockers += sum('blockers');
  total.majors += sum('majors');
  total.minors += sum('minors');
  const last = rounds.at(-1)?.verdict ?? '?';
  lines.push(
    `| #${pr.number} | ${rounds.length} | ${sum('blockers')} | ${sum('majors')} | ${sum('minors')} | ${last} | ${pr.title} |`,
  );
}
lines.push(
  `| **Total** | ${total.rounds} | ${total.blockers} | ${total.majors} | ${total.minors} | | ${total.prs} PRs |`,
);
process.stdout.write(`${lines.join('\n')}\n`);
