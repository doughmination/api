/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Environment bindings + secrets consumed by the devices / guestbook / counter API.
 *
 * These are a subset of the Worker's full `Env` (see ../types.ts) — the
 * SystemState DO receives the same env object the Worker does. All auth
 * keys are set MANUALLY (secrets / vars).
 */
export interface SystemEnv {
  // ---- Durable Object bindings -------------------------------------------
  /** This DO, used for the singleton id. */
  SYSTEM: DurableObjectNamespace;
  /** The GatewayManager DO (Discord presence). SystemState is the single
   *  /v2/ws hub, so it pulls presence snapshots from here for INIT_STATE and
   *  receives live PRESENCE_UPDATE relays from it. */
  GATEWAY: DurableObjectNamespace;
  /** The system site Worker (doughmination.co.uk). Guestbook moderation
   *  checks admin tokens against it. */
  SITE: Fetcher;

  // ---- Secrets -------------------------------------------------------------
  /** Cloudflare Turnstile secret (public guestbook captcha). */
  TURNSTILE_SECRET?: string;
  /** Back-compat alias for the original (typo'd) env name. */
  TURNSILE_SECRET?: string;
  /** Comma-separated device battery-report keys (X-Battery-Key header). */
  BATTERY_API_KEYS?: string;
  /** Comma-separated guestbook moderation keys (X-Guestbook-Key header). */
  GUESTBOOK_ADMIN_KEYS?: string;

  // ---- Misc --------------------------------------------------------------
  /** Public base URL, used in a few absolute links. */
  BASE_URL?: string;
  /** Public URL of the frontend, used to build user-facing links. */
  FRONTEND_URL?: string;
  /** Comma-separated extra CORS origins (added to the built-in defaults). */
  CORS_ORIGINS?: string;
  /** Comma-separated site ids the /v2/counter endpoints will accept. Empty
   *  leaves the counter open, so any well-formed id registers on first hit. */
  COUNTER_SITE_IDS?: string;
}
