/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Configuration for the Doughmination system API.
 *
 * Unlike the old backend (module-level constants read from process.env at
 * import time), these are functions that read `rt().env` lazily. That's
 * required on the Worker: env only exists once the DO is constructed, and
 * config is only ever needed while handling a request.
 */

import { rt } from "./runtime";

// PluralKit
export const PLURALKIT_BASE_URL = "https://api.pluralkit.me/v2";
export const JWT_ALGORITHM = "HS256" as const;
export const ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24; // 24 hours

export function systemToken(): string | undefined {
  return rt().env.SYSTEM_TOKEN;
}

export function pluralkitHeaders(): Record<string, string> {
  const token = systemToken();
  return {
    "User-Agent": "doughmination-api/2.0 (+https://doughmination.uk)",
    ...(token ? { Authorization: token } : {}),
  };
}

export function cacheTtl(): number {
  return Number(rt().env.CACHE_TTL ?? 30);
}

export function jwtSecret(): string {
  return rt().env.JWT_SECRET ?? "your-secret-key-for-jwt";
}

export function turnstileSecret(): string | undefined {
  const env = rt().env;
  return env.TURNSTILE_SECRET ?? env.TURNSILE_SECRET;
}

export function adminUsername(): string {
  return rt().env.ADMIN_USERNAME ?? "admin";
}

export function adminDisplayName(): string {
  return rt().env.ADMIN_DISPLAY_NAME ?? "Administrator";
}

// ---------------------------------------------------------------------------
// PocketID (OpenID Connect) — the ONLY login method.
//
// The API is a confidential OIDC client: it runs the Authorization Code +
// PKCE flow against a PocketID instance, then mints its own JWT (see
// security.ts) so every existing `requireAuth` route keeps working unchanged.
// ---------------------------------------------------------------------------

/** PocketID issuer origin, e.g. https://doughmination.xyz. No trailing slash.
 *  `${issuer}/.well-known/openid-configuration` must resolve. */
export function pocketIdIssuer(): string {
  return (rt().env.POCKETID_ISSUER ?? "").replace(/\/+$/, "");
}

/** OIDC client id issued by PocketID for this application. */
export function pocketIdClientId(): string | undefined {
  return rt().env.POCKETID_CLIENT_ID;
}

/** OIDC client secret. Set via `wrangler secret put POCKETID_CLIENT_SECRET`. */
export function pocketIdClientSecret(): string | undefined {
  return rt().env.POCKETID_CLIENT_SECRET;
}

/** The redirect URI registered with PocketID. Must point back at the API's
 *  callback route. Defaults to `${baseUrl}/v2/plural/auth/pocketid/callback`. */
export function pocketIdRedirectUri(): string {
  const configured = rt().env.POCKETID_REDIRECT_URI;
  if (configured) return configured;
  return `${baseUrl()}/v2/plural/auth/pocketid/callback`;
}

/** Space-separated OIDC scopes. `openid` is mandatory; `profile` gives us
 *  preferred_username + name, `email` gives the address. */
export function pocketIdScopes(): string {
  return rt().env.POCKETID_SCOPES ?? "openid profile email";
}

/** Where the callback sends the browser once a JWT has been minted. The token
 *  is appended in the URL fragment (`#token=…`) so it never hits a server log.
 *  Defaults to the frontend's PocketID landing page. */
export function pocketIdPostLoginUrl(): string {
  const configured = rt().env.POCKETID_POST_LOGIN_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `${frontendUrl()}/user/login/callback`;
}

/** Where the browser is sent when login fails or is cancelled. */
export function pocketIdLoginErrorUrl(): string {
  return `${frontendUrl()}/user/login`;
}

/** How long an in-flight authorization request (state + PKCE verifier) stays
 *  valid between /login and /callback. */
export const OIDC_STATE_TTL_MINUTES = 10;

/** Owner's email. Backfilled onto the owner account on read, so an owner
 *  created before emails existed still gets one without a manual edit. */
export function adminEmail(): string | undefined {
  const value = rt().env.ADMIN_EMAIL?.trim().toLowerCase();
  return value || undefined;
}

export function baseUrl(): string {
  return (rt().env.BASE_URL ?? "https://doughmination.uk").replace(/\/+$/, "");
}

/** Public URL of the frontend (where reset links land). */
export function frontendUrl(): string {
  return (rt().env.FRONTEND_URL ?? baseUrl()).replace(/\/+$/, "");
}

/** Any localhost origin, on any port and either scheme — local dev servers
 *  (Vite :5173, Next :3000, wrangler :8787, …) are always allowed. */
export function isLocalhostOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

/** CORS allow-list: built-in defaults plus anything in CORS_ORIGINS.
 *  Localhost origins are additionally allowed via isLocalhostOrigin(). */
export function corsOrigins(): string[] {
  const defaults = [
    "http://doughmination.uk",
    "https://doughmination.uk",
    "http://doughmination.co.uk",
    "https://doughmination.co.uk",
    "http://doughmination.gay",
    "https://doughmination.gay",
    "http://www.doughmination.gay",
    "https://www.doughmination.gay",
    "https://c.stupid.cat",
    "http://c.stupid.cat"
  ];
  const extra = (rt().env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...extra])];
}