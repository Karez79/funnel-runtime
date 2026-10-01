// Basic Auth for admin routes (CLAUDE.md 6). Credentials are compared in constant time.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from './errors.ts';

// Hash first so both buffers have equal length and the comparison leaks nothing.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
const same = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

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
