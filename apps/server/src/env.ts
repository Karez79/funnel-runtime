// The only place that reads process.env (CLAUDE.md 3.1). Production refuses to start
// without real secrets; development and tests get harmless local defaults.
import { z } from 'zod';

const DEV_DEFAULTS = {
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'admin',
  GENERATOR_KEY: 'dev-generator-key',
} as const;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_PATH: z.string().default('./data/funnel.db'),
    // Relative to apps/server (the cwd of `pnpm start`); Docker sets an absolute path.
    WEB_DIST: z.string().default('../web/dist'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // `basic` (default) protects the admin with ADMIN_USER/ADMIN_PASSWORD; `off` opens it
    // to everyone, an explicit opt-in for the review deployment (docs/DECISIONS.md).
    ADMIN_AUTH: z.enum(['basic', 'off']).default('basic'),
    ADMIN_USER: z.string().min(1).optional(),
    ADMIN_PASSWORD: z.string().min(1).optional(),
    GENERATOR_KEY: z.string().min(1).optional(),
    // Requests per minute per client IP on public write routes (CLAUDE.md 6.0).
    RATE_LIMIT_SESSIONS: z.coerce.number().int().positive().default(30),
    // A funnel flushes its outbox every 2 s (CLAUDE.md 7.4): ~30 batches a minute per tab.
    RATE_LIMIT_EVENTS: z.coerce.number().int().positive().default(120),
    // Header the platform's edge sets to the client IP (Railway: X-Real-IP). Used only
    // for rate limits; X-Forwarded-For is never trusted because its left part is
    // whatever the client sent. Empty string turns it off (direct connections).
    CLIENT_IP_HEADER: z.string().optional(),
    BUILD_VERSION: z.string().optional(),
    RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  })
  .transform((raw, ctx) => {
    const secret = (key: keyof typeof DEV_DEFAULTS): string => {
      const value = raw[key];
      if (value !== undefined) return value;
      if (raw.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be set in production` });
      }
      return DEV_DEFAULTS[key];
    };
    return {
      nodeEnv: raw.NODE_ENV,
      host: raw.HOST,
      port: raw.PORT,
      databasePath: raw.DATABASE_PATH,
      webDist: raw.WEB_DIST,
      logLevel: raw.LOG_LEVEL,
      adminAuth:
        raw.ADMIN_AUTH === 'off'
          ? ({ mode: 'off' } as const)
          : ({
              mode: 'basic',
              user: secret('ADMIN_USER'),
              password: secret('ADMIN_PASSWORD'),
            } as const),
      generatorKey: secret('GENERATOR_KEY'),
      rateLimits: { sessions: raw.RATE_LIMIT_SESSIONS, events: raw.RATE_LIMIT_EVENTS },
      clientIpHeader:
        (
          raw.CLIENT_IP_HEADER ?? (raw.NODE_ENV === 'production' ? 'x-real-ip' : '')
        ).toLowerCase() || null,
      buildVersion: raw.BUILD_VERSION ?? raw.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    };
  });

export type Env = z.output<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  return EnvSchema.parse(source);
}
