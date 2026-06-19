/* =====================================================================
 * profile.ts — build the UnifiedUser + badges + connections.
 *
 * Combines the bot-token /users/:id (basic) with the optional user-token
 * /users/:id/profile (rich), merges badges, and caches the result in KV
 * because none of this comes over the gateway.
 * ===================================================================== */

import type {
  Env,
  UnifiedBadge,
  UnifiedConnectedAccount,
  UnifiedUser,
} from "./types";
import {
  avatarUrl,
  badgeIconUrl,
  bannerUrl,
  clanBadgeUrl,
  decorationUrl,
  FLAG_BADGES,
} from "./discord/constants";
import { fetchBotUser, fetchUserProfile, type RawDiscordUser } from "./discord/rest";

export interface ProfileResult {
  user: UnifiedUser;
  badges: UnifiedBadge[];
  connected_accounts: UnifiedConnectedAccount[];
  source: "bot" | "user" | "cache";
}

function flagBadges(flags: number): UnifiedBadge[] {
  const out: UnifiedBadge[] = [];
  for (const [bit, id, description, hash] of FLAG_BADGES) {
    if (flags & bit) {
      out.push({
        id,
        description,
        icon: hash,
        icon_url: badgeIconUrl(hash),
        link: null,
        source: "flags",
      });
    }
  }
  return out;
}

function buildUser(
  u: RawDiscordUser,
  bio: string | null,
  pronouns: string | null,
  themeColors: number[] | null
): UnifiedUser {
  const pg = u.primary_guild;
  const clan =
    pg && pg.tag && pg.identity_enabled && pg.identity_guild_id
      ? {
          guild_id: pg.identity_guild_id,
          tag: pg.tag,
          badge: pg.badge ?? null,
          badge_url: pg.badge ? clanBadgeUrl(pg.identity_guild_id, pg.badge) : null,
        }
      : null;

  const deco = u.avatar_decoration_data;

  return {
    id: u.id,
    username: u.username,
    global_name: u.global_name ?? null,
    display_name: u.display_name ?? u.global_name ?? null,
    avatar: u.avatar ?? null,
    avatar_url: avatarUrl(u.id, u.avatar),
    banner: u.banner ?? null,
    banner_url: bannerUrl(u.id, u.banner ?? null),
    accent_color: u.accent_color ?? null,
    avatar_decoration: deco
      ? { asset: deco.asset, sku_id: deco.sku_id ?? null, url: decorationUrl(deco.asset) }
      : null,
    clan,
    collectibles: (u.collectibles as Record<string, unknown> | null) ?? null,
    bio,
    pronouns,
    theme_colors: themeColors,
    display_name_styles: u.display_name_styles
      ? {
          colors: Array.isArray(u.display_name_styles.colors)
            ? u.display_name_styles.colors
            : null,
          font_id: u.display_name_styles.font_id ?? null,
          effect_id: u.display_name_styles.effect_id ?? null,
        }
      : null,
  };
}

function cacheKey(id: string): string {
  return `profile:${id}`;
}

/** Base profile freshness window (seconds). Profiles change rarely, so this is
 *  long by default; override via PROFILE_CACHE_TTL_SECONDS. */
function baseTtl(env: Env): number {
  return Math.max(60, Number(env.PROFILE_CACHE_TTL_SECONDS || "1800"));
}

type CachedProfile = Omit<ProfileResult, "source">;

/**
 * Get a user's profile — CACHE-FIRST, with a bot+user merge fallback.
 *
 * Profiles change rarely and Discord rate-limits the user-token /profile
 * endpoint hard, so we serve a cached rich profile for PROFILE_CACHE_TTL_SECONDS
 * before bothering Discord again — this is what stops the rate-limiting.
 *
 * When a refresh CAN only reach the bot token (the rich call got 429'd/blocked),
 * we don't downgrade: we keep the fresh bot base and layer the cached rich
 * fields (theme_colors, display_name_styles, bio, pronouns, rich badges +
 * connections) back over it — "use both at once" — so those never vanish during
 * a rate-limit window. Presence is unaffected; it streams from the gateway DO.
 */
export async function getProfile(
  env: Env,
  id: string,
  ctx?: ExecutionContext
): Promise<ProfileResult | null> {
  const got = await env.PROFILE_CACHE.getWithMetadata(cacheKey(id), "json");
  const cached = (got.value as CachedProfile | null) ?? null;
  const meta = got.metadata as { t?: number; ttl?: number } | null;
  const lastWrite = meta?.t ?? 0;
  // Per-entry TTL is jittered at write time so a big batch of profiles doesn't
  // all go stale on the same tick and stampede the rich refresh.
  const entryTtlMs = (meta?.ttl ?? baseTtl(env)) * 1000;
  const cacheFresh = !!cached && Date.now() - lastWrite < entryTtlMs;

  // 1) Fresh rich cache -> serve it without touching Discord at all.
  if (cached && cacheFresh) return { ...cached, source: "cache" };

  // 2) Cache stale or missing -> fetch live. Skip the rich (user-token) attempt
  //    while we're in a 429 cooldown so the rate-limit window can clear instead
  //    of us hammering it on every request and never recovering.
  const cdRaw = await env.PROFILE_CACHE.get(COOLDOWN_KEY);
  const tryRich = !(cdRaw && Date.now() < Number(cdRaw));

  const { result: built, richStatus, retryAfter } = await buildFreshProfile(env, id, tryRich);

  if (richStatus === 429) {
    // back off all rich attempts for a while (honour Retry-After, clamp 30s–5m)
    const backoffMs = Math.min(Math.max(retryAfter, 30), 300) * 1000;
    const write = env.PROFILE_CACHE.put(COOLDOWN_KEY, String(Date.now() + backoffMs), {
      expirationTtl: Math.ceil(backoffMs / 1000) + 60,
    });
    if (ctx) ctx.waitUntil(write);
    else await write;
  }

  if (built && built.source === "user") {
    const write = writeCache(env, id, built);
    if (ctx) ctx.waitUntil(write);
    else await write;
    return built;
  }

  if (built && built.source === "bot") {
    // Rich fetch skipped/degraded: fresh bot base + cached rich extras.
    if (cached) return { ...mergeRichOverBot(cached, built), source: "cache" };
    return built; // nothing cached yet — bot-only is the best we have
  }

  // 3) Discord gave us nothing — serve stale cache if present.
  if (cached) return { ...cached, source: "cache" };
  return null;
}

/** Global KV key holding the timestamp until which rich fetches are paused. */
const COOLDOWN_KEY = "profile:rich-cooldown";

/** Layer the rich-only fields from cache over a fresh bot-token result. */
function mergeRichOverBot(cached: CachedProfile, bot: ProfileResult): CachedProfile {
  return {
    user: {
      ...bot.user,
      bio: cached.user.bio,
      pronouns: cached.user.pronouns,
      theme_colors: cached.user.theme_colors,
      display_name_styles: cached.user.display_name_styles,
    },
    badges: cached.badges.length ? cached.badges : bot.badges,
    connected_accounts: cached.connected_accounts.length
      ? cached.connected_accounts
      : bot.connected_accounts,
  };
}

/** Persist a rich profile so it can drive cache-hits and bot-merge fallbacks. */
async function writeCache(env: Env, id: string, result: ProfileResult): Promise<void> {
  // Jitter the freshness window ±20% so entries refresh staggered, not in a burst.
  const jitteredTtl = Math.round(baseTtl(env) * (0.8 + Math.random() * 0.4));
  await env.PROFILE_CACHE.put(
    cacheKey(id),
    JSON.stringify({
      user: result.user,
      badges: result.badges,
      connected_accounts: result.connected_accounts,
    }),
    // Keep the rich blob ~24h so it's available to merge over bot data even
    // when it's well past its freshness window.
    { expirationTtl: 86400, metadata: { t: Date.now(), ttl: jitteredTtl } }
  );
}

interface BuildResult {
  result: ProfileResult | null;
  /** HTTP status of the rich (user-token) attempt; 0 if it was skipped. */
  richStatus: number;
  /** Retry-After seconds from a 429, when present. */
  retryAfter: number;
}

async function buildFreshProfile(env: Env, id: string, tryRich: boolean): Promise<BuildResult> {
  // Rich path first (unless we're cooling down from a 429); fall back to bot.
  const rich = tryRich
    ? await fetchUserProfile(env, id)
    : { data: null, status: 0, retryAfter: 0 };
  const richStatus = rich.status;
  const retryAfter = rich.retryAfter;
  const profile = rich.data;

  if (profile && profile.user) {
    const u = profile.user;
    const bio = profile.user_profile?.bio ?? u.bio ?? null;
    const pronouns = profile.user_profile?.pronouns ?? null;
    const themeColors =
      Array.isArray(profile.user_profile?.theme_colors) &&
      profile.user_profile!.theme_colors!.length >= 2
        ? profile.user_profile!.theme_colors!
        : null;

    const badges: UnifiedBadge[] = [];
    // Flag badges from the user object (so classic badges are always present).
    badges.push(...flagBadges(u.public_flags ?? u.flags ?? 0));
    // Rich badges (Nitro/boost/quest/orb/gifting…) from the profile.
    for (const b of profile.badges ?? []) {
      if (badges.some((x) => x.id === b.id)) continue;
      badges.push({
        id: b.id,
        description: b.description,
        icon: b.icon,
        icon_url: badgeIconUrl(b.icon),
        link: b.link ?? null,
        source: "profile",
      });
    }

    const connected: UnifiedConnectedAccount[] = (profile.connected_accounts ?? []).map((c) => ({
      type: c.type,
      id: c.id,
      name: c.name,
      verified: !!c.verified,
    }));

    return {
      result: { user: buildUser(u, bio, pronouns, themeColors), badges, connected_accounts: connected, source: "user" },
      richStatus,
      retryAfter,
    };
  }

  // Bot-only fallback.
  const u = await fetchBotUser(env, id);
  if (!u) return { result: null, richStatus, retryAfter };
  return {
    result: {
      user: buildUser(u, null, null, null),
      badges: flagBadges(u.public_flags ?? u.flags ?? 0),
      connected_accounts: [],
      source: "bot",
    },
    richStatus,
    retryAfter,
  };
}
