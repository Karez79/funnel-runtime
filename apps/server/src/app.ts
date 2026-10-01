// Composition root: wires repos -> services -> routes. The only module that sees all
// layers at once, so routes never reach the database directly (CLAUDE.md 3.1).
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { systemClock, type Clock } from './clock.ts';
import type { Db } from './db/client.ts';
import type { Env } from './env.ts';
import { createHealthRepo } from './modules/health/repo.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRetentionRepo } from './modules/retention/repo.ts';
import { createRetentionService } from './modules/retention/service.ts';
import { createVersionsRepo } from './modules/versions/repo.ts';
import { versionsRoutes } from './modules/versions/routes.ts';
import { createVersionsService, type VersionsService } from './modules/versions/service.ts';
import { createSessionsRepo } from './modules/sessions/repo.ts';
import { sessionsRoutes } from './modules/sessions/routes.ts';
import { createSessionsService } from './modules/sessions/service.ts';
import { basicAuth } from './plugins/auth.ts';
import { errorsPlugin } from './plugins/errors.ts';
import type { App } from './plugins/route.ts';
import { securityPlugin } from './plugins/security.ts';
import { webPlugin } from './plugins/web.ts';

export type AppEnv = Pick<
  Env,
  | 'adminUser'
  | 'adminPassword'
  | 'generatorKey'
  | 'buildVersion'
  | 'logLevel'
  | 'rateLimits'
  | 'webDist'
  | 'clientIpHeader'
>;

const MINUTE_MS = 60_000;

/**
 * Services shared across modules. One instance per process: the versions service caches
 * the active version and invalidates it on its own writes (CLAUDE.md 6.1), so every
 * module, and a test that publishes a version, must go through the same instance.
 */
export interface SharedServices {
  versions: VersionsService;
}

export function createSharedServices(db: Db, clock: Clock = systemClock): SharedServices {
  return { versions: createVersionsService(createVersionsRepo(db), clock) };
}

/** `shared` is required so a second versions service with its own cache cannot slip in. */
export async function buildApp(
  env: AppEnv,
  db: Db,
  shared: SharedServices,
  clock: Clock = systemClock,
): Promise<App> {
  const app = Fastify({
    logger: { level: env.logLevel },
    // X-Forwarded-For is client-controlled on its left side; the client IP for rate
    // limits comes from the header the edge sets itself (env CLIENT_IP_HEADER).
    trustProxy: false,
    // The largest allowed body (an event batch, CLAUDE.md 6.0); routes may lower it.
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  errorsPlugin(app);

  await securityPlugin(app, env.generatorKey, env.clientIpHeader);
  app.decorate('adminGuard', basicAuth(env.adminUser, env.adminPassword));

  healthRoutes(app, createHealthService(createHealthRepo(db), env.buildVersion));
  const { versions } = shared;
  versionsRoutes(app, versions);
  sessionsRoutes(
    app,
    createSessionsService(createSessionsRepo(db), versions, clock, env.generatorKey),
    { rateLimit: { max: env.rateLimits.sessions, timeWindow: MINUTE_MS } },
  );

  const stopRetention = createRetentionService(createRetentionRepo(db), clock, app.log).start();
  app.addHook('onClose', (_instance, done) => {
    stopRetention();
    done();
  });

  await webPlugin(app, env.webDist);
  return app;
}
