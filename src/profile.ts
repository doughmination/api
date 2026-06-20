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
  UnifiedWishlistItem,
} from "./types";
import {
  avatarDecorationImageUrl,
  avatarUrl,
  badgeIconUrl,
  bannerUrl,
  CDN,
  clanBadgeUrl,
  collectibleTypeName,
  decodeUserFlags,
  decorationUrl,
  FLAG_BADGES,
  nameplateStaticUrl,
  nameplateVideoUrl,
} from "./discord/constants";
import {
  fetchBotUser,
  fetchUserProfile,
  fetchWishlist,
  type RawDiscordUser,
} from "./discord/rest";

export interface ProfileResult {
  user: UnifiedUser;
  badges: UnifiedBadge[];
  connected_accounts: UnifiedConnectedAccount[];
  /** Shop collectibles saved to the profile; null when unavailable. */
  wishlist: UnifiedWishlistItem[] | null;
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
  const publicFlags = u.public_flags ?? u.flags ?? 0;

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
    public_flags: publicFlags,
    flags: decodeUserFlags(publicFlags),
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

// ---- wishlist (profile's wishlist_settings key is a WISHLIST id) ---------
// `wishlist_settings` maps WISHLIST id -> per-wishlist settings (visibility,
// updated_at). The items live at GET /wishlists/{id}, already resolved with
// names + collectible image data, so we just fetch and flatten them.

/** Resolve static/animated/video image URLs for one collectible item. */
function itemImages(it: any): Pick<
  UnifiedWishlistItem,
  "static_image_url" | "animated_image_url" | "video_url"
> {
  const a = (it && it.assets) || {};
  let stat: string | null = a.static_image_url ?? null;
  let anim: string | null = a.animated_image_url ?? null;
  let vid: string | null = a.video_url ?? null;
  const type = it?.type;
  const asset = it?.asset;
  if (type === 0 && asset) {
    // avatar decoration — APNG served at .png
    stat = stat ?? avatarDecorationImageUrl(asset);
    anim = anim ?? avatarDecorationImageUrl(asset);
  } else if (type === 2 && asset) {
    // nameplate — still PNG + WEBM video under /assets/collectibles/
    stat = stat ?? nameplateStaticUrl(asset);
    vid = vid ?? nameplateVideoUrl(asset);
  } else if (type === 1) {
    // profile effect — image fields are full URLs on the item itself
    stat = stat ?? it?.staticFrameSrc ?? it?.thumbnailPreviewSrc ?? null;
    anim = anim ?? it?.thumbnailPreviewSrc ?? it?.reducedMotionSrc ?? null;
  }
  return { static_image_url: stat, animated_image_url: anim, video_url: vid };
}

/** Core (item) fields, before per-wishlist visibility/updated_at are layered on. */
type WishlistCore = Omit<UnifiedWishlistItem, "visibility" | "updated_at">;

/** Price from a SKU's price blob (minor units; amount 599 + exponent 2 => 5.99). */
function parsePrice(price: any): UnifiedWishlistItem["price"] {
  if (!price || typeof price.amount !== "number") return null;
  return {
    amount: price.amount,
    currency: typeof price.currency === "string" ? price.currency : "usd",
    exponent: typeof price.currency_exponent === "number" ? price.currency_exponent : 2,
  };
}

/**
 * Map one `wishlist_items[]` entry (from GET /wishlists/{id}) to its core
 * fields. Collectibles carry rich image data under `collectibles_item`
 * (handled by itemImages); other SKUs (games, etc.) fall back to the SKU's
 * store thumbnail.
 */
function wishlistItemToCore(it: any): WishlistCore {
  const sku = (it && it.sku) || {};
  const ci = it?.collectibles_item ?? sku?.tenant_metadata?.collectibles?.item ?? null;
  const typeId = typeof ci?.type === "number" ? ci.type : null;
  // bundle_items[] entries are collectible items directly ({ type, asset, … }).
  const bundleItems: any[] = Array.isArray(it?.bundle_items) ? it.bundle_items : [];
  const isBundle = !ci && bundleItems.length > 0;

  let images: Pick<UnifiedWishlistItem, "static_image_url" | "animated_image_url" | "video_url">;
  if (ci) {
    images = itemImages(ci);
  } else if (isBundle) {
    // A bundle has its own shop preview (fg over bg); fall back to the first
    // bundled item's art if the preview is missing.
    const preview = sku.preview_asset_paths || {};
    const previewImg: string | null = preview.fg_static || preview.bg_static || null;
    images = previewImg
      ? { static_image_url: previewImg, animated_image_url: null, video_url: null }
      : itemImages(bundleItems[0]);
  } else {
    const appId = sku.application_id;
    const thumb = sku.thumbnail_asset_id;
    images = {
      static_image_url: appId && thumb ? `${CDN}/app-assets/${appId}/store/${thumb}.png` : null,
      animated_image_url: null,
      video_url: null,
    };
  }

  // Discord ships bundle summaries as a "{joinedItems}" template — rebuild it
  // from the bundled SKU names (bundle_items omit names for some item types).
  let summary: string | null = sku.description ?? ci?.description ?? null;
  if (summary && /\{[^}]*\}/.test(summary)) {
    const bundled = Array.isArray(sku.bundled_skus) ? sku.bundled_skus : [];
    let names: string[] = bundled
      .map((s: any) => s?.name)
      .filter((n: any): n is string => typeof n === "string" && n.length > 0);
    if (!names.length) {
      names = bundleItems
        .map((b) => b?.title ?? b?.sku_name ?? b?.name)
        .filter((n: any): n is string => typeof n === "string" && n.length > 0);
    }
    summary = names.length ? names.join(", ") : null;
  }

  return {
    sku_id: String(it?.sku_id ?? sku.id ?? ""),
    type: ci ? collectibleTypeName(typeId) : isBundle ? "bundle" : "external_sku",
    type_id: ci ? typeId : isBundle ? 1000 : null,
    name: it?.sku_name ?? ci?.title ?? sku.name ?? null,
    summary,
    ...images,
    label: ci?.label ?? ci?.accessibilityLabel ?? null,
    is_owned: typeof it?.is_owned === "boolean" ? it.is_owned : null,
    price: parsePrice(sku.price),
  };
}

/** KV key for a fetched + parsed wishlist (shared across viewers). */
function wishlistKey(wishlistId: string): string {
  return `wishlist:${wishlistId}`;
}

/** Fetch + parse a wishlist by id, cache-first (~1h). */
async function getWishlistItems(
  env: Env,
  wishlistId: string,
  ctx?: ExecutionContext,
  force = false
): Promise<{ ok: boolean; items: WishlistCore[] }> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(wishlistKey(wishlistId), "json")) as
      | WishlistCore[]
      | null;
    if (cached) return { ok: true, items: cached };
  }
  const { raw } = await fetchWishlist(env, wishlistId);
  if (!raw) return { ok: false, items: [] };
  const arr = Array.isArray(raw.wishlist_items) ? raw.wishlist_items : [];
  const items = arr
    .slice(0, WISHLIST_MAX)
    .map(wishlistItemToCore)
    .filter((x: WishlistCore) => x.sku_id);
  const write = env.PROFILE_CACHE.put(wishlistKey(wishlistId), JSON.stringify(items), {
    expirationTtl: 3600, // 1h — wishlists change occasionally
  });
  if (ctx) ctx.waitUntil(write);
  else await write;
  return { ok: true, items };
}

/** Hard cap so an enormous wishlist can't blow up the response. */
const WISHLIST_MAX = 100;

/**
 * Build the wishlist from a rich profile payload. `wishlist_settings` is keyed
 * by wishlist id (usually one); for each we fetch GET /wishlists/{id} and
 * flatten its already-resolved items, layering on that wishlist's
 * visibility/updated_at. Returns null when the profile has no wishlist field,
 * or when every wishlist fetch failed (so the cache-merge keeps a prior good
 * list); [] for a reachable-but-empty wishlist.
 */
async function buildWishlist(
  env: Env,
  profile: {
    wishlist_settings?: Record<string, { visibility?: number; updated_at?: string }>;
  },
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedWishlistItem[] | null> {
  const settings = profile.wishlist_settings;
  if (!settings || typeof settings !== "object") return null;

  const ids = Object.keys(settings).filter((k) => /^\d{16,21}$/.test(k));
  if (!ids.length) return [];

  let anyOk = false;
  const out: UnifiedWishlistItem[] = [];
  for (const wid of ids) {
    const s = settings[wid] || {};
    const visibility = typeof s.visibility === "number" ? s.visibility : null;
    const updated_at = typeof s.updated_at === "string" ? s.updated_at : null;
    const { ok, items } = await getWishlistItems(env, wid, ctx, force);
    if (!ok) continue;
    anyOk = true;
    for (const core of items) out.push({ ...core, visibility, updated_at });
  }
  if (!anyOk) return null;
  return out;
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
  ctx?: ExecutionContext,
  force = false
): Promise<ProfileResult | null> {
  const got = await env.PROFILE_CACHE.getWithMetadata(cacheKey(id), "json");
  const cached = (got.value as CachedProfile | null) ?? null;
  const meta = got.metadata as { t?: number; ttl?: number } | null;
  const lastWrite = meta?.t ?? 0;
  // Per-entry TTL is jittered at write time so a big batch of profiles doesn't
  // all go stale on the same tick and stampede the rich refresh.
  const entryTtlMs = (meta?.ttl ?? baseTtl(env)) * 1000;
  // `force` (?fresh=1) treats the cache as stale so we re-fetch + re-resolve.
  const cacheFresh = !force && !!cached && Date.now() - lastWrite < entryTtlMs;

  // 1) Fresh rich cache -> serve it without touching Discord at all.
  if (cached && cacheFresh) return { ...cached, source: "cache" };

  // 2) Cache stale or missing -> fetch live. Skip the rich (user-token) attempt
  //    while we're in a 429 cooldown so the rate-limit window can clear instead
  //    of us hammering it on every request and never recovering.
  const cdRaw = await env.PROFILE_CACHE.get(COOLDOWN_KEY);
  const tryRich = !(cdRaw && Date.now() < Number(cdRaw));

  const { result: built, richStatus, retryAfter } = await buildFreshProfile(env, id, tryRich, ctx, force);

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
    // Don't clobber a cached wishlist with null if this refresh got the profile
    // but not the wishlist (e.g. it 429'd). An empty [] still overwrites.
    if (built.wishlist == null && cached?.wishlist != null) {
      built.wishlist = cached.wishlist;
    }
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
    // Bot-only refreshes can't read the wishlist (it rides on the rich
    // profile), so keep the cached one rather than dropping it to null.
    wishlist: bot.wishlist != null ? bot.wishlist : cached.wishlist,
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
      wishlist: result.wishlist,
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

async function buildFreshProfile(
  env: Env,
  id: string,
  tryRich: boolean,
  ctx?: ExecutionContext,
  force = false
): Promise<BuildResult> {
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
    // Rich badges (Nitro/boost/quest/orb/gifting…) from the profile. Passed
    // through generically so brand-new badges appear automatically — we don't
    // gate on a known list. Guard the icon URL in case a new badge has none.
    for (const b of profile.badges ?? []) {
      if (badges.some((x) => x.id === b.id)) continue;
      badges.push({
        id: b.id,
        description: b.description,
        icon: b.icon ?? null,
        icon_url: b.icon ? badgeIconUrl(b.icon) : null,
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

    // Wishlist rides on the rich profile (`wishlist_settings`); resolve its
    // SKUs to names + images (cache-first). null if the field is absent.
    const wishlist = await buildWishlist(env, profile, ctx, force);

    return {
      result: { user: buildUser(u, bio, pronouns, themeColors), badges, connected_accounts: connected, wishlist, source: "user" },
      richStatus,
      retryAfter,
    };
  }

  // Bot-only fallback — the wishlist rides on the rich profile, which we don't
  // have here, so it's null and the cache-merge keeps any previously cached one.
  const u = await fetchBotUser(env, id);
  if (!u) return { result: null, richStatus, retryAfter };
  return {
    result: {
      user: buildUser(u, null, null, null),
      badges: flagBadges(u.public_flags ?? u.flags ?? 0),
      connected_accounts: [],
      wishlist: null,
      source: "bot",
    },
    richStatus,
    retryAfter,
  };
}
