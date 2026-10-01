// Closed value lists stored in the database and sent over the API (CLAUDE.md 5, 6).
// The Drizzle schema builds its enums and CHECK constraints from these, and the contract
// builds its zod enums from them, so the database and the wire cannot drift apart.
export const VERSION_STATES = ['draft', 'published'] as const;
export const ACTIVATION_ACTIONS = ['publish', 'rollback', 'activate'] as const;
/** `override` comes from `?variant=` and marks the session as QA traffic (6.2). */
export const VARIANT_SOURCES = ['hash', 'override'] as const;
export const TRAFFIC_TYPES = ['live', 'qa', 'synthetic'] as const;
