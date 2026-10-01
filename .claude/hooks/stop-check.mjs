// Stop hook: Claude may not finish a turn while `pnpm check` is red (CLAUDE.md 14).
// No-op until the workspace has a `check` script. Blocks up to MAX_BLOCKS times in a
// row per session (counter in tmpdir), then lets Claude stop so it cannot loop forever.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from './root.mjs';

const MAX_BLOCKS = 3;
const TIMEOUT_MS = 540_000; // below the 600 s hook timeout, so a hung check still blocks

const input = JSON.parse(readFileSync(0, 'utf8'));
const root = repoRoot(input.cwd ?? process.cwd());
const pkgPath = join(root, 'package.json');
if (!existsSync(pkgPath)) process.exit(0);
if (!JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.check) process.exit(0);

const counterFile = join(tmpdir(), `funnel-stop-check-${input.session_id ?? 'default'}`);
const blocks = input.stop_hook_active && existsSync(counterFile)
  ? Number(readFileSync(counterFile, 'utf8')) || 0
  : 0;

const res = spawnSync('pnpm', ['check'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: TIMEOUT_MS,
});
if (res.status === 0) {
  rmSync(counterFile, { force: true });
  process.exit(0);
}
if (blocks >= MAX_BLOCKS) {
  rmSync(counterFile, { force: true });
  process.stderr.write(`pnpm check still red after ${MAX_BLOCKS} attempts; giving up.\n`);
  process.exit(0);
}
writeFileSync(counterFile, String(blocks + 1));
const reason = res.error ? `pnpm check did not finish: ${res.error.message}` : 'pnpm check is red.';
const tail = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split('\n').slice(-60).join('\n');
process.stderr.write(`${reason} Fix it before finishing (attempt ${blocks + 1}/${MAX_BLOCKS}).\n\n${tail}\n`);
process.exit(2);
