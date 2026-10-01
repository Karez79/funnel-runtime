// Stop hook: Claude may not finish a turn while `pnpm check` is red (CLAUDE.md 14).
// No-op until the workspace has a `check` script. Blocks up to MAX_BLOCKS times in a
// row per session (counter in tmpdir), then lets Claude stop so it cannot loop forever.
// Skips the run when the working tree is byte-identical to the last green run (a reply
// without code changes should not cost a full check).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

// Fingerprint of HEAD + tracked changes + untracked files (names and contents).
function treeFingerprint() {
  const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  const hash = createHash('sha256');
  const part = (chunk) => hash.update(chunk).update('\0');
  // Toolchain and install state: a broken node_modules or a new Node must re-run the check.
  part(process.version);
  const modules = join(root, 'node_modules/.modules.yaml');
  part(existsSync(modules) ? readFileSync(modules) : 'no-node_modules');
  part(git(['rev-parse', 'HEAD']));
  part(git(['diff', 'HEAD', '--binary']));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0');
  for (const file of untracked.filter(Boolean).sort()) {
    part(file);
    part(readFileSync(join(root, file)));
  }
  return hash.digest('hex');
}
const greenFile = join(
  tmpdir(),
  `funnel-stop-check-green-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`,
);
let fingerprint = '';
try {
  fingerprint = treeFingerprint();
} catch {
  // Not a git checkout or git failed: fall through to a full check.
}
if (fingerprint && existsSync(greenFile) && readFileSync(greenFile, 'utf8') === fingerprint) {
  process.exit(0);
}

const counterFile = join(tmpdir(), `funnel-stop-check-${input.session_id ?? 'default'}`);
const blocks =
  input.stop_hook_active && existsSync(counterFile)
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
  if (fingerprint) writeFileSync(greenFile, fingerprint);
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
process.stderr.write(
  `${reason} Fix it before finishing (attempt ${blocks + 1}/${MAX_BLOCKS}).\n\n${tail}\n`,
);
process.exit(2);
