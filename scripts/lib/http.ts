// HTTP client of the generator and `verify` (CLAUDE.md 9.1): every call goes through a
// route of the shared contract, so the scripts test the real API with the same paths and
// schemas the server registers. Admin routes get Basic Auth; the generator key goes
// with every call (synthetic traffic, rate-limit exemption, the ground-truth upload). Each answer also carries the server's
// `Date` header: the ground truth's time window is taken from the server's clock, not
// from the machine that runs the generator.
import {
  codeForStatus,
  contract,
  DomainError,
  ErrorBody,
  GENERATOR_KEY_HEADER,
  type RouteDef,
} from '@funnel/shared';
import { z } from 'zod';

type Routes = typeof contract;
type Name = keyof Routes;
type Part<D, K extends string> = D extends { readonly [P in K]: infer S extends z.ZodType }
  ? z.input<S>
  : never;

export interface Request<N extends Name> {
  readonly params?: Part<Routes[N], 'params'>;
  readonly query?: Part<Routes[N], 'query'>;
  readonly body?: Part<Routes[N], 'body'>;
}

export interface Reply<N extends Name> {
  readonly data: z.output<Routes[N]['response']>;
  /** The server's clock when it answered (`Date` header, second precision). */
  readonly date: Date;
}

export interface ClientOptions {
  readonly baseUrl: string;
  readonly admin?: { readonly user: string; readonly password: string } | undefined;
  readonly generatorKey?: string | undefined;
}

export function createClient(options: ClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const basic =
    options.admin &&
    `Basic ${Buffer.from(`${options.admin.user}:${options.admin.password}`).toString('base64')}`;

  return async function call<N extends Name>(name: N, request: Request<N> = {}): Promise<Reply<N>> {
    const route: RouteDef = contract[name];
    const params: Record<string, unknown> = request.params ?? {};
    const url = new URL(
      base +
        route.path.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(String(params[key]))),
    );
    const query: Record<string, unknown> = request.query ?? {};
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = {};
    if (route.auth === 'admin' && basic) headers.authorization = basic;
    if (options.generatorKey) {
      headers[GENERATOR_KEY_HEADER] = options.generatorKey;
    }
    const hasBody = request.body !== undefined;
    if (hasBody) headers['content-type'] = 'application/json';
    const res = await fetch(url, {
      method: route.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const envelope = ErrorBody.safeParse(json);
      if (envelope.success) {
        const { code, message, details } = envelope.data.error;
        throw new DomainError(code, `${route.method} ${route.path}: ${message}`, details);
      }
      throw new DomainError(
        codeForStatus(res.status),
        `${route.method} ${route.path}: HTTP ${String(res.status)}`,
      );
    }
    const parsed = z.safeParse(route.response, json);
    if (!parsed.success) {
      throw new DomainError('internal', `${route.method} ${route.path}: unexpected response`);
    }
    const date = new Date(res.headers.get('date') ?? Date.now());
    // The value was parsed with this route's own response schema just above; only the
    // link between `name` and `contract[name]` is lost to TypeScript.
    return { data: parsed.data as Reply<N>['data'], date };
  };
}
export type Client = ReturnType<typeof createClient>;
