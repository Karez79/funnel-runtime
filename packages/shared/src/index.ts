// Public entry of @funnel/shared. Everything else in src/ is internal (CLAUDE.md 3.1).
export { contract } from './api/contract.ts';
export type { HealthResponse, RouteDef } from './api/contract.ts';
export { DomainError, ErrorBody } from './api/errors.ts';
export type { ErrorCode } from './api/errors.ts';
