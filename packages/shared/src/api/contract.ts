// HTTP contract shared by server, web client and generator (CLAUDE.md 3.1).
// The server registers routes from these definitions; clients call them through
// the same definitions, so a path or a body shape lives in exactly one place.
import { z } from 'zod';

type Method = 'GET' | 'POST' | 'PUT';

export interface RouteDef {
  readonly method: Method;
  readonly path: string;
  readonly auth: 'public' | 'admin';
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response: z.ZodType;
}

const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  db: z.enum(['ok', 'error']),
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
