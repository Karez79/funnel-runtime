// Stop hook: Claude may not finish a turn while `pnpm check` is red (CLAUDE.md 14).
// No-op until the workspace has a `check` script; never re-blocks a continuation
// that was itself caused by this hook (stop_hook_active), so it cannot loop.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
if (input.stop_hook_active) process.exit(0);
const root = input.cwd ?? process.cwd();
const pkgPath = `${root}/package.json`;
if (!existsSync(pkgPath)) process.exit(0);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts?.check) process.exit(0);

const res = spawnSync('pnpm', ['check'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (res.status === 0) process.exit(0);
const tail = `${res.stdout}\n${res.stderr}`.split('\n').slice(-60).join('\n');
process.stderr.write(`pnpm check is red. Fix it before finishing.\n\n${tail}\n`);
process.exit(2);
