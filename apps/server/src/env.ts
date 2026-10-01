// The only place that reads process.env (CLAUDE.md 3.1). Production refuses to start
// without real secrets; development and tests get harmless local defaults.
import { z } from 'zod';

const DEV_DEFAULTS = {
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'admin',
  GENERATOR_KEY: 'dev-generator-key',
} as const;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default('./data/funnel.db'),
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ADMIN_USER: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  GENERATOR_KEY: z.string().min(1).optional(),
  BUILD_VERSION: z.string().optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
});

export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databasePath: string;
  webDist: string | undefined;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  adminUser: string;
  adminPassword: string;
  generatorKey: string;
  buildVersion: string;
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const raw = EnvSchema.parse(source);
  const secret = (key: keyof typeof DEV_DEFAULTS): string => {
    const value = raw[key];
    if (value !== undefined) return value;
    if (raw.NODE_ENV === 'production') throw new Error(`${key} must be set in production`);
    return DEV_DEFAULTS[key];
  };
  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    databasePath: raw.DATABASE_PATH,
    webDist: raw.WEB_DIST,
    logLevel: raw.LOG_LEVEL,
    adminUser: secret('ADMIN_USER'),
    adminPassword: secret('ADMIN_PASSWORD'),
    generatorKey: secret('GENERATOR_KEY'),
    buildVersion: raw.BUILD_VERSION ?? raw.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  };
}
