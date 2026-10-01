// TanStack Query options for a contract route: the key is the route name plus its input,
// so every feature that reads the same route shares one cache entry, and a mutation can
// invalidate a route by name without knowing who reads it (CLAUDE.md 3.1: server state
// only through TanStack Query).
import { queryOptions } from '@tanstack/react-query';
import { call, type CallInput, type RouteName } from './api.ts';

export function apiQuery<N extends RouteName>(name: N, input: CallInput<N>) {
  return queryOptions({
    queryKey: [name, input] as const,
    queryFn: ({ signal }) => call(name, input, { signal }),
  });
}
