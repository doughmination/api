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
  return token ? { Authorization: token } : {};
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

export function adminPassword(): string | undefined {
  return rt().env.ADMIN_PASSWORD;
}

export function adminDisplayName(): string {
  return rt().env.ADMIN_DISPLAY_NAME ?? "Administrator";
}

export function baseUrl(): string {
  return (rt().env.BASE_URL ?? "https://doughmination.uk").replace(/\/+$/, "");
}

/** CORS allow-list: built-in defaults plus anything in CORS_ORIGINS. */
export function corsOrigins(): string[] {
  const defaults = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://doughmination.uk",
    "https://doughmination.uk",
    "http://doughmination.co.uk",
    "https://doughmination.co.uk",
    "https://c.stupid.cat",
    "http://c.stupid.cat"
  ];
  const extra = (rt().env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...extra])];
}
