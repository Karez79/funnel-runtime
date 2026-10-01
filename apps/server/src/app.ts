// Composition root: wires repos -> services -> routes. The only module that sees all
// layers at once, so routes never reach the database directly (CLAUDE.md 3.1).
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Db } from './db/client.ts';
import type { Env } from './env.ts';
import { createHealthRepo } from './modules/health/repo.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { createHealthService } from './modules/health/service.ts';
import { basicAuth } from './plugins/auth.ts';
import type { App } from './plugins/route.ts';
import { webPlugin } from './plugins/web.ts';

export type AppEnv = Pick<
  Env,
  'adminUser' | 'adminPassword' | 'buildVersion' | 'logLevel' | 'webDist'
>;

export async function buildApp(env: AppEnv, db: Db): Promise<App> {
  const app = Fastify({
    logger: { level: env.logLevel },
    disableRequestLogging: env.logLevel === 'silent',
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

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

  await webPlugin(app, env.webDist);
  return app;
}
