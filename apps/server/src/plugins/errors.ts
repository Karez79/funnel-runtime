// The one place where failures become HTTP (CLAUDE.md 3.1): DomainError -> its status,
// framework errors (validation, bad JSON, body too large, rate limit) -> the shared
// envelope, anything else -> a generic 500 that never leaks internals.
import { DomainError, type ErrorBody, type ErrorCode } from '@funnel/shared';
import type { FastifyError } from 'fastify';
import type { App } from './route.ts';

const FRAMEWORK_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'invalid_request',
  404: 'not_found',
  413: 'payload_too_large',
  415: 'invalid_request',
  429: 'rate_limited',
};

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

export function errorsPlugin(app: App): void {
  app.setErrorHandler((err: FastifyError | DomainError, req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send(err.toBody());
    }
    const status = err.validation ? 400 : (err.statusCode ?? 500);
    const code = FRAMEWORK_CODES[status];
    if (code !== undefined) {
      return reply.code(status).send(errorBody(code, err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('internal', 'Internal server error'));
  });
}
