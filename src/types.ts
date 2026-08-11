/* types.ts */

export interface Env {
  GATEWAY: DurableObjectNamespace;
  PROFILE_CACHE: KVNamespace;
  ASSETS?: Fetcher;
  SYSTEM: DurableObjectNamespace;

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
  DISCORD_USER_TOKEN?: string;
  DISCORD_USER_TOKEN2?: string;
  DISCORD_USER_TOKEN3?: string;

  DISCORD_API_VERSION?: string;
  TRACKED_GUILD_IDS?: string;
  DISCORD_CLIENT_BUILD_NUMBER?: string;

  GIRLS_GUILD_ID?: string;
  MEMBERSHIP_GUILD_IDS?: string;

  PRONOUNDB_API_BASE?: string;
  TIMEZONE_API_BASE?: string;
  REVIEWDB_API_BASE?: string;
  REVIEWDB_MAX?: string;

  GITHUB_USERNAME?: string;
  GITHUB_TOKEN?: string;
  CODEBERG_USERNAME?: string;

  HYPIXEL_API_KEY?: string;
  MINECRAFT_ALLOWED_UUIDS?: string;

  CF_API_TOKEN?: string;
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
  id: string;
  description: string;
  icon: string | null;
  icon_url: string | null;
  link: string | null;
  source: "flags" | "profile";
}

export interface UnifiedClientBadge {
  id: string;
  tooltip: string;
  icon_url: string;
  source: string;
}

export interface UnifiedConnectedAccount {
  type: string;
  id: string;
  name: string;
  verified: boolean;
}

export interface UnifiedFlag {
  id: string;
  name: string;
}

export type WishlistItemType =
  | "avatar_decoration"
  | "profile_effect"
  | "nameplate"
  | "profile_frame"
  | "bundle"
  | "variants_group"
  | "external_sku"
  | "unknown";

export interface UnifiedCollectible {
  slot: string;
  sku_id: string;
  type: WishlistItemType;
  type_id: number | null;
  name: string | null;
  summary: string | null;
  label: string | null;
  static_image_url: string | null;
  animated_image_url: string | null;
  video_url: string | null;
  palette: string | null;
  expires_at: number | null;
}

export interface UnifiedWishlistItem {
  sku_id: string;
  type: WishlistItemType;
  type_id: number | null;
  name: string | null;
  summary: string | null;
  static_image_url: string | null;
  animated_image_url: string | null;
  video_url: string | null;
  label: string | null;
  is_owned: boolean | null;
  price: { amount: number; currency: string; exponent: number } | null;
  visibility: number | null;
  updated_at: string | null;
}

export interface UnifiedPremium {
  type_id: number | null;
  type: "none" | "classic" | "nitro" | "basic" | "unknown";
  since: string | null;
  guild_since: string | null;
}

export interface UnifiedUser {
  id: string;
  username: string;
  global_name: string | null;
  display_name: string | null;
  legacy_username: string | null;

  avatar: string | null;
  avatar_url: string;
  banner: string | null;
  banner_url: string | null;
  accent_color: number | null;

  public_flags: number;
  flags: UnifiedFlag[];

  clan: UnifiedClanTag | null;

  bio: string | null;
  pronouns: string | null;
  theme_colors: number[] | null;
  display_name_styles: UnifiedDisplayNameStyles | null;
  premium: UnifiedPremium | null;
}

export interface UnifiedDisplayNameStyles {
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
  client_status: { desktop: DiscordStatus | null; mobile: DiscordStatus | null; web: DiscordStatus | null };
  active_platforms: Array<"desktop" | "mobile" | "web">;
  streaming: boolean;
  stream_url: string | null;
  activities: any[];
  custom_status: UnifiedCustomStatus | null;
  listening_to_spotify: boolean;
  spotify: UnifiedSpotify | null;
  updated_at: number;
}

export interface UnifiedGuildMembership {
  guild_id: string;
  guild_name: string | null;
  guild_icon_url: string | null;
  nick: string | null;
  avatar_url: string;
  roles: string[];
  joined_at: string | null;
  premium_since: string | null;
  pending: boolean;
  communication_disabled_until: string | null;
}

export interface UnifiedTimezone {
  timezone: string;
  local_time: string | null;
  utc_offset_minutes: number | null;
}

export interface UnifiedReview {
  id: number | null;
  comment: string;
  sender_id: string | null;
  sender_username: string | null;
  sender_avatar_url: string | null;
  type: number | null;
  timestamp: string | null;
}

export interface UnifiedReviews {
  count: number;
  reviews: UnifiedReview[];
}

export interface UnifiedRecord {
  user: UnifiedUser;
  presence: UnifiedPresence | null;
  badges: UnifiedBadge[];
  clientBadges: UnifiedClientBadge[] | null;
  connected_accounts: UnifiedConnectedAccount[];
  wishlist: UnifiedWishlistItem[] | null;
  collectibles: UnifiedCollectible[] | null;
  guild_memberships: UnifiedGuildMembership[] | null;
  pronoundb: string | null;
  timezone: UnifiedTimezone | null;
  reviews: UnifiedReviews | null;
  updated_at: number;
  source: {
    presence: "gateway" | "none";
    profile: "bot" | "user";
  };
}

export interface UnifiedGirlsRole {
  id: string;
  guild_id: string;
  name: string;
  color: number;
  color_hex: string;
  colors: { primary_color: number; secondary_color: number | null; tertiary_color: number | null } | null;
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

export interface UnifiedCape {
  source: string;
  cape_url: string | null;
}

export interface VanillaCapeEntry {
  source: string;
  cape_url: string;
}

export type VanillaCapeRegistry = Record<string, VanillaCapeEntry>;

export interface VanillaCapeList {
  count: number;
  capes: VanillaCapeEntry[];
}

export interface UnifiedMinecraftGeneral {
  uuid: string;
  uuid_short: string;
  name: string | null;
  skin_url: string | null;
  skin_model: "classic" | "slim" | null;
  cape_url: string | null;
  capes: UnifiedCape[];
  render: {
    face: string;
    face_flat: string;
    head: string;
    head_flat: string;
    body: string;
    body_flat: string;
    player: string;
    player_flat: string;
    combo: string;
    skin: string;
  };
  updated_at: number;
}

export interface UnifiedMinecraftHypixel {
  uuid: string;
  name: string | null;
  player: Record<string, unknown> | null;
  skyblock: unknown[] | null;
  updated_at: number;
  source: {
    player: MinecraftSourceState;
    skyblock: MinecraftSourceState;
  };
}

export type MinecraftSourceState = "ok" | "unavailable" | "not_found" | "error";

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface UnifiedGenshinCharacter {
  id: string;
  name: string;
  element: string;
  rarity: number;
  icon_url: string;
  owned: boolean;
  level: number | null;
  tracked: boolean;
  last_seen: number | null;
}

export interface UnifiedGenshinRoster {
  uid: string;
  nickname: string | null;
  player_level: number | null;
  partial: boolean;
  stale: boolean;
  owned_count: number;
  tracked_count: number;
  total_count: number;
  characters: UnifiedGenshinCharacter[];
  updated_at: number;
}

export interface UnifiedGenshinStat {
  name: string;
  value: number;
  is_percent: boolean;
}

export interface UnifiedGenshinWeapon {
  id: string;
  name: string;
  rarity: number;
  level: number;
  ascension: number;
  refinement: number;
  base_stat: UnifiedGenshinStat | null;
  sub_stat: UnifiedGenshinStat | null;
  icon_url: string;
}

export type UnifiedGenshinArtifactSlot =
  | "flower"
  | "plume"
  | "sands"
  | "goblet"
  | "circlet";

export interface UnifiedGenshinArtifact {
  id: string;
  name: string;
  set_name: string;
  slot: UnifiedGenshinArtifactSlot;
  rarity: number;
  level: number;
  main_stat: UnifiedGenshinStat | null;
  sub_stats: UnifiedGenshinStat[];
  icon_url: string;
}

export interface UnifiedGenshinCharacterDetail extends UnifiedGenshinCharacter {
  constellation: number;
  friendship: number | null;
  weapon: UnifiedGenshinWeapon | null;
  artifacts: UnifiedGenshinArtifact[];
  updated_at: number;
}

export interface UnifiedGenshinCharacterItems {
  weapon: UnifiedGenshinWeapon | null;
  artifacts: UnifiedGenshinArtifact[];
}

export interface UnifiedGenshinCharacterConstellations {
  constellation: number;
  unlocked_talent_ids: number[];
  friendship: number | null;
}
