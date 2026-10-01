// Typed HTTP client generated from the shared contract (CLAUDE.md 3.1): a route name picks
// the method, the path, the schemas of params, query and body and the response schema,
// so the web app never restates a path or a payload shape. Responses are parsed with the
// contract's zod schema; every failure is a DomainError with the server's code and
// details, so callers switch on `code` exactly like the server does. A network failure
// or a non-JSON error page (proxy, 502) becomes `unavailable` / the status's code.
// Basic Auth for admin routes is left to the browser (same-origin credentials).
import {
  codeForStatus,
  contract,
  DomainError,
  ErrorBody,
  type ErrorCode,
  type RouteDef,
} from '@funnel/shared';
import { z } from 'zod';

type Routes = typeof contract;
export type RouteName = keyof Routes;

type Part<R, K extends 'params' | 'query' | 'body'> = R extends {
  readonly [P in K]: infer S extends z.ZodType;
}
  ? // A part whose every key is optional (a query with defaults) may be left out.
    object extends z.input<S>
    ? { readonly [P in K]?: z.input<S> }
    : { readonly [P in K]: z.input<S> }
  : { readonly [P in K]?: never };

/** `params`, `query` and `body` exactly as the route declares them. */
export type CallInput<N extends RouteName> = Part<Routes[N], 'params'> &
  Part<Routes[N], 'query'> &
  Part<Routes[N], 'body'>;

export type CallOutput<N extends RouteName> = z.output<Routes[N]['response']>;

export interface CallOptions {
  readonly signal?: AbortSignal;
  /** Lets a request outlive the page (state saved on unload). */
  readonly keepalive?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function buildUrl(route: RouteDef, input: Record<string, unknown>): string {
  const params = isRecord(input.params) ? input.params : {};
  const path = route.path.replace(/:(\w+)/g, (_, key: string) =>
    encodeURIComponent(String(params[key])),
  );
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(isRecord(input.query) ? input.query : {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query.set(key, String(value));
    }
  }
  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

/** Parses with any contract schema; `undefined` when the data does not match. */
function parseWith<S extends z.ZodType>(
  schema: S,
  data: unknown,
): { value: z.output<S> } | undefined {
  const parsed = z.safeParse<S>(schema, data);
  return parsed.success ? { value: parsed.data } : undefined;
}

async function failure(res: Response): Promise<DomainError> {
  const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new DomainError(code, message, details);
  }
  return new DomainError(
    codeForStatus(res.status),
    `Request failed with status ${String(res.status)}`,
  );
}

export async function call<N extends RouteName>(
  name: N,
  input: CallInput<N>,
  options: CallOptions = {},
): Promise<CallOutput<N>> {
  const route: RouteDef = contract[name];
  const raw: Record<string, unknown> = input;
  const hasBody = route.body !== undefined && raw.body !== undefined;
  let res: Response;
  try {
    res = await fetch(buildUrl(route, raw), {
      method: route.method,
      credentials: 'same-origin',
      headers: hasBody ? { 'content-type': 'application/json' } : {},
      ...(hasBody ? { body: JSON.stringify(raw.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DomainError('unavailable', 'Network request failed');
  }
  if (!res.ok) throw await failure(res);
  const data = parseWith(contract[name].response, await res.json().catch(() => undefined));
  if (data === undefined) {
    throw new DomainError('internal', `Unexpected response from ${route.method} ${route.path}`);
  }
  // Narrowing after the check: the value was just parsed with this route's own schema;
  // TypeScript only loses the link because `contract[name]` widens to a union of routes.
  return data.value as CallOutput<N>;
}

type ErrorSchemas<N extends RouteName> = Routes[N] extends { readonly errorDetails: infer D }
  ? D
  : never;

/**
 * The typed `details` of a failure of route `name` with `code` (one of the codes the
 * contract declares details for, e.g. `errorDetails('saveState', 'conflict', error)`), or
 * `undefined` when the error is something else or its details do not match.
 */
export function errorDetails<N extends RouteName, C extends keyof ErrorSchemas<N> & ErrorCode>(
  name: N,
  code: C,
  error: unknown,
): (ErrorSchemas<N>[C] extends z.ZodType ? z.output<ErrorSchemas<N>[C]> : never) | undefined {
  if (!(error instanceof DomainError) || error.code !== code) return undefined;
  const route: RouteDef = contract[name];
  const schema = route.errorDetails?.[code];
  const parsed = schema && parseWith(schema, error.details);
  // Narrowing after the check: parsed with exactly this route's schema for `code`.
  return parsed?.value as
    (ErrorSchemas<N>[C] extends z.ZodType ? z.output<ErrorSchemas<N>[C]> : never) | undefined;
}
