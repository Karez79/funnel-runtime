// Registers a route straight from its definition in @funnel/shared's contract, so
// paths, schemas, success status, body limits and auth are never restated on the
// server (CLAUDE.md 3.1). Handlers return the success body (type-checked against the
// contract) or throw a DomainError, which plugins/errors.ts renders.
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
import { z } from 'zod';

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

type Handler<D extends RouteDef> = (
  req: RouteRequest<D>,
  reply: FastifyReply,
) => z.input<D['response']> | Promise<z.input<D['response']>>;

declare module 'fastify' {
  interface FastifyInstance {
    adminGuard: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Fastify hands a missing body to the validator as `null`, but zod defaults (the
 * `.default({})` of the activation bodies) apply only to `undefined`.
 */
const absentAsUndefined = (schema: z.ZodType) =>
  z.preprocess((value) => (value === null ? undefined : value), schema);

/** Per-route options that are deployment settings rather than part of the contract. */
export interface RouteOptions {
  /** Requests per window per client (plugins/security.ts); omitted means unlimited. */
  rateLimit?: { max: number; timeWindow: number };
  /** Extra check before the body is parsed (after the admin guard); throws a DomainError. */
  precheck?: (req: FastifyRequest) => void;
}

// A throw inside the executor becomes the rejection, which the error plugin turns into HTTP.
const precheckHook =
  (check: (req: FastifyRequest) => void) =>
  (req: FastifyRequest): Promise<void> =>
    new Promise((resolve) => {
      check(req);
      resolve();
    });

export function route<D extends RouteDef>(
  app: App,
  def: D,
  handler: Handler<D>,
  options: RouteOptions = {},
): void {
  const status = def.status ?? 200;
  app.route({
    method: def.method,
    url: def.path,
    schema: {
      ...(def.params ? { params: def.params } : {}),
      ...(def.query ? { querystring: def.query } : {}),
      ...(def.body ? { body: absentAsUndefined(def.body) } : {}),
      response: { [status]: def.response },
    },
    ...(def.bodyLimit === undefined ? {} : { bodyLimit: def.bodyLimit }),
    ...(options.rateLimit ? { config: { rateLimit: options.rateLimit } } : {}),
    // onRequest runs before body parsing, so an anonymous caller gets 401, not 400, and a
    // caller failing the precheck gets its error, not a 400 for the body.
    onRequest: [
      ...(def.auth === 'admin' ? [app.adminGuard] : []),
      ...(options.precheck ? [precheckHook(options.precheck)] : []),
    ],
    handler: async (req, reply) => {
      // The zod validator has already parsed params/query/body against `def`, so the
      // request is narrowed to the inferred types here; this is the one place it happens.
      const body = await handler(req as RouteRequest<D>, reply);
      return reply.code(status).send(body);
    },
  });
}
