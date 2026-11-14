/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Configuration for the devices / guestbook / counter API.
 *
 * Unlike the old backend (module-level constants read from process.env at
 * import time), these are functions that read `rt().env` lazily. That's
 * required on the Worker: env only exists once the DO is constructed, and
 * config is only ever needed while handling a request.
 */

import { rt } from "./runtime";

export function turnstileSecret(): string | undefined {
  const env = rt().env;
  return env.TURNSTILE_SECRET ?? env.TURNSILE_SECRET;
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

/** Site ids the visit counter (/v2/counter) will accept. Empty means open:
 *  any well-formed id auto-registers on its first hit, up to MAX_SITES. */
export function counterSiteIds(): string[] {
  return (rt().env.COUNTER_SITE_IDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
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
    "http://vibecoded.doughmination.gay",
    "https://vibecoded.doughmination.gay",
    "http://www.doughmination.gay",
    "https://www.doughmination.gay",
    "http://is.doughmination.gay",
    "https://is.doughmination.gay",
    "https://c.stupid.cat",
    "http://c.stupid.cat"
  ];
  const extra = (rt().env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...extra])];
}