// Where a funnel session comes from (CLAUDE.md 8.1). The id lives in localStorage; the
// server holds the session and is the source of truth. A missing or expired session
// starts a new one, and `?variant=X` that differs from the stored session's variant
// starts a new QA session with that override: an override acts only when a session is
// created, so an assignment never changes under a running session (DECISIONS.md).
// UTM tags are read from the URL once, when the session is created.
// The state is mirrored in localStorage with the revision it was saved at: a step change
// the server has not acknowledged yet (offline, tab closed mid-save) survives a reload,
// and on a mismatch the larger revision wins (8.1).
import {
  contract,
  DomainError,
  SessionStateSchema,
  VARIANTS,
  type SessionResponse,
  type SessionState,
  type VariantKey,
} from '@funnel/shared';
import { z } from 'zod';
import { call } from '../../lib/api.ts';
import { readJson, remove, writeJson } from '../../lib/storage.ts';

export const DEFAULT_FUNNEL_ID = 'workstyle-planner';

const UtmSchema = contract.createSession.body.shape.utm.unwrap();
type Utm = z.input<typeof UtmSchema>;
/** `?utm_<key>=` for every key the contract accepts. */
const UTM_KEYS = UtmSchema.keyof().options;

const sessionKey = (funnelId: string) => `funnel:${funnelId}:session`;
const mirrorKey = (funnelId: string) => `funnel:${funnelId}:state`;

const MirrorSchema = z.object({
  sessionId: z.string(),
  state: SessionStateSchema,
  /** The server revision this state is based on. */
  stateRev: z.number().int().nonnegative(),
  /** The state has local changes the server has not acknowledged. */
  dirty: z.boolean(),
});
export type Mirror = z.infer<typeof MirrorSchema>;

export function readMirror(funnelId: string): Mirror | undefined {
  const parsed = MirrorSchema.safeParse(readJson(mirrorKey(funnelId)));
  return parsed.success ? parsed.data : undefined;
}

export function writeMirror(funnelId: string, mirror: Mirror): void {
  writeJson(mirrorKey(funnelId), mirror);
}

/** Drop local changes the server refused, so a reload starts from the server state. */
export function clearMirror(funnelId: string): void {
  remove(mirrorKey(funnelId));
}

/**
 * The state a loaded session starts from: local changes made on top of the server's
 * current revision win (they were never saved), anything else loses to the server.
 */
export function startingState(
  session: Pick<SessionResponse['session'], 'id' | 'state' | 'stateRev'>,
  mirror: Mirror | undefined,
): { state: SessionState; unsaved: boolean } {
  const local =
    mirror?.sessionId === session.id && mirror.dirty && mirror.stateRev === session.stateRev;
  return local ? { state: mirror.state, unsaved: true } : { state: session.state, unsaved: false };
}

export interface LoadedSession {
  readonly response: SessionResponse;
  /** The stored session had expired and a new one was started (410). */
  readonly expired: boolean;
}

function variantOverride(search: URLSearchParams): VariantKey | undefined {
  const value = search.get('variant');
  return VARIANTS.find((variant) => variant === value);
}

function utmFrom(search: URLSearchParams): Utm {
  const utm: Utm = {};
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
