// Credentials and URL of the e2e server, defined once for the config and every spec.
// E2E_PORT overrides the port so parallel worktrees on one machine do not collide.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_ADMIN = { username: 'e2e-admin', password: 'e2e-password' } as const;
export const E2E_GENERATOR_KEY = 'e2e-generator-key';
