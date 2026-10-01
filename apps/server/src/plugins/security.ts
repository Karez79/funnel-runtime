// HTTP hardening (CLAUDE.md 6.0): a same-origin CSP (no external fonts, scripts or
// CDNs exist) and rate limiting. Rate limits are opt-in per route (`route(..., {
// rateLimit })`), so only the public write routes are limited, per client IP. The traffic generator
// proves itself with GENERATOR_KEY and is exempt: it legitimately creates hundreds of
// sessions from one address, and the key already lets it mark traffic as synthetic.
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { DomainError, GENERATOR_KEY_HEADER } from '@funnel/shared';
import { sameSecret } from '../secrets.ts';
import type { App } from './route.ts';

export async function securityPlugin(
  app: App,
  generatorKey: string,
  clientIpHeader: string | null,
): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, {
    global: false,
    // The edge's own client-IP header when configured (Railway documents X-Real-IP as the
    // client IP; that it overwrites a client-sent value is checked on prod, TIMELINE.md),
    // otherwise the socket address; never the client-supplied X-Forwarded-For.
    keyGenerator: (req) => {
      const header = clientIpHeader === null ? undefined : req.headers[clientIpHeader];
      return typeof header === 'string' && header !== '' ? header : req.ip;
    },
    allowList: (req) => {
      const key = req.headers[GENERATOR_KEY_HEADER];
      return typeof key === 'string' && sameSecret(key, generatorKey);
    },
    // Thrown, so plugins/errors.ts renders it in the shared envelope.
    errorResponseBuilder: (_req, ctx) =>
      new DomainError('rate_limited', `Too many requests, retry in ${ctx.after}`),
  });
}
