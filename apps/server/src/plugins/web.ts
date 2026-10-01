// Serves the built web app from the same process and URL as the API (CLAUDE.md 2).
// Unknown /api paths get a JSON 404; every other unknown path gets index.html (SPA).
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { App } from './route.ts';

export async function webPlugin(app: App, webDist: string | undefined): Promise<void> {
  const hasWeb = webDist !== undefined && existsSync(`${webDist}/index.html`);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (!hasWeb || req.url.startsWith('/api/') || req.method !== 'GET') {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    return reply.sendFile('index.html');
  });
}
