// Serves the built web app from the same process and URL as the API (CLAUDE.md 2).
// Unknown /api paths get a JSON 404; every other unknown GET/HEAD gets index.html (SPA).
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { errorBody } from './errors.ts';
import type { App } from './route.ts';

export async function webPlugin(app: App, webDist: string | undefined): Promise<void> {
  const hasWeb = webDist !== undefined && existsSync(`${webDist}/index.html`);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    const isPage = req.method === 'GET' || req.method === 'HEAD';
    if (!hasWeb || !isPage || req.url.startsWith('/api/')) {
      return reply.code(404).send(errorBody('not_found', 'Not found'));
    }
    return reply.sendFile('index.html');
  });
}
