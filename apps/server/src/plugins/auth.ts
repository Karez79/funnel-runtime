// Basic Auth for admin routes (CLAUDE.md 6). Credentials are compared in constant time.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sameSecret as same } from '../secrets.ts';
import { errorBody } from './errors.ts';

export function basicAuth(user: string, password: string) {
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
