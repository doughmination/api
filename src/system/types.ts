/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Environment bindings + secrets consumed by the Doughmination system API.
 *
 * These are a subset of the Worker's full `Env` (see ../types.ts) — the
 * SystemState DO receives the same env object the Worker does. All auth
 * keys are now set MANUALLY (secrets / vars); nothing is generated on
 * first run any more.
 */
export interface SystemEnv {
  // ---- Durable Object bindings -------------------------------------------
  /** This DO, used for the singleton id. */
  SYSTEM: DurableObjectNamespace;
  /** The GatewayManager DO (Discord presence). SystemState is the single
   *  /v2/ws hub, so it pulls presence snapshots from here for INIT_STATE and
   *  receives live PRESENCE_UPDATE relays from it. */
  GATEWAY: DurableObjectNamespace;

  // ---- PluralKit ---------------------------------------------------------
  /** PluralKit system token (Authorization header for api.pluralkit.me). */
  SYSTEM_TOKEN?: string;
  /** Seconds to cache PluralKit responses in-memory. Default 30. */
  CACHE_TTL?: string;

  // ---- Auth --------------------------------------------------------------
  /** HMAC secret for signing JWTs. REQUIRED in production. */
  JWT_SECRET?: string;
  /** Cloudflare Turnstile secret (login/signup captcha). */
  TURNSTILE_SECRET?: string;
  /** Back-compat alias for the original (typo'd) env name. */
  TURNSILE_SECRET?: string;

  // ---- Initial owner seed (only used when no users exist yet) ------------
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_DISPLAY_NAME?: string;

  // ---- Manual API keys (replaces generate-on-first-run) ------------------
  /** Static bearer token the Discord bot uses for /api/bot/*. */
  DOUGH_BOT_TOKEN?: string;
  /** Comma-separated device battery-report keys (X-Battery-Key header). */
  BATTERY_API_KEYS?: string;

  // ---- Misc --------------------------------------------------------------
  /** Public base URL, used in a few absolute links. */
  BASE_URL?: string;
  /** Comma-separated extra CORS origins (added to the built-in defaults). */
  CORS_ORIGINS?: string;
}

/** A member object from PluralKit is large and loosely typed upstream. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PKObject = Record<string, any>;
