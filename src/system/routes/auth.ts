/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Authentication — Doughmination SSO (OpenID Connect) only.
 *
 *   GET  /auth/sso/login     — redirect to the SSO to start the flow.
 *   GET  /auth/sso/callback  — the SSO redirects back here; we exchange the
 *                              code, link/create the account, open an SSO-backed
 *                              session, mint a JWT and hand the browser back to
 *                              the frontend with the token in the URL fragment.
 *   POST /auth/logout        — end the session here and at the SSO.
 *   POST /auth/app/token     — a native app swaps its one-time code and PKCE
 *                              verifier for the same JWT (see below).
 *
 * Native apps (the Plural Android app) start the same flow with
 * /auth/sso/login?app=<S256 PKCE challenge>. Their callback never carries the
 * JWT: it redirects to gay.doughmination.plural://auth?code=<one-time code>,
 * and the app redeems that code within a minute at /auth/app/token with the
 * verifier only it holds (services/app_codes.ts). Without `app` the flow is
 * exactly the website's, unchanged.
 *
 * /auth/pocketid/login and /auth/pocketid/callback remain as aliases: the
 * published @doughmination/react-api client still builds the old login URL.
 *
 * Everything downstream (the /user_info + /auth/is_* checks and every
 * requireAuth route) keeps using the same HS256 bearer token as before; it
 * now also carries the session id that requireAuth checks.
 */

import { Hono, type Context } from "hono";

import type { Env } from "../hono";
import { UserResponseSchema } from "../models";
import type { User } from "../models";
import { findOrCreateFromSso } from "../services/users";
import {
  beginLogin,
  completeLogin,
  endSessionUrl,
  isAppLogin,
  revokeRefreshToken,
} from "../services/oidc";
import { APP_CODE, PKCE_CHALLENGE, PKCE_VERIFIER, saveAppCode, takeAppCode } from "../services/app_codes";
import { createSsoSession, endSsoSession } from "../services/sso_sessions";
import { ssoPostLoginUrl, ssoLoginErrorUrl, ACCESS_TOKEN_EXPIRE_MINUTES } from "../config";
import { createAccessToken, decodeAccessToken } from "../security";
import { requireAuth } from "../middleware/auth";

export const authRoutes = new Hono<Env>();

function toUserResponseJson(user: User) {
  return UserResponseSchema.parse({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    is_admin: user.is_admin,
    is_owner: user.is_owner,
    is_pet: user.is_pet,
    avatar_url: user.avatar_url ?? null,
  });
}

/** A same-origin-ish app path, defended against open-redirect abuse: only a
 *  path beginning with a single "/" is accepted, never "//host", "/\host" or a
 *  full URL. */
function safeReturnPath(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/** Where an app-started login lands; the Plural Android app handles this scheme. */
const APP_REDIRECT = "gay.doughmination.plural://auth";

function loginError(c: Context<Env>, message: string, app = false) {
  const url = new URL(app ? APP_REDIRECT : ssoLoginErrorUrl());
  url.searchParams.set("error", message);
  return c.redirect(url.toString(), 302);
}

/** Start the SSO login: 302 to the provider's authorization endpoint. */
async function login(c: Context<Env>) {
  const from = safeReturnPath(c.req.query("from"));
  const app = c.req.query("app");
  if (app !== undefined && !PKCE_CHALLENGE.test(app)) {
    return c.json({ detail: "'app' must be an S256 PKCE challenge." }, 400);
  }
  const authUrl = await beginLogin(from, app);
  return c.redirect(authUrl, 302);
}

/** The SSO redirects the browser back here after the user authenticates. */
async function callback(c: Context<Env>) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  // Errors go back to whoever started the login: the app or the website.
  const app = await isAppLogin(state);

  const errorParam = c.req.query("error");
  if (errorParam === "access_denied") {
    return loginError(c, "Your SSO account isn't allowed to use this site.", app);
  }
  if (errorParam) return loginError(c, errorParam, app);

  if (!code || !state) return loginError(c, "missing_code", app);

  let result;
  try {
    result = await completeLogin(code, state, c.req.query("iss"));
  } catch (err) {
    return loginError(c, err instanceof Error ? err.message : "Login failed. Please try again.", app);
  }

  const { identity, tokens, from, appChallenge } = result;

  let user: User;
  try {
    user = await findOrCreateFromSso({
      sub: identity.sub,
      issuer: identity.issuer,
      username: identity.preferredUsername,
      email: identity.email,
      displayName: identity.displayName,
    });
  } catch (err) {
    return loginError(c, err instanceof Error ? err.message : "Could not sign you in.", app);
  }

  const expiresAt = Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000;
  const sid = await createSsoSession(user, tokens, expiresAt);

  const token = await createAccessToken({
    sub: user.username,
    id: user.id,
    sid,
    display_name: user.display_name,
    admin: user.is_admin,
    owner: user.is_owner,
    pet: user.is_pet,
    avatar_url: user.avatar_url ?? null,
  });

  // An app gets a one-time code, never the token: any app can claim a custom
  // scheme, but only the one holding the PKCE verifier can redeem the code.
  if (appChallenge) {
    const appCode = await saveAppCode(token, appChallenge);
    return c.redirect(`${APP_REDIRECT}?code=${encodeURIComponent(appCode)}`, 302);
  }

  // Token goes in the fragment so it never lands in a server access log or the
  // Referer header; the frontend callback page reads it from location.hash.
  const dest = new URL(ssoPostLoginUrl());
  dest.hash = `token=${encodeURIComponent(token)}&from=${encodeURIComponent(from)}`;
  return c.redirect(dest.toString(), 302);
}

authRoutes.get("/auth/sso/login", login);
authRoutes.get("/auth/sso/callback", callback);
authRoutes.get("/auth/pocketid/login", login);
authRoutes.get("/auth/pocketid/callback", callback);

/** A native app redeems its one-time code (and PKCE verifier) for the JWT. */
authRoutes.post("/auth/app/token", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; verifier?: unknown };
  const code = typeof body.code === "string" ? body.code : "";
  const verifier = typeof body.verifier === "string" ? body.verifier : "";
  if (!APP_CODE.test(code) || !PKCE_VERIFIER.test(verifier)) {
    return c.json({ detail: "Body must include 'code' and a PKCE 'verifier'." }, 422);
  }

  const token = await takeAppCode(code, verifier);
  c.header("Cache-Control", "no-store");
  if (!token) {
    return c.json({ detail: "That sign-in code is invalid or has expired. Please sign in again." }, 400);
  }
  return c.json({ access_token: token, token_type: "bearer" });
});

/**
 * End the caller's session. Accepts an expired or already-revoked token so a
 * stale tab can still sign out cleanly; returns the SSO URL the browser should
 * visit to end the SSO session as well.
 */
authRoutes.post("/auth/logout", async (c) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  let sid: string | null = null;
  if (token) {
    try {
      const payload = await decodeAccessToken(token, { allowExpired: true });
      sid = typeof payload.sid === "string" ? payload.sid : null;
    } catch {
      // unverifiable token: nothing of ours to end
    }
  }

  const session = sid ? await endSsoSession(sid) : null;
  if (session?.refreshToken) {
    await revokeRefreshToken(session.refreshToken).catch((err) =>
      console.warn(`SSO refresh token revocation failed: ${String(err)}`),
    );
  }

  let endSession: string | null = null;
  try {
    endSession = await endSessionUrl(session?.idToken ?? null);
  } catch {
    // SSO unreachable; the local session is gone regardless
  }
  return c.json({ ok: true, end_session_url: endSession });
});

authRoutes.get("/user_info", requireAuth, (c) => c.json(toUserResponseJson(c.get("user") as User)));

authRoutes.get("/auth/is_admin", requireAuth, (c) =>
  c.json({ isAdmin: c.get("user")?.is_admin ?? false }),
);
authRoutes.get("/auth/is_pet", requireAuth, (c) =>
  c.json({ isPet: c.get("user")?.is_pet ?? false }),
);
authRoutes.get("/auth/is_owner", requireAuth, (c) =>
  c.json({ isOwner: c.get("user")?.is_owner ?? false }),
);
