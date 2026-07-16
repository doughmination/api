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

  /** Cloudflare Static Assets binding (./assets served at root). Used to check
   *  whether a custom doughmination cape exists at /capes/<uuid>.png. */
  ASSETS?: Fetcher;

  /** Durable Object that runs the Doughmination system API (/v2/plural,
   *  /v2/battery, /v2/system-data) — state store + realtime WebSocket hub. */
  SYSTEM: DurableObjectNamespace;

  // ---- Doughmination system API (see ./system/types.ts) ------------------
  SYSTEM_TOKEN?: string;
  CACHE_TTL?: string;
  JWT_SECRET?: string;
  TURNSTILE_SECRET?: string;
  TURNSILE_SECRET?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_DISPLAY_NAME?: string;
  DOUGH_BOT_TOKEN?: string;
  BATTERY_API_KEYS?: string;
  BASE_URL?: string;
  CORS_ORIGINS?: string;

  DISCORD_BOT_TOKEN: string;
  /** Optional self-bot token for rich profile data. Off by default. */
  DISCORD_USER_TOKEN?: string;
  /** Optional second self-bot token; rich fetches spread across both and fail
   *  over on a 429, doubling the /profile rate-limit headroom. */
  DISCORD_USER_TOKEN2?: string;
  /** Optional third self-bot token — extra headroom / backup if the first
   *  two are both cooling down from a 429. */
  DISCORD_USER_TOKEN3?: string;

  DISCORD_API_VERSION?: string;
  TRACKED_GUILD_IDS?: string;
  DISCORD_CLIENT_BUILD_NUMBER?: string;

  /** Guild id for the /v1/girls/:idType/:id lookups (e.g. your "Girls" server). */
  GIRLS_GUILD_ID?: string;

  /** Comma-separated guild ids to resolve per-guild membership data for on
   *  every profile (roles, join date, boosting, guild nick/avatar, timeout).
   *  Empty/unset falls back to TRACKED_GUILD_IDS; if that's empty too,
   *  memberships are skipped (they cost one bot call per guild). */
  MEMBERSHIP_GUILD_IDS?: string;

  /** Base URL for the PronounDB lookup API. Default https://pronoundb.org. */
  PRONOUNDB_API_BASE?: string;
  /** Base URL for the Vencord/Equicord Timezones plugin backend.
   *  Default https://timezone.creations.works. */
  TIMEZONE_API_BASE?: string;
  /** Base URL for the ReviewDB API. Default https://manti.vendicated.dev/api/reviewdb. */
  REVIEWDB_API_BASE?: string;
  /** Max ReviewDB reviews to include per user (default 25). */
  REVIEWDB_MAX?: string;

  // ---- contribapi (/v2/contribapi) — git contribution heatmaps -----------
  /** GitHub username whose contribution calendar is fetched. */
  GITHUB_USERNAME?: string;
  /** GitHub token (fine-grained PAT is enough) for the GraphQL calendar. */
  GITHUB_TOKEN?: string;
  /** Codeberg/Forgejo username whose heatmap is fetched (no token needed). */
  CODEBERG_USERNAME?: string;

  // ---- minecraft (/v2/minecraft/:uuid) -----------------------------------
  /** Hypixel API key (sent as the `API-Key` header). When unset,
   *  /v2/minecraft/general (Mojang profile + skin) still works, and
   *  /v2/minecraft/hypixel returns null sections with source "unavailable". */
  HYPIXEL_API_KEY?: string;
  /** Comma-separated allowlist of owner-owned Minecraft UUIDs (any spelling).
   *  Per Hypixel API policy the keyed /v2/minecraft/hypixel endpoint only serves
   *  our own accounts — arbitrary UUIDs are rejected so it can't be used to
   *  proxy the Public API to third parties. Empty = endpoint disabled. */
  MINECRAFT_ALLOWED_UUIDS?: string;
}

export type DiscordStatus = "online" | "idle" | "dnd" | "offline";

export interface UnifiedGuildInvite {
  id: string;
  name: string;
  icon_url: string | null;
  banner_url: string | null;
  splash_url: string | null;
  description: string | null;
  member_count: number | null;
  online_count: number | null;
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

/**
 * A badge sourced from a third-party client-mod badge aggregator
 * (badges.equicord.org), covering Vencord/Equicord/Aliucord/etc + the
 * "global badges" set it aggregates. Deliberately separate from
 * `badges` (Discord's own flag/profile badges) since these come from an
 * unofficial third-party service.
 */
export interface UnifiedClientBadge {
  /** Stable id derived from tooltip+icon_url (the upstream API has no id of
   *  its own — these are arbitrary per-user badges, not a fixed catalog). */
  id: string;
  /** Tooltip text the client mod shows for this badge. */
  tooltip: string;
  /** Absolute URL to the badge icon (png/gif/webp/svg). */
  icon_url: string;
  /** Which client-mod service the badge came from, inferred from the icon host
   *  (e.g. "Vencord", "Equicord", "BadgeVault"). "Equicord" for unknowns. */
  source: string;
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
  | "profile_frame"
  | "bundle"
  | "variants_group"
  | "external_sku"
  | "unknown";

/**
 * One collectible a user has EQUIPPED on their profile. Discord scatters these
 * across the rich profile: nameplates on `user.collectibles`, profile frames on
 * `user_profile.collectibles` (both maps of slot -> { sku_id, ... }), and the
 * avatar decoration on `user.avatar_decoration_data` — all folded in here (and
 * only here). We resolve each slot's SKU via
 * GET /collectibles-products/{sku_id} to get its name + image assets, so the
 * frontend can render whatever the user is wearing without knowing the slot
 * names ahead of time. Forward-compatible: an unrecognised slot still resolves.
 */
export interface UnifiedCollectible {
  /** The slot key from the profile's collectibles blob ("nameplate",
   *  "profile_frame", …). Passed through raw so new slots surface immediately. */
  slot: string;
  /** SKU id of the equipped collectible product. */
  sku_id: string;
  /** Human-readable kind resolved from the product's numeric type. */
  type: WishlistItemType;
  /** Raw Discord numeric product type (0/1/2/…); null if unresolved. */
  type_id: number | null;
  /** Product name, e.g. "Angel" (null if the product lookup failed). */
  name: string | null;
  /** Short product description/summary when present. */
  summary: string | null;
  /** Accessibility label / alt text from Discord. */
  label: string | null;
  /** Still image (PNG / APNG first frame). */
  static_image_url: string | null;
  /** Animated image (APNG) when the collectible animates. */
  animated_image_url: string | null;
  /** Video preview (WEBM/MP4) when present. */
  video_url: string | null;
  /** Nameplate colour palette (e.g. "bubble_gum"); null for other kinds. */
  palette: string | null;
  /** Unix timestamp (seconds) the equipped item expires; null if permanent. */
  expires_at: number | null;
}

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

/** Nitro / premium subscription state, decoded from the rich profile. */
export interface UnifiedPremium {
  /** Raw Discord premium_type (0 none, 1 classic, 2 nitro, 3 basic). */
  type_id: number | null;
  /** Human-readable tier: "none" | "classic" | "nitro" | "basic" | "unknown". */
  type: "none" | "classic" | "nitro" | "basic" | "unknown";
  /** ISO timestamp the user first subscribed to Nitro; null if unknown/none. */
  since: string | null;
  /** ISO timestamp the user started boosting any server; null if not boosting. */
  guild_since: string | null;
}

export interface UnifiedUser {
  id: string;
  username: string;
  global_name: string | null;
  display_name: string | null;
  /** Pre-2023 "name#1234" handle when Discord still exposes it; null otherwise. */
  legacy_username: string | null;

  avatar: string | null;
  avatar_url: string;
  banner: string | null;
  banner_url: string | null;
  accent_color: number | null;

  /** Raw `public_flags` bitfield. */
  public_flags: number;
  /** Decoded public flags (badge and non-badge), incl. any new/unknown ones. */
  flags: UnifiedFlag[];

  clan: UnifiedClanTag | null;

  /** Rich profile only (needs user token); null otherwise. */
  bio: string | null;
  pronouns: string | null;
  /** Nitro profile gradient — [top, bottom] ints; null if not set. */
  theme_colors: number[] | null;
  /** Nitro display-name styling — gradient colours + font/effect ids. */
  display_name_styles: UnifiedDisplayNameStyles | null;
  /** Nitro/premium subscription state (tier + since dates). Rich profile only. */
  premium: UnifiedPremium | null;
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
  /** Per-platform status string (e.g. { desktop: "dnd", mobile: "online" });
   *  richer than the booleans above — tells you the status on each client. */
  client_status: { desktop: DiscordStatus | null; mobile: DiscordStatus | null; web: DiscordStatus | null };
  /** Convenience list of the platforms the user is currently connected on. */
  active_platforms: Array<"desktop" | "mobile" | "web">;
  /** True when any activity is a Streaming (type 1) activity. */
  streaming: boolean;
  /** The Streaming activity's URL (Twitch/YouTube) when streaming; null otherwise. */
  stream_url: string | null;
  /** Plain Discord activities array (custom status / type-4 stripped out). */
  activities: any[];
  custom_status: UnifiedCustomStatus | null;
  listening_to_spotify: boolean;
  spotify: UnifiedSpotify | null;
  updated_at: number;
}

/** Per-guild membership for a user in one tracked guild (bot-token data). */
export interface UnifiedGuildMembership {
  guild_id: string;
  guild_name: string | null;
  guild_icon_url: string | null;
  nick: string | null;
  /** Guild-specific avatar if set, else falls back to the global avatar. */
  avatar_url: string;
  roles: string[];
  joined_at: string | null;
  /** ISO timestamp the user started boosting this guild; null if not boosting. */
  premium_since: string | null;
  pending: boolean;
  /** ISO timestamp until which the user is timed out; null if not timed out. */
  communication_disabled_until: string | null;
}

/** A user's timezone, from the Vencord/Equicord Timezones plugin backend. */
export interface UnifiedTimezone {
  /** IANA timezone id, e.g. "Europe/London". */
  timezone: string;
  /** Current local time in that zone (ISO 8601 with offset), computed at read. */
  local_time: string | null;
  /** UTC offset in minutes at read time (e.g. 60 for BST); null if uncomputable. */
  utc_offset_minutes: number | null;
}

/** One ReviewDB review left on a user's profile. */
export interface UnifiedReview {
  id: number | null;
  /** Free-text review body. */
  comment: string;
  /** Snowflake of the reviewer (Discord id), when present. */
  sender_id: string | null;
  sender_username: string | null;
  sender_avatar_url: string | null;
  /** Badge/type tags ReviewDB attaches (e.g. system/warning reviews). */
  type: number | null;
  /** ISO timestamp when known. */
  timestamp: string | null;
}

/** ReviewDB reputation summary for a user. */
export interface UnifiedReviews {
  count: number;
  reviews: UnifiedReview[];
}

export interface UnifiedRecord {
  user: UnifiedUser;
  /** null when the user shares no monitored guild with the bot. */
  presence: UnifiedPresence | null;
  badges: UnifiedBadge[];
  /** Third-party client-mod badges (Vencord/Equicord/Aliucord/etc, via
   *  badges.equicord.org's "global badges" aggregation). [] if none found,
   *  null if the aggregator couldn't be reached. */
  clientBadges: UnifiedClientBadge[] | null;
  connected_accounts: UnifiedConnectedAccount[];
  /** Discord Shop collectibles the user saved to their profile wishlist.
   *  null when unavailable (no user token / proxy, or the source was blocked);
   *  [] means we reached the source and the wishlist is empty. */
  wishlist: UnifiedWishlistItem[] | null;
  /** Collectibles the user has EQUIPPED (nameplate, profile frame, profile
   *  effect, avatar decoration), resolved to names + image assets. The ONLY
   *  place equipped collectibles appear — the raw per-slot blobs are folded in
   *  here rather than duplicated on `user`.
   *  null when unavailable (no user token, or the source was blocked);
   *  [] means the profile was reachable but nothing is equipped. */
  collectibles: UnifiedCollectible[] | null;
  /** Per-guild membership across configured tracked guilds. null when not
   *  configured/unavailable; [] when the user is in none of them. */
  guild_memberships: UnifiedGuildMembership[] | null;
  /** Pronouns from PronounDB (separate from Discord's own profile pronouns). */
  pronoundb: string | null;
  /** Timezone from the client-mod Timezones plugin backend; null if unset. */
  timezone: UnifiedTimezone | null;
  /** ReviewDB reputation/reviews; null when unavailable. */
  reviews: UnifiedReviews | null;
  updated_at: number;
  source: {
    presence: "gateway" | "none";
    profile: "bot" | "user";
  };
}

/** A role from the configured "Girls" guild (/v1/girls/role/:id). */
export interface UnifiedGirlsRole {
  id: string;
  guild_id: string;
  name: string;
  color: number;
  /** Same value as `color`, formatted as "#rrggbb" (lowercase). "#000000" means "no color set" (Discord's default). */
  color_hex: string;
  colors: { primary_color: number; secondary_color: number | null; tertiary_color: number | null } | null;
  /** Hex-formatted mirror of `colors` (null entries stay null). */
  colors_hex: { primary_color: string; secondary_color: string | null; tertiary_color: string | null } | null;
  hoist: boolean;
  icon_url: string | null;
  unicode_emoji: string | null;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
  member_count: number | null;
}

/** A member from the configured "Girls" guild (/v1/girls/member/:id). */
export interface UnifiedGirlsMember {
  user_id: string;
  guild_id: string;
  nick: string | null;
  avatar_url: string | null;
  roles: string[];
  joined_at: string | null;
  premium_since: string | null;
  pending: boolean;
  communication_disabled_until: string | null;
}

/** One cape a player has, resolved via capes.dev across every cape provider
 *  it knows (Minecraft, OptiFine, MinecraftCapes, LabyMod, 5zig, TLauncher,
 *  SkinMC). Only providers where the player actually has a cape are listed. */
export interface UnifiedCape {
  /** Provider the cape lives on: "minecraft", "optifine", "labymod", etc. */
  source: string;
  /** Raw cape texture PNG. */
  cape_url: string | null;
}

/** One vanilla (Mojang) cape we've persisted to memory. Same shape as an entry
 *  in a player's `capes` array: just the provider and the cape image URL. */
export interface VanillaCapeEntry {
  /** Always "minecraft" — these are vanilla Mojang capes. */
  source: string;
  /** Cape texture URL. */
  cape_url: string;
}

/** Registry blob stored in KV: texture hash -> entry. */
export type VanillaCapeRegistry = Record<string, VanillaCapeEntry>;

/** Response for GET /v2/minecraft/capes — the persisted vanilla capes. */
export interface VanillaCapeList {
  count: number;
  capes: VanillaCapeEntry[];
}

/** Mojang identity + skin/cape for a Minecraft account
 *  (/v2/minecraft/general/:uuid). */
export interface UnifiedMinecraftGeneral {
  /** Dashed UUID (canonical form). */
  uuid: string;
  /** Undashed UUID (as Mojang/Hypixel return it). */
  uuid_short: string;
  name: string | null;
  /** Raw skin texture file URL (textures.minecraft.net); null if none. */
  skin_url: string | null;
  /** "classic" (Steve) or "slim" (Alex) arm model; null if unknown. */
  skin_model: "classic" | "slim" | null;
  /** Raw texture URL of the *currently equipped* cape (from Mojang); null if
   *  none. See `capes` for every cape the player has across providers. */
  cape_url: string | null;
  /** Every cape the player has, one entry per provider that has one. Empty if
   *  the player has no capes anywhere (or capes.dev couldn't be reached). */
  capes: UnifiedCape[];
  /** Ready-to-embed render URLs from the public mc-heads.net proxy. Base URLs
   *  include the overlay (hat/jacket) layer; `_flat` variants show the inner
   *  skin only. */
  render: {
    /** 2D head, overlay on. */
    face: string;
    /** 2D head, overlay off. */
    face_flat: string;
    /** Isometric 3D head, overlay on. */
    head: string;
    /** Isometric 3D head, overlay off. */
    head_flat: string;
    /** Isometric 3D full body, overlay on. */
    body: string;
    /** Isometric 3D full body, overlay off. */
    body_flat: string;
    /** Flat front-facing full body, overlay on. */
    player: string;
    /** Flat front-facing full body, overlay off. */
    player_flat: string;
    /** Face + body composite. */
    combo: string;
    /** Raw skin texture PNG. */
    skin: string;
  };
  updated_at: number;
}

/** Hypixel stats for a Minecraft account (/v2/minecraft/hypixel/:uuid).
 *  `player`/`skyblock` are the raw upstream objects, passed through as-is. */
export interface UnifiedMinecraftHypixel {
  uuid: string;
  /** Hypixel display name, when the player object provides one. */
  name: string | null;
  /** Raw Hypixel `player` object; null when unavailable (see source.player). */
  player: Record<string, unknown> | null;
  /** Raw Hypixel SkyBlock `profiles` array; null when unavailable. */
  skyblock: unknown[] | null;
  updated_at: number;
  source: {
    player: MinecraftSourceState;
    skyblock: MinecraftSourceState;
  };
}

/** Why a Hypixel section is (or isn't) present.
 *  ok = loaded, unavailable = Hypixel not configured on this deployment,
 *  not_found = the player has never joined Hypixel, error = upstream failure. */
export type MinecraftSourceState = "ok" | "unavailable" | "not_found" | "error";

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}