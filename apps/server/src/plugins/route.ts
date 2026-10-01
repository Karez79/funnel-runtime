// Registers a route straight from its definition in @funnel/shared's contract, so
// paths, schemas and auth are never restated on the server (CLAUDE.md 3.1).
import type { RouteDef } from '@funnel/shared';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawServerDefault,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';

export type App = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;

type RouteRequest<D extends RouteDef> = FastifyRequest<{
  Params: Infer<D['params']>;
  Querystring: Infer<D['query']>;
  Body: Infer<D['body']>;
}>;

type Handler<D extends RouteDef> = (req: RouteRequest<D>, reply: FastifyReply) => unknown;

declare module 'fastify' {
  interface FastifyInstance {
    adminGuard: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function route<D extends RouteDef>(app: App, def: D, handler: Handler<D>): void {
  app.route({
    method: def.method,
    url: def.path,
    schema: {
      ...(def.params ? { params: def.params } : {}),
      ...(def.query ? { querystring: def.query } : {}),
      ...(def.body ? { body: def.body } : {}),
      response: { 200: def.response },
    },
    ...(def.auth === 'admin' ? { preHandler: app.adminGuard } : {}),
    // The zod validator has already parsed params/query/body against `def`, so the
    // request is narrowed to the inferred types here; this is the one place it happens.
    handler: (req, reply) => handler(req as RouteRequest<D>, reply),
  });
}
