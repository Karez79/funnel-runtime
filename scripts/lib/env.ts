// Secrets of the generator and verify, read from the environment in one place. Locally
// the server's development defaults apply (apps/server/src/env.ts), so `pnpm dev` +
// `pnpm generate` work without a .env; against prod the real values must be exported.
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
