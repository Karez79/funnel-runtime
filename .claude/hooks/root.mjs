// Repository root for hooks. `cwd` in the hook input follows Claude's `cd`,
// so the root is taken from CLAUDE_PROJECT_DIR or git, never from cwd itself.
import { execFileSync } from 'node:child_process';

export function repoRoot(cwd) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return cwd;
  }
}
