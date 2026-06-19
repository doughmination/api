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
    const res = await fetch(url, { headers: { Authorization: tokens[idx] } });
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
