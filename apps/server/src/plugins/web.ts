// Serves the built web app from the same process and URL as the API (CLAUDE.md 2).
// Unknown /api paths get a JSON 404; every other unknown GET/HEAD gets index.html (SPA),
// behind Basic Auth for /admin pages.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { errorBody } from './errors.ts';
import type { App } from './route.ts';

const ADMIN_PAGE = /^\/admin(?:[/?#]|$)/;

export async function webPlugin(app: App, webDist: string | undefined): Promise<void> {
  // @fastify/static needs an absolute root; WEB_DIST may be relative to the cwd.
  const root = webDist === undefined ? undefined : resolve(webDist);
  const hasWeb = root !== undefined && existsSync(`${root}/index.html`);
  if (hasWeb) {
    await app.register(fastifyStatic, { root, wildcard: false });
  }
  app.setNotFoundHandler(async (req, reply) => {
    const isPage = req.method === 'GET' || req.method === 'HEAD';
    if (!hasWeb || !isPage || req.url.startsWith('/api/')) {
      return reply.code(404).send(errorBody('not_found', 'Not found'));
    }
    // Admin pages ask for Basic Auth themselves: the browser prompts once on the page and
    // then sends the credentials with every admin API call from it.
    if (ADMIN_PAGE.test(req.url)) {
      await app.adminGuard(req, reply);
      if (reply.sent) return reply;
    }
    return reply.sendFile('index.html');
  });
}
