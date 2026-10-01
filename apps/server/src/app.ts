// Composition root: wires repos -> services -> routes. The only module that sees all
// layers at once, so routes never reach the database directly (CLAUDE.md 3.1).
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { systemClock, type Clock } from './clock.ts';
import type { Db } from './db/client.ts';
import type { Env } from './env.ts';
import { createHealthRepo } from './modules/health/repo.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { createHealthService } from './modules/health/service.ts';
import { createVersionsRepo } from './modules/versions/repo.ts';
import { versionsRoutes } from './modules/versions/routes.ts';
import { createVersionsService } from './modules/versions/service.ts';
import { basicAuth } from './plugins/auth.ts';
import { errorsPlugin } from './plugins/errors.ts';
import type { App } from './plugins/route.ts';
import { webPlugin } from './plugins/web.ts';

export type AppEnv = Pick<
  Env,
  'adminUser' | 'adminPassword' | 'buildVersion' | 'logLevel' | 'webDist'
>;

export async function buildApp(env: AppEnv, db: Db, clock: Clock = systemClock): Promise<App> {
  const app = Fastify({
    logger: { level: env.logLevel },
    // Railway terminates TLS in front of us; client IPs (rate limits) come from the proxy.
    trustProxy: true,
    // The largest allowed body (an event batch, CLAUDE.md 6.0); routes may lower it.
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  errorsPlugin(app);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  });
  app.decorate('adminGuard', basicAuth(env.adminUser, env.adminPassword));

  healthRoutes(app, createHealthService(createHealthRepo(db), env.buildVersion));
  const versions = createVersionsService(createVersionsRepo(db), clock);
  versionsRoutes(app, versions);

  await webPlugin(app, env.webDist);
  return app;
}
