// Typed domain errors and the single error envelope `{ error: { code, message } }`
// used by every API response (CLAUDE.md 3.1, 6). The server maps codes to HTTP
// statuses in one place (apps/server/src/plugins/errors.ts); clients switch on `code`.
import { z } from 'zod';

const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'gone',
  'payload_too_large',
  'unprocessable',
  'rate_limited',
  'internal',
  'unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

/**
 * The code a client reports for an error response without the JSON envelope (a proxy
 * page, a crash): the inverse of ERROR_STATUS, and `unavailable` for other 5xx.
 */
export function codeForStatus(status: number): ErrorCode {
  const known = ERROR_CODES.find((code) => ERROR_STATUS[code] === status);
  if (known) return known;
  return status >= 500 ? 'unavailable' : 'invalid_request';
}

export const ErrorBody = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}
