// HTTP contract shared by server, web client and generator (CLAUDE.md 3.1).
// The server registers routes from these definitions; clients call them through
// the same definitions, so a path or a body shape lives in exactly one place.
// Success has exactly one status and schema per route; every failure is a
// DomainError rendered as the shared ErrorBody envelope (see errors.ts).
import { z } from 'zod';

type Method = 'GET' | 'POST' | 'PUT';

export interface RouteDef {
  readonly method: Method;
  readonly path: string;
  readonly auth: 'public' | 'admin';
  readonly status?: 200 | 201;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** Max request body in bytes; falls back to the server default. */
  readonly bodyLimit?: number;
  readonly response: z.ZodType;
}

const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const contract = {
  health: {
    method: 'GET',
    path: '/api/health',
    auth: 'public',
    response: HealthResponse,
  },
} as const satisfies Record<string, RouteDef>;
