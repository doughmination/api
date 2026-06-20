/* =====================================================================
 * types.ts — the unified response schema.
 *
 * This is a NEW combined shape (not Lanyard- or dstn.to-identical): one
 * object carries live presence (gateway) + profile/badges (REST). Fields
 * that require the optional user token are null when running bot-only.
 * ===================================================================== */

export interface Env {
  GATEWAY: DurableObjectNamespace;
  PROFILE_CACHE: KVNamespace;

  DISCORD_BOT_TOKEN: string;
  /** Optional self-bot token for rich profile data. Off by default. */
  DISCORD_USER_TOKEN?: string;
  /** Optional second self-bot token; rich fetches spread across both and fail
   *  over on a 429, doubling the /profile rate-limit headroom. */
  DISCORD_USER_TOKEN2?: string;

  DISCORD_API_VERSION?: string;
  TRACKED_GUILD_IDS?: string;
  PROFILE_CACHE_TTL_SECONDS?: string;
  /** Current Discord client build number, sent in X-Super-Properties so the
   *  user-token /profile requests get the client's gentler rate limits. */
  DISCORD_CLIENT_BUILD_NUMBER?: string;
}

export type DiscordStatus = "online" | "idle" | "dnd" | "offline";

export interface UnifiedAvatarDecoration {
  asset: string;
  sku_id: string | null;
  url: string;
}

export interface UnifiedClanTag {
  guild_id: string;
  tag: string;
  badge: string | null;
  badge_url: string | null;
}

export interface UnifiedBadge {
  /** Discord badge id, e.g. "hypesquad_house_3", "orb_profile_badge". */
  id: string;
  description: string;
  /** CDN icon hash (badge-icons) when known. */
  icon: string | null;
  icon_url: string | null;
  link: string | null;
  /** Where the badge came from: classic public-flag, or the rich profile. */
  source: "flags" | "profile";
}

export interface UnifiedConnectedAccount {
  type: string;
  id: string;
  name: string;
  verified: boolean;
}

/** A decoded public user flag (whether or not it has badge art). */
export interface UnifiedFlag {
  /** e.g. "active_developer", "verified_bot", or "unknown_<bit>" if new. */
  id: string;
  /** Human-readable name, e.g. "Active Developer". */
  name: string;
}

/** Human-readable collectible kind, mapped from Discord's numeric product type. */
export type WishlistItemType =
  | "avatar_decoration"
  | "profile_effect"
  | "nameplate"
  | "bundle"
  | "variants_group"
  | "external_sku"
  | "unknown";

/**
 * One Discord Shop collectible a user has saved to their profile wishlist.
 * The SKU + per-user settings come from the profile's `wishlist_settings`; the
 * name/type/images are resolved from the collectible product so the frontend
 * can render the wishlist directly. `static_image_url` is set when known,
 * `animated_image_url`/`video_url` filled for collectibles that animate.
 */
export interface UnifiedWishlistItem {
  /** SKU id of the collectible (stable identifier for the shop item). */
  sku_id: string;
  /** Human-readable collectible kind. */
  type: WishlistItemType;
  /** Raw Discord numeric product type (0/1/2/1000/…); null if unresolved. */
  type_id: number | null;
  name: string | null;
  /** Short description/summary when the product provides one. */
  summary: string | null;
  /** Still image (PNG/APNG first frame). */
  static_image_url: string | null;
  /** Animated image (APNG) when the collectible animates. */
  animated_image_url: string | null;
  /** Video preview (WEBM/MP4) when present — mainly profile effects/nameplates. */
  video_url: string | null;
  /** Accessibility label / alt text from Discord. */
  label: string | null;
  /** Whether the wishlist owner already owns this item. */
  is_owned: boolean | null;
  /** Price in minor units (amount=599, exponent=2, currency="gbp" => £5.99). */
  price: { amount: number; currency: string; exponent: number } | null;
  /** Wishlist visibility from the profile (1 = everyone; null if unknown). */
  visibility: number | null;
  /** ISO timestamp the wishlist was last updated; null if unknown. */
  updated_at: string | null;
}

export interface UnifiedUser {
  id: string;
  username: string;
  global_name: string | null;
  display_name: string | null;

  avatar: string | null;
  avatar_url: string;
  banner: string | null;
  banner_url: string | null;
  accent_color: number | null;

  /** Raw `public_flags` bitfield. */
  public_flags: number;
  /** Decoded public flags (badge and non-badge), incl. any new/unknown ones. */
  flags: UnifiedFlag[];

  avatar_decoration: UnifiedAvatarDecoration | null;
  clan: UnifiedClanTag | null;
  /** Raw collectibles blob (nameplate, etc.) passed through as-is. */
  collectibles: Record<string, unknown> | null;

  /** Rich profile only (needs user token); null otherwise. */
  bio: string | null;
  pronouns: string | null;
  /** Nitro profile gradient — [top, bottom] ints; null if not set. */
  theme_colors: number[] | null;
  /** Nitro display-name styling — gradient colours + font/effect ids. */
  display_name_styles: UnifiedDisplayNameStyles | null;
}

export interface UnifiedDisplayNameStyles {
  /** 1 or 2 ints; the name-text gradient stops. */
  colors: number[] | null;
  font_id: number | null;
  effect_id: number | null;
}

export interface UnifiedSpotify {
  track_id: string | null;
  song: string;
  artist: string;
  album: string;
  album_art_url: string | null;
  timestamps: { start: number | null; end: number | null } | null;
}

export interface UnifiedCustomStatus {
  text: string | null;
  emoji: { id: string | null; name: string | null; animated: boolean; url: string | null } | null;
}

export interface UnifiedPresence {
  user_id: string;
  status: DiscordStatus;
  online: boolean;
  platform: { desktop: boolean; mobile: boolean; web: boolean };
  /** Plain Discord activities array (custom status / type-4 stripped out). */
  activities: any[];
  custom_status: UnifiedCustomStatus | null;
  listening_to_spotify: boolean;
  spotify: UnifiedSpotify | null;
  updated_at: number;
}

export interface UnifiedRecord {
  user: UnifiedUser;
  /** null when the user shares no monitored guild with the bot. */
  presence: UnifiedPresence | null;
  badges: UnifiedBadge[];
  connected_accounts: UnifiedConnectedAccount[];
  /** Discord Shop collectibles the user saved to their profile wishlist.
   *  null when unavailable (no user token / proxy, or the source was blocked);
   *  [] means we reached the source and the wishlist is empty. */
  wishlist: UnifiedWishlistItem[] | null;
  updated_at: number;
  source: {
    presence: "gateway" | "none";
    profile: "bot" | "user" | "cache";
  };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}
