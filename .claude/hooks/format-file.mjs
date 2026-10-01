// PostToolUse hook: format and lint-fix the file Claude just edited.
// Never blocks: remaining lint errors are caught by the Stop hook (`pnpm check`).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { repoRoot } from './root.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
const root = repoRoot(input.cwd ?? process.cwd());
const bin = (name) => `${root}/node_modules/.bin/${name}`;
if (!file || !existsSync(file) || !existsSync(bin('prettier'))) process.exit(0);
if (file.includes('/node_modules/') || file.includes('/drizzle/')) process.exit(0);

const run = (name, args) => {
  try {
    execFileSync(bin(name), args, { cwd: root, stdio: 'ignore' });
  } catch {
    // Unfixable problems are reported by `pnpm check`.
  }
};
if (/\.(ts|tsx|js|mjs|cjs|json|css|md|yml|yaml|html)$/.test(file)) {
  run('prettier', ['--write', '--ignore-unknown', file]);
}
if (/\.(ts|tsx)$/.test(file) && existsSync(`${root}/eslint.config.js`)) {
  run('eslint', ['--fix', file]);
}
