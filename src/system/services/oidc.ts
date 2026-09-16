/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Doughmination SSO / OpenID Connect client.
 *
 * The API is a confidential OIDC client running Authorization Code + PKCE:
 *
 *   1. /auth/sso/login  — mint a `state` + PKCE verifier, stash them in the DO
 *      store, and 302 the browser to the SSO's authorization endpoint.
 *   2. The SSO authenticates the user and redirects back with `?code&state&iss`.
 *   3. /auth/sso/callback — validate `state` and `iss`, exchange the code for
 *      tokens over a direct TLS call to the token endpoint, then read the
 *      identity claims from the userinfo endpoint.
 *
 * Because the code exchange and userinfo call are server-to-server over TLS
 * with a client secret, their responses are trusted directly — we do not need
 * to separately verify the id_token's signature.
 *
 * The refresh token from step 3 is kept with the API session (see
 * sso_sessions.ts) and used to re-check the account with the SSO.
 */

import {
  ssoIssuer,
  ssoClientId,
  ssoClientSecret,
  ssoRedirectUri,
  ssoScopes,
  ssoPostLogoutRedirectUri,
  OIDC_STATE_TTL_MINUTES,
} from "../config";
import { randomUrlToken, sha256Base64Url } from "../security";
import { HttpError } from "../errors";
import { rt } from "../runtime";

/** The subset of the OIDC discovery document we use. */
interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

/** Identity claims we care about, normalized from the userinfo response. */
export interface OidcIdentity {
  /** Stable subject identifier — the primary key we link accounts on. */
  sub: string;
  /** The issuer that vouched for `sub`. */
  issuer: string;
  /** preferred_username claim; the account username we match/create on. */
  preferredUsername: string;
  email: string | null;
  displayName: string | null;
}

/** Tokens kept with the API session. */
export interface SsoTokens {
  refreshToken: string | null;
  idToken: string | null;
}

/** Cached discovery document (the DO is a singleton, so module scope persists
 *  across requests in the same isolate). Re-fetched after the TTL. */
let discoveryCache: { issuer: string; doc: OidcDiscovery; fetchedAt: number } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

function assertConfigured(): void {
  if (!ssoIssuer()) throw new HttpError(500, "SSO is not configured (SSO_ISSUER)");
  if (!ssoClientId()) throw new HttpError(500, "SSO is not configured (SSO_CLIENT_ID)");
  if (!ssoClientSecret()) throw new HttpError(500, "SSO is not configured (SSO_CLIENT_SECRET)");
}

/** Fetch (and cache) the issuer's OpenID configuration. */
export async function discover(): Promise<OidcDiscovery> {
  const issuer = ssoIssuer();
  const now = Date.now();
  if (
    discoveryCache &&
    discoveryCache.issuer === issuer &&
    now - discoveryCache.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.doc;
  }

  const url = `${issuer}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new HttpError(502, `Could not reach the SSO: ${String(err)}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `SSO discovery failed (${res.status})`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new HttpError(502, "SSO discovery document is missing required endpoints");
  }
  if (doc.issuer !== issuer) {
    throw new HttpError(502, `SSO issuer mismatch: configured ${issuer}, discovered ${doc.issuer}`);
  }
  discoveryCache = { issuer, doc, fetchedAt: now };
  return doc;
}

interface StoredState {
  verifier: string;
  from: string;
  createdAt: number;
}

function stateKey(state: string): string {
  return `oidc_state:${state}`;
}

/**
 * Build the authorization redirect URL and persist the matching PKCE verifier.
 * `from` is the app path to return the user to after login.
 */
export async function beginLogin(from: string): Promise<string> {
  assertConfigured();
  const doc = await discover();

  const state = randomUrlToken(32);
  const verifier = randomUrlToken(64);
  const challenge = await sha256Base64Url(verifier);

  await rt().store.put(stateKey(state), {
    verifier,
    from: from || "/",
    createdAt: Date.now(),
  } satisfies StoredState);

  const authUrl = new URL(doc.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", ssoClientId() as string);
  authUrl.searchParams.set("redirect_uri", ssoRedirectUri());
  authUrl.searchParams.set("scope", ssoScopes());
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  return authUrl.toString();
}

export interface CallbackResult {
  identity: OidcIdentity;
  tokens: SsoTokens;
  /** The original app path to return the user to. */
  from: string;
}

/** Thrown when the SSO definitively refuses a grant (as opposed to being unreachable). */
export class GrantRejectedError extends Error {}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const doc = await discover();
  const body = new URLSearchParams({
    ...params,
    client_id: ssoClientId() as string,
    client_secret: ssoClientSecret() as string,
  });

  let res: Response;
  try {
    res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
  } catch (err) {
    throw new HttpError(502, `SSO token request failed: ${String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let error = "";
    try {
      error = String((JSON.parse(detail) as { error?: string }).error ?? "");
    } catch {
      // not JSON
    }
    if (error === "invalid_grant") throw new GrantRejectedError(detail);
    throw new HttpError(res.status === 401 ? 502 : 401, `The SSO rejected the request (${res.status}). ${detail}`.trim());
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Complete the flow: validate state, exchange the code, and read identity
 * claims. Consumes the stored state (single use).
 */
export async function completeLogin(code: string, state: string, iss: string | undefined): Promise<CallbackResult> {
  assertConfigured();

  const key = stateKey(state);
  const stored = await rt().store.get<StoredState | null>(key, null);
  // Consume immediately so a replayed callback can't reuse it.
  await rt().store.delete(key);

  if (!stored) {
    throw new HttpError(400, "Login session expired or invalid. Please try again.");
  }
  if (Date.now() - stored.createdAt > OIDC_STATE_TTL_MINUTES * 60 * 1000) {
    throw new HttpError(400, "Login session expired. Please try again.");
  }

  const doc = await discover();
  // RFC 9207: when the SSO names itself on the callback it must be the one we
  // sent the user to, so a response from a different provider can't be mixed in.
  if (iss !== undefined && iss !== doc.issuer) {
    throw new HttpError(400, "Login response came from an unexpected issuer.");
  }

  // ---- Exchange the authorization code for tokens (direct TLS) -----------
  let tokens: Record<string, unknown>;
  try {
    tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: ssoRedirectUri(),
      code_verifier: stored.verifier,
    });
  } catch (err) {
    if (err instanceof GrantRejectedError) {
      throw new HttpError(401, "The SSO rejected the login. Please try again.");
    }
    throw err;
  }

  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
  if (!accessToken) {
    throw new HttpError(502, "The SSO did not return an access token");
  }

  // ---- Read identity claims from the userinfo endpoint -------------------
  let infoRes: Response;
  try {
    infoRes = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch (err) {
    throw new HttpError(502, `SSO userinfo request failed: ${String(err)}`);
  }
  if (!infoRes.ok) {
    throw new HttpError(502, `SSO userinfo request failed (${infoRes.status})`);
  }

  const claims = (await infoRes.json()) as Record<string, unknown>;
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) throw new HttpError(502, "The SSO did not return a subject identifier");

  const preferredUsername =
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    (typeof claims.nickname === "string" && claims.nickname) ||
    (typeof claims.name === "string" && claims.name) ||
    // Last resort: a deterministic username derived from the subject.
    `user_${sub.slice(0, 12)}`;

  const email = typeof claims.email === "string" ? claims.email : null;
  const displayName =
    (typeof claims.name === "string" && claims.name) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    null;

  return {
    identity: { sub, issuer: doc.issuer, preferredUsername, email, displayName },
    tokens: {
      refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
      idToken: typeof tokens.id_token === "string" ? tokens.id_token : null,
    },
    from: stored.from || "/",
  };
}

/**
 * Ask the SSO whether it still vouches for a session. Throws
 * GrantRejectedError when it doesn't (account disabled, removed from this
 * app's allowed groups, signed out everywhere); any other error means the SSO
 * couldn't be asked.
 */
export async function refreshTokens(refreshToken: string): Promise<SsoTokens> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return {
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    idToken: typeof tokens.id_token === "string" ? tokens.id_token : null,
  };
}

/** Best-effort RFC 7009 revocation of a session's refresh token. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const doc = await discover();
  if (!doc.revocation_endpoint) return;
  await fetch(doc.revocation_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
      client_id: ssoClientId() as string,
      client_secret: ssoClientSecret() as string,
    }),
  });
}

/** Where to send the browser so the SSO session ends too. */
export async function endSessionUrl(idToken: string | null): Promise<string | null> {
  const doc = await discover();
  if (!doc.end_session_endpoint) return null;
  const url = new URL(doc.end_session_endpoint);
  url.searchParams.set("post_logout_redirect_uri", ssoPostLogoutRedirectUri());
  url.searchParams.set("client_id", ssoClientId() as string);
  // With the id_token as proof, the SSO signs out without asking again.
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  return url.toString();
}
