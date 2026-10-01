import { rmSync } from 'node:fs';

export default function globalTeardown(): void {
  const dir = process.env.FUNNEL_E2E_DB_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
}
