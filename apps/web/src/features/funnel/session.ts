// Where a funnel session comes from (CLAUDE.md 8.1). The id lives in localStorage; the
// server holds the session and is the source of truth. A missing or expired session
// starts a new one, and `?variant=X` that differs from the stored session's variant
// starts a new QA session with that override: an override acts only when a session is
// created, so an assignment never changes under a running session (DECISIONS.md).
// UTM tags are read from the URL once, when the session is created.
import { DomainError, VARIANTS, type SessionResponse, type VariantKey } from '@funnel/shared';
import { call } from '../../lib/api.ts';
import { readJson, writeJson } from '../../lib/storage.ts';

export const DEFAULT_FUNNEL_ID = 'workstyle-planner';

const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;

const sessionKey = (funnelId: string) => `funnel:${funnelId}:session`;

export interface LoadedSession {
  readonly response: SessionResponse;
  /** The stored session had expired and a new one was started (410). */
  readonly expired: boolean;
}

function variantOverride(search: URLSearchParams): VariantKey | undefined {
  const value = search.get('variant');
  return VARIANTS.find((variant) => variant === value);
}

function utmFrom(search: URLSearchParams): Partial<Record<(typeof UTM_KEYS)[number], string>> {
  const utm: Partial<Record<(typeof UTM_KEYS)[number], string>> = {};
  for (const key of UTM_KEYS) {
    const value = search.get(`utm_${key}`);
    if (value) utm[key] = value;
  }
  return utm;
}

export async function loadSession(
  funnelId: string,
  search: URLSearchParams,
): Promise<LoadedSession> {
  const override = variantOverride(search);
  const storedId = readJson(sessionKey(funnelId));
  let expired = false;
  if (typeof storedId === 'string') {
    try {
      const response = await call('getSession', { params: { id: storedId } });
      if (override === undefined || response.session.variant === override) {
        return { response, expired };
      }
    } catch (error) {
      if (!(error instanceof DomainError) || !['not_found', 'gone'].includes(error.code)) {
        throw error;
      }
      expired = error.code === 'gone';
    }
  }
  const response = await call('createSession', {
    body: {
      funnelId,
      utm: utmFrom(search),
      ...(override === undefined ? {} : { variantOverride: override }),
    },
  });
  writeJson(sessionKey(funnelId), response.session.id);
  return { response, expired };
}
