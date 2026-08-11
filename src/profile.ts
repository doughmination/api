/* =====================================================================
 * profile.ts — build the UnifiedUser + badges + connections.
 *
 * Combines the bot-token /users/:id (basic) with the optional user-token
 * /users/:id/profile (rich) and merges badges. Fetched live on every request
 * (no profile-level cache); only a short 429 cooldown is persisted so a rich
 * rate-limit doesn't get the user tokens hammered.
 * ===================================================================== */

import type {
  Env,
  UnifiedBadge,
  UnifiedClientBadge,
  UnifiedConnectedAccount,
  UnifiedGuildMembership,
  UnifiedPremium,
  UnifiedReviews,
  UnifiedCollectible,
  UnifiedTimezone,
  UnifiedUser,
  UnifiedWishlistItem,
} from "./types";
// import { getClientBadges } from "./discord/clientBadges"; // badges.equicord.org is down — disabled below
import {
  avatarDecorationImageUrl,
  avatarUrl,
  badgeIconUrl,
  bannerUrl,
  CDN,
  clanBadgeUrl,
  collectibleSlotType,
  collectibleTypeName,
  decodeUserFlags,
  FLAG_BADGES,
  nameplateStaticUrl,
  nameplateVideoUrl,
  premiumTypeName,
} from "./discord/constants";
import {
  fetchBotUser,
  fetchCollectibleProduct,
  fetchUserProfile,
  fetchWishlist,
  type RawCollectibleItem,
  type RawCollectibleProduct,
  type RawDiscordUser,
  type RawProfileResponse,
} from "./discord/rest";
import { getMemberships } from "./memberships";
import { getPronouns } from "./thirdparty/pronoundb";
import { getTimezone } from "./thirdparty/timezone";
import { getReviews } from "./thirdparty/reviewdb";

export interface ProfileResult {
  user: UnifiedUser;
  badges: UnifiedBadge[];
  /** Third-party client-mod badges (Vencord/Equicord/Aliucord/etc). */
  clientBadges: UnifiedClientBadge[] | null;
  connected_accounts: UnifiedConnectedAccount[];
  /** Shop collectibles saved to the profile; null when unavailable. */
  wishlist: UnifiedWishlistItem[] | null;
  /** Collectibles the user has EQUIPPED (nameplate, profile frame, profile
   *  effect, avatar decoration), resolved to names + assets; null when
   *  unavailable. The single home for equipped collectibles — nothing is
   *  duplicated on `user`. */
  collectibles: UnifiedCollectible[] | null;
  /** Per-guild membership across configured tracked guilds (bot token). */
  guild_memberships: UnifiedGuildMembership[] | null;
  /** Pronouns from PronounDB. */
  pronoundb: string | null;
  /** Timezone from the client-mod Timezones backend. */
  timezone: UnifiedTimezone | null;
  /** ReviewDB reviews/reputation. */
  reviews: UnifiedReviews | null;
  source: "bot" | "user";
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
  themeColors: number[] | null,
  premium: UnifiedPremium | null = null
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

  const publicFlags = u.public_flags ?? u.flags ?? 0;

  return {
    id: u.id,
    username: u.username,
    global_name: u.global_name ?? null,
    display_name: u.display_name ?? u.global_name ?? null,
    legacy_username: u.legacy_username ?? null,
    avatar: u.avatar ?? null,
    avatar_url: avatarUrl(u.id, u.avatar),
    banner: u.banner ?? null,
    banner_url: bannerUrl(u.id, u.banner ?? null),
    accent_color: u.accent_color ?? null,
    public_flags: publicFlags,
    flags: decodeUserFlags(publicFlags),
    clan,
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
    premium,
  };
}

/** Build the premium/boosting block from the rich profile's premium fields. */
function buildPremium(profile: RawProfileResponse): UnifiedPremium | null {
  const hasAny =
    profile.premium_type != null ||
    profile.premium_since != null ||
    profile.premium_guild_since != null;
  if (!hasAny) return null;
  return {
    type_id: profile.premium_type ?? null,
    type: premiumTypeName(profile.premium_type),
    since: profile.premium_since ?? null,
    guild_since: profile.premium_guild_since ?? null,
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
    expirationTtl: 300,
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

  // Independent per-wishlist fetches — run them in parallel rather than
  // waterfalling, since each one can itself retry across tokens/versions.
  const fetched = await Promise.all(
    ids.map(async (wid) => {
      const s = settings[wid] || {};
      const visibility = typeof s.visibility === "number" ? s.visibility : null;
      const updated_at = typeof s.updated_at === "string" ? s.updated_at : null;
      const { ok, items } = await getWishlistItems(env, wid, ctx, force);
      return { ok, visibility, updated_at, items };
    })
  );

  let anyOk = false;
  const out: UnifiedWishlistItem[] = [];
  for (const { ok, visibility, updated_at, items } of fetched) {
    if (!ok) continue;
    anyOk = true;
    for (const core of items) out.push({ ...core, visibility, updated_at });
  }
  if (!anyOk) return null;
  return out;
}

// ---- equipped collectibles (the `collectibles` blobs) --------------------
// The rich profile carries TWO `collectibles` maps of slot -> { sku_id, … }
// for whatever the user has EQUIPPED: nameplates on `user.collectibles`, and
// (since mid-2026) the new `profile_frame` on `user_profile.collectibles`.
// Unlike the wishlist, the blobs only have SKU ids, so we resolve each via
// GET /collectibles-products/{sku_id} to get names + assets. Written
// generically over the slot keys so a new collectible type surfaces without
// a code change.

/** KV key for a resolved collectible product (global, shared across viewers). */
function collectibleKey(skuId: string): string {
  return `collectible:${skuId}`;
}

/** Fetch + cache one collectible product by SKU id (~1h; products are stable). */
async function getCollectibleProduct(
  env: Env,
  skuId: string,
  ctx?: ExecutionContext,
  force = false
): Promise<RawCollectibleProduct | null> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(collectibleKey(skuId), "json")) as
      | RawCollectibleProduct
      | null;
    if (cached) return cached;
  }
  const raw = await fetchCollectibleProduct(env, skuId);
  if (!raw) return null;
  const write = env.PROFILE_CACHE.put(collectibleKey(skuId), JSON.stringify(raw), {
    expirationTtl: 3600,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;
  return raw;
}

/** Pick the item from a product that matches the slot (else the first item). */
function pickCollectibleItem(
  product: RawCollectibleProduct | null,
  slot: string
): RawCollectibleItem | null {
  const items = Array.isArray(product?.items) ? product!.items! : [];
  if (!items.length) return null;
  const want = collectibleSlotType(slot);
  const match = items.find((it) => collectibleTypeName(it?.type) === want);
  return match ?? items[0];
}

/** Resolve static/animated/video URLs for one equipped collectible. Prefers the
 *  product item's ready-made `assets`; falls back to constructing them from the
 *  asset path (so a product-lookup failure still yields nameplate/deco art). */
function collectibleImages(
  item: RawCollectibleItem | null,
  slot: string,
  blobAsset: string | undefined
): Pick<UnifiedCollectible, "static_image_url" | "animated_image_url" | "video_url"> {
  const a = (item && item.assets) || {};
  let stat: string | null = a.static_image_url ?? null;
  let anim: string | null = a.animated_image_url ?? null;
  let vid: string | null = a.video_url ?? null;
  if (!stat && !anim && !vid) {
    const type = item?.type;
    const asset = item?.asset ?? blobAsset;
    if ((type === 2 || slot === "nameplate") && asset) {
      // nameplate — still PNG + WEBM under /assets/collectibles/
      stat = nameplateStaticUrl(asset);
      vid = nameplateVideoUrl(asset);
    } else if ((type === 0 || slot === "avatar_decoration") && asset) {
      // avatar decoration (pfp) — APNG served at .png
      stat = avatarDecorationImageUrl(asset);
      anim = avatarDecorationImageUrl(asset);
    } else if (type === 1 || slot === "profile_effect") {
      // profile effect — image fields are full URLs on the item itself
      stat = item?.staticFrameSrc ?? item?.thumbnailPreviewSrc ?? null;
      anim = item?.thumbnailPreviewSrc ?? item?.reducedMotionSrc ?? null;
    }
    // profile_frame (+ any future kind): assets arrive as full URLs on the
    // product item, so if those were absent there's nothing to reconstruct.
  }
  return { static_image_url: stat, animated_image_url: anim, video_url: vid };
}

/** One equipped-collectible SKU to resolve, gathered from the rich profile.
 *  A slot's data may bring its own asset/label/palette we can fall back on. */
interface CollectibleSource {
  slot: string;
  sku_id: string;
  asset?: string;
  label?: string | null;
  palette?: string | null;
  expires_at?: number | null;
}

/**
 * Gather every equipped collectible SKU from a rich profile. Discord scatters
 * these across four places rather than one list:
 *   • `user.collectibles`           — nameplate (and any future user-level slot)
 *   • `user_profile.collectibles`   — the new `profile_frame` (profile-level)
 *   • `user.avatar_decoration_data` — the pfp decoration (has its own sku_id)
 *   • `user_profile.profile_effect` — the equipped profile effect (by id)
 * We normalise all of them to { slot, sku_id } so a single resolver handles
 * the lot, deduping by slot so the same equipped item never appears twice.
 * Unknown future slots in either collectibles blob pass through as-is.
 */
function gatherCollectibleSources(profile: RawProfileResponse): CollectibleSource[] {
  const out: CollectibleSource[] = [];
  const seen = new Set<string>();
  const u = profile.user;

  // 1) collectibles blobs — nameplate on user.collectibles, profile_frame on
  //    user_profile.collectibles, plus any future slot on either. user-level
  //    wins if the same slot somehow shows up in both.
  for (const blob of [u?.collectibles, profile.user_profile?.collectibles]) {
    if (!blob || typeof blob !== "object") continue;
    for (const [slot, vRaw] of Object.entries(blob)) {
      if (seen.has(slot)) continue;
      if (!vRaw || typeof vRaw !== "object") continue;
      const v = vRaw as Record<string, any>;
      if (typeof v.sku_id !== "string") continue;
      seen.add(slot);
      out.push({
        slot,
        sku_id: v.sku_id,
        asset: typeof v.asset === "string" ? v.asset : undefined,
        label: typeof v.label === "string" ? v.label : null,
        palette: typeof v.palette === "string" ? v.palette : null,
        expires_at: typeof v.expires_at === "number" ? v.expires_at : null,
      });
    }
  }

  // 2) avatar decoration (pfp frame) — top-level user object. Lives under the
  //    unified collectibles list like everything else (skipped if a blob
  //    already provided the slot, so it's never repeated).
  const deco = u?.avatar_decoration_data;
  if (deco && typeof deco.sku_id === "string" && deco.sku_id && !seen.has("avatar_decoration")) {
    seen.add("avatar_decoration");
    out.push({
      slot: "avatar_decoration",
      sku_id: deco.sku_id,
      asset: typeof deco.asset === "string" ? deco.asset : undefined,
    });
  }

  // 3) equipped profile effect — user_profile.profile_effect.id. Discord only
  //    hands back the id here; we resolve it against collectibles-products
  //    (which replaced the old /user-profile-effects route). If the id isn't a
  //    resolvable SKU the entry still surfaces, typed from its slot.
  const effId = profile.user_profile?.profile_effect?.id;
  if (typeof effId === "string" && effId && !seen.has("profile_effect")) {
    out.push({ slot: "profile_effect", sku_id: effId });
  }

  return out;
}

/**
 * Build the equipped-collectibles list from a rich profile. Resolves each
 * gathered SKU (nameplate, profile frame, pfp decoration, profile effect) via
 * GET /collectibles-products/{sku_id} to names + image assets. Returns null
 * when there's no rich profile to read from; [] when nothing is equipped. A
 * per-item product-lookup failure still emits an entry built from the source's
 * own fields rather than dropping the equipped item.
 */
async function buildCollectibles(
  env: Env,
  profile: RawProfileResponse | null | undefined,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedCollectible[] | null> {
  if (!profile) return null;
  const sources = gatherCollectibleSources(profile);
  if (!sources.length) return [];

  // Independent per-SKU lookups — run them in parallel rather than
  // waterfalling, since each one can itself retry across tokens/versions.
  const out = await Promise.all(
    sources.map(async (src) => {
      const { slot, sku_id: skuId } = src;
      const product = await getCollectibleProduct(env, skuId, ctx, force);
      const item = pickCollectibleItem(product, slot);

      const typeId =
        typeof item?.type === "number"
          ? item.type
          : typeof product?.type === "number"
          ? product.type
          : null;
      let kind = collectibleTypeName(typeId);
      if (kind === "unknown") kind = collectibleSlotType(slot);

      const images = collectibleImages(item, slot, src.asset);

      return {
        slot,
        sku_id: skuId,
        type: kind,
        type_id: typeId,
        name: product?.name ?? item?.title ?? null,
        summary: product?.summary ?? item?.description ?? null,
        label: src.label ?? item?.label ?? item?.accessibilityLabel ?? null,
        ...images,
        palette:
          src.palette ?? (typeof item?.palette === "string" ? item.palette : null),
        expires_at: src.expires_at ?? null,
      };
    })
  );
  return out;
}

/** Global KV key holding the timestamp until which rich fetches are paused. */
const COOLDOWN_KEY = "profile:rich-cooldown";

/**
 * Get a user's profile — ALWAYS FRESH (no profile-level caching). The full
 * profile is fetched live on every request so the data is never stale. The one
 * thing we still persist is a short 429 cooldown: if the user-token /profile
 * endpoint rate-limits us, we pause the rich attempt for a bit (falling back to
 * bot-only) rather than hammering it every request until the tokens get banned.
 *
 * Sub-resource lookups (collectible products, wishlist items) keep their own
 * short caches — those are stable, shared, global data, not per-user profile
 * state — so "always fresh" doesn't mean re-downloading the whole shop catalogue
 * on every hit. Presence is unaffected; it streams from the gateway DO.
 */
export async function getProfile(
  env: Env,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<ProfileResult | null> {
  // Skip the rich (user-token) attempt while we're in a 429 cooldown so the
  // rate-limit window can clear instead of us re-triggering it every request.
  const cdRaw = await env.PROFILE_CACHE.get(COOLDOWN_KEY);
  const tryRich = !(cdRaw && Date.now() < Number(cdRaw));

  const { result, richStatus, retryAfter } = await buildFreshProfile(env, id, tryRich, ctx, force);

  if (richStatus === 429) {
    // back off all rich attempts for a while (honour Retry-After, clamp 30s–5m)
    const backoffMs = Math.min(Math.max(retryAfter, 30), 300) * 1000;
    const write = env.PROFILE_CACHE.put(COOLDOWN_KEY, String(Date.now() + backoffMs), {
      expirationTtl: Math.ceil(backoffMs / 1000) + 60,
    });
    if (ctx) ctx.waitUntil(write);
    else await write;
  }

  return result;
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
    // Discord's OWN pronouns (the native, lesser-known profile feature). Discord
    // returns "" — not null — when unset, so normalise empty to null; that's
    // what lets the PronounDB fallback actually kick in below.
    const rawPronouns = profile.user_profile?.pronouns;
    const pronouns = typeof rawPronouns === "string" && rawPronouns.trim() ? rawPronouns : null;
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

    const premium = buildPremium(profile);

    // Fetch everything that doesn't depend on the profile body in parallel.
    // Wishlist + equipped collectibles need the profile, so they run alongside.
    const [wishlist, collectibles, clientBadges, memberships, pronoundb, timezone, reviews] =
      await Promise.all([
        buildWishlist(env, profile, ctx, force),
        buildCollectibles(env, profile, ctx, force),
        Promise.resolve(null), // clientBadges disabled — badges.equicord.org is down
        getMemberships(env, id, ctx, force).catch(() => null),
        getPronouns(env, id, ctx, force).catch(() => null),
        getTimezone(env, id, ctx, force).catch(() => null),
        getReviews(env, id, ctx, force).catch(() => null),
      ]);

    return {
      result: {
        // Prefer PronounDB pronouns when Discord's own profile has none.
        user: buildUser(u, bio, pronouns ?? pronoundb, themeColors, premium),
        badges,
        clientBadges,
        connected_accounts: connected,
        wishlist,
        collectibles,
        guild_memberships: memberships,
        pronoundb,
        timezone,
        reviews,
        source: "user",
      },
      richStatus,
      retryAfter,
    };
  }

  // Bot-only fallback — the wishlist rides on the rich profile, which we don't
  // have here, so it's null. The bot /users/:id payload still carries the
  // avatar decoration + user-level collectibles blob (nameplate), so equipped
  // collectibles are resolved from that; profile_frame/profile_effect need the
  // rich profile and won't appear. Third-party sources + memberships don't
  // need the user token, so we still fetch those.
  const u = await fetchBotUser(env, id);
  if (!u) return { result: null, richStatus, retryAfter };
  const [collectibles, clientBadges, memberships, pronoundb, timezone, reviews] = await Promise.all([
    buildCollectibles(env, { user: u }, ctx, force).catch(() => null),
    Promise.resolve(null), // clientBadges disabled — badges.equicord.org is down
    getMemberships(env, id, ctx, force).catch(() => null),
    getPronouns(env, id, ctx, force).catch(() => null),
    getTimezone(env, id, ctx, force).catch(() => null),
    getReviews(env, id, ctx, force).catch(() => null),
  ]);
  return {
    result: {
      user: buildUser(u, null, pronoundb, null),
      badges: flagBadges(u.public_flags ?? u.flags ?? 0),
      clientBadges,
      connected_accounts: [],
      wishlist: null,
      collectibles,
      guild_memberships: memberships,
      pronoundb,
      timezone,
      reviews,
      source: "bot",
    },
    richStatus,
    retryAfter,
  };
}