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

export function adminPassword(): string | undefined {
  return rt().env.ADMIN_PASSWORD;
}

export function adminDisplayName(): string {
  return rt().env.ADMIN_DISPLAY_NAME ?? "Administrator";
}

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

// ---------------------------------------------------------------------------
// Email (Resend)
// ---------------------------------------------------------------------------

export function resendApiKey(): string | undefined {
  return rt().env.RESEND_API_KEY;
}

/** Resend API base. Overridable so a fork can point at a self-hosted relay,
 *  and so the flow can be exercised against a local mock in tests. */
export function resendApiBase(): string {
  return (rt().env.RESEND_API_BASE ?? "https://api.resend.com").replace(/\/+$/, "");
}

export function emailFrom(): string {
  return rt().env.EMAIL_FROM ?? "Doughmination System <no-reply@doughmination.win>";
}

/** Base URL of the password-reset page. The token is appended as ?token=. */
export function passwordResetUrl(): string {
  const configured = rt().env.PASSWORD_RESET_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `${frontendUrl()}/user/reset-password`;
}

/** How long a password-reset token stays valid. */
export const PASSWORD_RESET_TTL_MINUTES = 15;

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
    "https://c.stupid.cat",
    "http://c.stupid.cat"
  ];
  const extra = (rt().env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...extra])];
}