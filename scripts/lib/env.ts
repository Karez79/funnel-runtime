// Secrets of the generator and verify, read from the environment in one place. Locally
// the server's development defaults apply (apps/server/src/env.ts), so `pnpm dev` +
// `pnpm generate` work without a .env; against prod the real values must be exported.
// A secret the server refuses ends the CLI with one line naming the variable to export,
// not with a stack trace.
import { DomainError } from '@funnel/shared';
import { z } from 'zod';

const CliEnvSchema = z.object({
  GENERATOR_KEY: z.string().min(1).default('dev-generator-key'),
  ADMIN_USER: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default('admin'),
});

export function cliEnv(source: Record<string, string | undefined>) {
  const env = CliEnvSchema.parse(source);
  return {
    generatorKey: env.GENERATOR_KEY,
    admin: { user: env.ADMIN_USER, password: env.ADMIN_PASSWORD },
  };
}

/** What to export when the server refused a secret; undefined for any other error. */
export function secretHint(error: unknown): string | undefined {
  if (!(error instanceof DomainError)) return undefined;
  if (error.code === 'unauthorized') {
    return `${error.message}. Export ADMIN_USER and ADMIN_PASSWORD with the server's values.`;
  }
  if (error.code === 'forbidden') {
    return `${error.message}. Export GENERATOR_KEY with the server's value.`;
  }
  return undefined;
}

/** Ends the CLI with the hint for a refused secret; rethrows anything else. */
export function exitOnRefusedSecret(error: unknown): never {
  const hint = secretHint(error);
  if (hint === undefined) throw error;
  process.stderr.write(`${hint}\n`);
  process.exit(1);
}
