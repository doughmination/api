/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * PocketID / OpenID Connect client.
 *
 * The API is a confidential OIDC client running Authorization Code + PKCE:
 *
 *   1. /auth/pocketid/login  — mint a `state` + PKCE verifier, stash them in
 *      the DO store, and 302 the browser to PocketID's authorization endpoint.
 *   2. PocketID authenticates the user and redirects back with `?code&state`.
 *   3. /auth/pocketid/callback — validate `state`, exchange the code for tokens
 *      over a direct TLS call to the token endpoint, then read the identity
 *      claims from the userinfo endpoint.
 *
 * Because the code exchange and userinfo call are server-to-server over TLS
 * with a client secret, their responses are trusted directly — we do not need
 * to separately verify the id_token's RS256 signature.
 */

import {
  pocketIdIssuer,
  pocketIdClientId,
  pocketIdClientSecret,
  pocketIdRedirectUri,
  pocketIdScopes,
  OIDC_STATE_TTL_MINUTES,
} from "../config";
import { randomUrlToken, sha256Base64Url } from "../security";
import { HttpError } from "../errors";
import { rt } from "../runtime";

/** The subset of the OIDC discovery document we use. */
interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
}

/** Identity claims we care about, normalized from the userinfo response. */
export interface OidcIdentity {
  /** Stable subject identifier — the primary key we link accounts on. */
  sub: string;
  /** preferred_username claim; the account username we match/create on. */
  preferredUsername: string;
  email: string | null;
  displayName: string | null;
}

/** Cached discovery document (the DO is a singleton, so module scope persists
 *  across requests in the same isolate). Re-fetched after the TTL. */
let discoveryCache: { issuer: string; doc: OidcDiscovery; fetchedAt: number } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

function assertConfigured(): void {
  if (!pocketIdIssuer()) throw new HttpError(500, "PocketID is not configured (POCKETID_ISSUER)");
  if (!pocketIdClientId()) throw new HttpError(500, "PocketID is not configured (POCKETID_CLIENT_ID)");
  if (!pocketIdClientSecret()) {
    throw new HttpError(500, "PocketID is not configured (POCKETID_CLIENT_SECRET)");
  }
}

/** Fetch (and cache) the issuer's OpenID configuration. */
export async function discover(): Promise<OidcDiscovery> {
  const issuer = pocketIdIssuer();
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
    throw new HttpError(502, `Could not reach PocketID: ${String(err)}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `PocketID discovery failed (${res.status})`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new HttpError(502, "PocketID discovery document is missing required endpoints");
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
  authUrl.searchParams.set("client_id", pocketIdClientId() as string);
  authUrl.searchParams.set("redirect_uri", pocketIdRedirectUri());
  authUrl.searchParams.set("scope", pocketIdScopes());
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  return authUrl.toString();
}

export interface CallbackResult {
  identity: OidcIdentity;
  /** The original app path to return the user to. */
  from: string;
}

/**
 * Complete the flow: validate state, exchange the code, and read identity
 * claims. Consumes the stored state (single use).
 */
export async function completeLogin(code: string, state: string): Promise<CallbackResult> {
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

  // ---- Exchange the authorization code for tokens (direct TLS) -----------
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pocketIdRedirectUri(),
    client_id: pocketIdClientId() as string,
    client_secret: pocketIdClientSecret() as string,
    code_verifier: stored.verifier,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
  } catch (err) {
    throw new HttpError(502, `PocketID token exchange failed: ${String(err)}`);
  }
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    throw new HttpError(401, `PocketID rejected the login (${tokenRes.status}). ${detail}`.trim());
  }

  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new HttpError(502, "PocketID did not return an access token");
  }

  // ---- Read identity claims from the userinfo endpoint -------------------
  let infoRes: Response;
  try {
    infoRes = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
    });
  } catch (err) {
    throw new HttpError(502, `PocketID userinfo request failed: ${String(err)}`);
  }
  if (!infoRes.ok) {
    throw new HttpError(502, `PocketID userinfo request failed (${infoRes.status})`);
  }

  const claims = (await infoRes.json()) as Record<string, unknown>;
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) throw new HttpError(502, "PocketID did not return a subject identifier");

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
    identity: { sub, preferredUsername, email, displayName },
    from: stored.from || "/",
  };
}
