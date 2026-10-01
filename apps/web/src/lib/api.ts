// Typed HTTP client generated from the shared contract (CLAUDE.md 3.1): a route name picks
// the method, the path, the schemas of params, query and body and the response schema,
// so the web app never restates a path or a payload shape. Responses are parsed with the
// contract's zod schema; every failure is a DomainError with the server's code and
// details, so callers switch on `code` exactly like the server does. A network failure
// or a non-JSON error page (proxy, 502) becomes `unavailable` / the status's code.
// Basic Auth for admin routes is left to the browser (same-origin credentials).
import { contract, DomainError, ErrorBody, type ErrorCode, type RouteDef } from '@funnel/shared';
import { z } from 'zod';

type Routes = typeof contract;
export type RouteName = keyof Routes;

type Part<R, K extends 'params' | 'query' | 'body'> = R extends {
  readonly [P in K]: infer S extends z.ZodType;
}
  ? K extends 'query'
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

/** Codes for error responses that carry no JSON envelope (a proxy page, a crash). */
const STATUS_CODES: Readonly<Record<number, ErrorCode>> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  413: 'payload_too_large',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal',
};

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
  const code = STATUS_CODES[res.status] ?? (res.status >= 500 ? 'unavailable' : 'invalid_request');
  return new DomainError(code, `Request failed with status ${String(res.status)}`);
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

/**
 * The typed `details` of a failure with `code`, parsed with the route's schema from the
 * contract (e.g. `contract.saveState.errorDetails.conflict`), or `undefined` when the
 * error is something else or its details do not match.
 */
export function errorDetails<S extends z.ZodType>(
  schema: S,
  error: unknown,
  code: ErrorCode,
): z.output<S> | undefined {
  if (!(error instanceof DomainError) || error.code !== code) return undefined;
  return parseWith(schema, error.details)?.value;
}
