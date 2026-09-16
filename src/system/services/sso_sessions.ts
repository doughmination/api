/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * SSO-backed sessions.
 *
 * The JWT the API hands the frontend is stateless, so on its own an account
 * disabled on the SSO would keep working here until the token expired. Each
 * JWT therefore carries a session id (`sid`) that points at one of these
 * records, which holds the SSO refresh token from the login:
 *
 *   - every authenticated request looks the session up, so logout (or the
 *     session expiring) ends the JWT immediately;
 *   - every RECHECK_AFTER_MS the refresh token is spent at the SSO. The SSO
 *     refuses it once the account is disabled, taken out of this app's
 *     allowed groups, or signed out everywhere — and the session ends.
 *
 * The DO is a single instance, so an in-memory map is enough to make
 * concurrent requests on one session share a single refresh; the SSO rotates
 * refresh tokens and treats replays outside a short grace period as theft.
 */

import { randomUrlToken } from "../security";
import { rt } from "../runtime";
import { GrantRejectedError, refreshTokens, type SsoTokens } from "./oidc";

const RECHECK_AFTER_MS = 10 * 60 * 1000;
/** How long sessions survive while the SSO can't be reached. */
const OUTAGE_GRACE_MS = 60 * 60 * 1000;
/** Minimum gap between retries while the SSO is unreachable. */
const RETRY_AFTER_MS = 60 * 1000;

const INDEX_KEY = "sso_sessions_index";

export interface SsoSession {
  sid: string;
  userId: string;
  username: string;
  refreshToken: string | null;
  idToken: string | null;
  createdAt: number;
  verifiedAt: number;
  checkedAt: number;
  expiresAt: number;
}

interface IndexEntry {
  sid: string;
  expiresAt: number;
}

function sessionKey(sid: string): string {
  return `sso_session:${sid}`;
}

/** Drops index entries (and their sessions) that have expired. */
async function pruneExpired(index: IndexEntry[]): Promise<IndexEntry[]> {
  const now = Date.now();
  const live: IndexEntry[] = [];
  for (const entry of index) {
    if (entry.expiresAt > now) live.push(entry);
    else await rt().store.delete(sessionKey(entry.sid));
  }
  return live;
}

export async function createSsoSession(
  user: { id: string; username: string },
  tokens: SsoTokens,
  expiresAt: number,
): Promise<string> {
  const sid = randomUrlToken(24);
  const now = Date.now();
  const session: SsoSession = {
    sid,
    userId: user.id,
    username: user.username,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    createdAt: now,
    verifiedAt: now,
    checkedAt: now,
    expiresAt,
  };
  await rt().store.put(sessionKey(sid), session);

  const index = await pruneExpired(await rt().store.get<IndexEntry[]>(INDEX_KEY, []));
  index.push({ sid, expiresAt });
  await rt().store.put(INDEX_KEY, index);
  return sid;
}

async function readSession(sid: string): Promise<SsoSession | null> {
  const session = await rt().store.get<SsoSession | null>(sessionKey(sid), null);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    await rt().store.delete(sessionKey(sid));
    return null;
  }
  return session;
}

const inflight = new Map<string, Promise<SsoSession | null>>();

async function revalidate(session: SsoSession): Promise<SsoSession | null> {
  const now = Date.now();
  if (now - session.verifiedAt < RECHECK_AFTER_MS || !session.refreshToken) return session;

  const overdue = now - session.verifiedAt > RECHECK_AFTER_MS + OUTAGE_GRACE_MS;
  if (now - session.checkedAt < RETRY_AFTER_MS) {
    if (!overdue) return session;
    await rt().store.delete(sessionKey(session.sid));
    return null;
  }

  const pending = inflight.get(session.sid);
  if (pending) return pending;

  const task = (async (): Promise<SsoSession | null> => {
    try {
      const fresh = await refreshTokens(session.refreshToken!);
      const at = Date.now();
      const updated: SsoSession = {
        ...session,
        refreshToken: fresh.refreshToken ?? session.refreshToken,
        idToken: fresh.idToken ?? session.idToken,
        verifiedAt: at,
        checkedAt: at,
      };
      await rt().store.put(sessionKey(session.sid), updated);
      return updated;
    } catch (err) {
      if (err instanceof GrantRejectedError || overdue) {
        await rt().store.delete(sessionKey(session.sid));
        return null;
      }
      console.warn(`Could not reach the SSO to re-check a session: ${String(err)}`);
      const updated = { ...session, checkedAt: Date.now() };
      await rt().store.put(sessionKey(session.sid), updated);
      return updated;
    }
  })().finally(() => inflight.delete(session.sid));

  inflight.set(session.sid, task);
  return task;
}

/** The live session for `sid`, re-checked with the SSO when due. */
export async function currentSsoSession(sid: string): Promise<SsoSession | null> {
  const session = await readSession(sid);
  return session ? revalidate(session) : null;
}

/** Ends a session here and returns it, so the caller can end it at the SSO too. */
export async function endSsoSession(sid: string): Promise<SsoSession | null> {
  const session = await readSession(sid);
  await rt().store.delete(sessionKey(sid));
  return session;
}
