/* =====================================================================
 * discord/rest.ts — thin Discord REST client.
 *
 * Two callers:
 *   fetchBotUser()   — bot token, /users/:id        (basic, always safe)
 *   fetchUserProfile() — user token, /users/:id/profile (rich, ToS risk)
 * ===================================================================== */

import type { Env } from "../types";

function apiBase(env: Env): string {
  const v = env.DISCORD_API_VERSION || "10";
  return `https://discord.com/api/v${v}`;
}

// ---- client fingerprint -------------------------------------------------
// Discord applies MUCH gentler rate limits to requests that look like its real
// client. Bare API calls to /profile get throttled hard; the same calls with a
// proper User-Agent + X-Super-Properties (base64 client-info) get the client's
// treatment. Keep BROWSER_UA + the build number reasonably current — Discord
// trusts up-to-date clients more. Build number is overridable via
// DISCORD_CLIENT_BUILD_NUMBER so you can bump it without a code change.
// Matched to a real Firefox web client (stable channel). Keep these in sync with
// an actual client's X-Super-Properties — re-grab and bump when they drift.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0";

// A real web client also sends these per-"launch" identifiers. Discord doesn't
// appear to validate them (Dustin runs static ones fine for months), so we mint
// one set per worker start and reuse it — i.e. behave like a single client launch.
let launchIdentity: {
  client_launch_id: string;
  launch_signature: string;
  client_heartbeat_session_id: string;
} | null = null;

function getLaunchIdentity() {
  if (!launchIdentity) {
    launchIdentity = {
      client_launch_id: crypto.randomUUID(),
      launch_signature: crypto.randomUUID(),
      client_heartbeat_session_id: crypto.randomUUID(),
    };
  }
  return launchIdentity;
}

function superProperties(env: Env): string {
  const build = Number(env.DISCORD_CLIENT_BUILD_NUMBER || "565311");
  // Field set matched to a real Firefox WEB client. Do NOT add desktop-only
  // fields (native_build_number, os_arch, X-Installation-ID, …) — a "Firefox"
  // client that claims those is inconsistent and reads as MORE suspicious.
  const props = {
    os: "Windows",
    browser: "Firefox",
    device: "",
    system_locale: "en-GB",
    has_client_mods: false,
    browser_user_agent: BROWSER_UA,
    browser_version: "152.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: build,
    client_event_source: null,
    ...getLaunchIdentity(),
    client_app_state: "focused",
  };
  return btoa(JSON.stringify(props));
}

/** Headers that make a user-token request look like the official web client. */
function clientHeaders(env: Env, token: string): Record<string, string> {
  return {
    Authorization: token,
    "User-Agent": BROWSER_UA,
    "X-Super-Properties": superProperties(env),
    "X-Discord-Locale": "en-GB",
    "X-Discord-Timezone": "Europe/London",
    "X-Debug-Options": "bugReporterEnabled",
    Accept: "*/*",
    "Accept-Language": "en-GB,en;q=0.9",
    Origin: "https://discord.com",
    Referer: "https://discord.com/channels/@me",
  };
}

export interface RawDiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  display_name?: string | null;
  avatar: string | null;
  banner?: string | null;
  accent_color?: number | null;
  public_flags?: number;
  flags?: number;
  avatar_decoration_data?: { asset: string; sku_id?: string | null } | null;
  primary_guild?: {
    identity_guild_id?: string | null;
    identity_enabled?: boolean | null;
    tag?: string | null;
    badge?: string | null;
  } | null;
  collectibles?: Record<string, unknown> | null;
  discriminator?: string;
  display_name_styles?: {
    colors?: number[] | null;
    font_id?: number | null;
    effect_id?: number | null;
  } | null;
}

export interface RawProfileBadge {
  id: string;
  description: string;
  icon: string;
  link?: string;
}

export interface RawProfileResponse {
  user?: RawDiscordUser & { bio?: string };
  user_profile?: {
    bio?: string;
    pronouns?: string;
    accent_color?: number | null;
    theme_colors?: number[] | null;
  };
  badges?: RawProfileBadge[];
  connected_accounts?: Array<{ type: string; id: string; name: string; verified: boolean }>;
  premium_type?: number;
  premium_since?: string | null;
  premium_guild_since?: string | null;
  /** Profile wishlist: map of WISHLIST id -> per-wishlist settings. The items
   *  themselves are NOT here — fetch them with fetchWishlist(wishlistId). */
  wishlist_settings?: Record<string, { visibility?: number; updated_at?: string }>;
}

/** Basic user via bot token. Returns null on 404 / failure. */
export async function fetchBotUser(env: Env, id: string): Promise<RawDiscordUser | null> {
  const res = await fetch(`${apiBase(env)}/users/${id}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawDiscordUser;
}

export interface UserProfileFetch {
  data: RawProfileResponse | null;
  /** HTTP status (0 = not attempted / no token). */
  status: number;
  /** Seconds from a 429 Retry-After header, when present. */
  retryAfter: number;
}

/** Configured user tokens (1 or 2), in order, skipping blanks. */
function userTokens(env: Env): string[] {
  return [env.DISCORD_USER_TOKEN, env.DISCORD_USER_TOKEN2].filter(
    (t): t is string => !!t && t.trim().length > 0
  );
}

/**
 * Rich profile via USER token(s) (self-bot — ToS risk). If two tokens are
 * configured, load is spread across them (random start) and a 429 on one fails
 * over to the other — doubling the /profile rate-limit headroom. Reports the
 * HTTP status so callers can tell a 429 (back off) from a 401/403 token issue.
 */
export async function fetchUserProfile(env: Env, id: string): Promise<UserProfileFetch> {
  const tokens = userTokens(env);
  if (tokens.length === 0) return { data: null, status: 0, retryAfter: 0 };

  const url =
    `${apiBase(env)}/users/${id}/profile` +
    `?with_mutual_guilds=false&with_mutual_friends=false`;

  // Spread load: start on a random token, then rotate to the next on a 429.
  const start = Math.floor(Math.random() * tokens.length);
  let lastStatus = 0;
  let lastRetryAfter = 0;

  for (let i = 0; i < tokens.length; i++) {
    const idx = (start + i) % tokens.length;
    const res = await fetch(url, { headers: clientHeaders(env, tokens[idx]) });
    if (res.ok) {
      return { data: (await res.json()) as RawProfileResponse, status: 200, retryAfter: 0 };
    }
    lastStatus = res.status;
    lastRetryAfter = Number(res.headers.get("retry-after")) || 0;
    console.warn(
      `[dough-restful] user-token #${idx + 1} /users/${id}/profile -> HTTP ${res.status}` +
        (lastRetryAfter ? ` (retry ${lastRetryAfter}s)` : "")
    );
    // Only a rate-limit is worth retrying on another token; 401/403/404 would
    // behave the same (or signal a token problem we'd rather surface).
    if (res.status !== 429) break;
  }
  return { data: null, status: lastStatus, retryAfter: lastRetryAfter };
}

// ---- wishlist (the profile's wishlist_settings key is a WISHLIST id) -----

export interface WishlistFetch {
  /** Raw wishlist JSON ({ id, user_id, wishlist_items: [...] }); null on fail. */
  raw: any | null;
  /** HTTP status (0 = not attempted / no token). */
  status: number;
}

/** One GET attempt; reads body as text so failures show in `wrangler tail`. */
async function tryJson(url: string, headers: Record<string, string>, label: string): Promise<WishlistFetch> {
  const res = await fetch(url, { headers });
  const text = await res.text().catch(() => "");
  if (res.ok) {
    try {
      return { raw: JSON.parse(text), status: 200 };
    } catch {
      console.warn(`[dough-restful] ${label} 200 non-JSON: ${text.slice(0, 100)}`);
      return { raw: null, status: 200 };
    }
  }
  console.warn(`[dough-restful] ${label} HTTP ${res.status}: ${text.slice(0, 140)}`);
  return { raw: null, status: res.status };
}

/**
 * Fetch a user's wishlist by its id (the key inside the profile's
 * `wishlist_settings`). GET /wishlists/{id} returns every item already
 * resolved (names + collectible image data), so no per-item lookups are
 * needed. User token + client fingerprint first, bot token as a fallback;
 * configured API version then v10.
 */
export async function fetchWishlist(env: Env, wishlistId: string): Promise<WishlistFetch> {
  const configured = env.DISCORD_API_VERSION || "10";
  const versions = configured === "10" ? ["10"] : [configured, "10"];
  const tokens = userTokens(env);
  let lastStatus = 0;

  for (const ver of versions) {
    const url = `https://discord.com/api/v${ver}/wishlists/${wishlistId}`;
    for (let i = 0; i < tokens.length; i++) {
      const r = await tryJson(url, clientHeaders(env, tokens[i]), `wishlist ${wishlistId} v${ver} user#${i + 1}`);
      if (r.raw) return r;
      lastStatus = r.status;
      if (r.status !== 429 && r.status !== 404) break;
    }
    const rb = await tryJson(
      url,
      { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      `wishlist ${wishlistId} v${ver} bot`
    );
    if (rb.raw) return rb;
    lastStatus = rb.status || lastStatus;
  }
  return { raw: null, status: lastStatus };
}
