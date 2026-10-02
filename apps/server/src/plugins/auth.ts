// Admin guard (CLAUDE.md 6): Basic Auth with constant-time comparison, or no guard at all
// when ADMIN_AUTH=off opens the admin for review (docs/DECISIONS.md). The switch lives in
// one place, so admin routes, the SSE stream and the /admin page change together.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../env.ts';
import { sameSecret as same } from '../secrets.ts';
import { errorBody } from './errors.ts';

function basicAuth(user: string, password: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString() : '';
    const sep = decoded.indexOf(':');
    const okUser = same(sep >= 0 ? decoded.slice(0, sep) : '', user);
    const okPassword = same(sep >= 0 ? decoded.slice(sep + 1) : '', password);
    if (okUser && okPassword) return;
    await reply
      .code(401)
      .header('www-authenticate', 'Basic realm="funnel-admin", charset="UTF-8"')
      .send(errorBody('unauthorized', 'Admin credentials required'));
  };
}

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const open: Guard = async () => {
  // Nothing to check: ADMIN_AUTH=off lets every request through.
};

export function adminGuard(auth: Env['adminAuth']): Guard {
  return auth.mode === 'off' ? open : basicAuth(auth.user, auth.password);
}
