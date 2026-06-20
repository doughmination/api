/* =====================================================================
 * discord/constants.ts — gateway opcodes, intents, badge table, CDN.
 * ===================================================================== */

export const CDN = "https://cdn.discordapp.com";

/** Gateway opcodes (Discord v10). */
export const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  PresenceUpdate: 3,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

/**
 * GUILDS (1<<0) | GUILD_MEMBERS (1<<1) | GUILD_PRESENCES (1<<8).
 * GUILD_MEMBERS and GUILD_PRESENCES are privileged — enable them in the
 * Discord Developer Portal under Bot > Privileged Gateway Intents.
 */
export const INTENTS = (1 << 0) | (1 << 1) | (1 << 8); // 259

/**
 * Public user flags (the `public_flags` bitfield). Single source of truth:
 * [bit, id, description, badge-icons hash | null]. Entries with a hash render
 * as a classic profile badge (see FLAG_BADGES); the rest are flags with no
 * badge art (team user, verified bot, spammer, …) that we still surface.
 * Bits/names from Discord's documented User Flags. 32-bit safe (all public
 * flags are <= bit 23).
 */
export const PUBLIC_FLAGS: ReadonlyArray<[number, string, string, string | null]> = [
  [1 << 0, "staff", "Discord Staff", "5e74e9b61934fc1f67c65515d1f7e60d"],
  [1 << 1, "partner", "Partnered Server Owner", "3f9748e53446a137a052f3454e2de41e"],
  [1 << 2, "hypesquad", "HypeSquad Events", "bf01d1073931f921909045f3a39fd264"],
  [1 << 3, "bug_hunter_level_1", "Bug Hunter", "2717692c7dca7289b35297368a940dd0"],
  [1 << 6, "hypesquad_house_1", "HypeSquad Bravery", "8a88d63823d8a71cd5e390baa45efa02"],
  [1 << 7, "hypesquad_house_2", "HypeSquad Brilliance", "011940fd013da3f7fb926e4a1cd2e618"],
  [1 << 8, "hypesquad_house_3", "HypeSquad Balance", "3aa41de486fa12454c3761e8e223442e"],
  [1 << 9, "premium_early_supporter", "Early Supporter", "7060786766c9c840eb3019e725d2b358"],
  [1 << 10, "team_pseudo_user", "Team User", null],
  [1 << 12, "system", "System", null],
  [1 << 14, "bug_hunter_level_2", "Bug Hunter Gold", "848f79194d4be5ff5f81505cbd0ce1e6"],
  [1 << 16, "verified_bot", "Verified Bot", null],
  [1 << 17, "verified_developer", "Early Verified Bot Developer", "6df5892e0f35b051f8b61eace34f4967"],
  [1 << 18, "certified_moderator", "Moderator Programs Alumni", "fee1624003e2fee35cb398e125dc479b"],
  [1 << 19, "bot_http_interactions", "HTTP Interactions Bot", null],
  [1 << 20, "spammer", "Likely Spammer", null],
  [1 << 22, "active_developer", "Active Developer", "6bdc42827a38498929a4920da12695d9"],
  [1 << 23, "provisional_account", "Provisional Account", null],
];

/** The subset of PUBLIC_FLAGS that have badge art: [bit, id, description, hash]. */
export const FLAG_BADGES = PUBLIC_FLAGS.filter(
  (f): f is [number, string, string, string] => f[3] !== null
);

/**
 * Decode a `public_flags` bitfield into a named list. Known flags get their
 * id + name; any *unknown* set bit (a flag Discord added that we haven't named
 * yet) is surfaced as `unknown_<bit>` so new flags/badges show up immediately.
 */
export function decodeUserFlags(flags: number): Array<{ id: string; name: string }> {
  flags = Number(flags) || 0;
  const out: Array<{ id: string; name: string }> = [];
  let known = 0;
  for (const [bit, id, name] of PUBLIC_FLAGS) {
    known |= bit;
    if (flags & bit) out.push({ id, name });
  }
  // Forward-compat: report set bits we don't recognise (scan the 32-bit range).
  for (let b = 0; b < 31; b++) {
    const bit = 1 << b;
    if ((flags & bit) && !(known & bit)) {
      out.push({ id: `unknown_${b}`, name: `Unknown flag (bit ${b})` });
    }
  }
  return out;
}

export function isAnimated(hash: string | null | undefined): boolean {
  return typeof hash === "string" && hash.startsWith("a_");
}

export function avatarUrl(id: string, hash: string | null, size = 256): string {
  if (!hash) {
    // default avatar bucket from the (new) id-based algorithm
    const idx = Number((BigInt(id) >> 22n) % 6n);
    return `${CDN}/embed/avatars/${idx}.png`;
  }
  const ext = isAnimated(hash) ? "gif" : "png";
  return `${CDN}/avatars/${id}/${hash}.${ext}?size=${size}`;
}

export function bannerUrl(id: string, hash: string | null, size = 600): string | null {
  if (!hash) return null;
  const ext = isAnimated(hash) ? "gif" : "png";
  return `${CDN}/banners/${id}/${hash}.${ext}?size=${size}`;
}

export function decorationUrl(asset: string): string {
  // Decorations are animated APNG served at .png — do NOT add ?size or proxy.
  return `${CDN}/avatar-decoration-presets/${asset}.png`;
}

export function badgeIconUrl(hash: string): string {
  return `${CDN}/badge-icons/${hash}.png`;
}

export function clanBadgeUrl(guildId: string, badge: string): string {
  return `${CDN}/guild-tag-badges/${guildId}/${badge}.png?size=24`;
}

export function emojiUrl(id: string, animated: boolean): string {
  return `${CDN}/emojis/${id}.${animated ? "gif" : "png"}?size=32`;
}

// ---- collectibles (Shop wishlist) ---------------------------------------
// Discord product type ids -> our human-readable kind. See Userdoccers
// "Collectible Product Type". 1000/2000/3000 are bundle/variants/external.
import type { WishlistItemType } from "../types";

export function collectibleTypeName(type: number | null | undefined): WishlistItemType {
  switch (type) {
    case 0:
      return "avatar_decoration";
    case 1:
      return "profile_effect";
    case 2:
      return "nameplate";
    case 1000:
      return "bundle";
    case 2000:
      return "variants_group";
    case 3000:
      return "external_sku";
    default:
      return "unknown";
  }
}

/** Static preset image for an avatar decoration (APNG served at .png). */
export function avatarDecorationImageUrl(asset: string): string {
  return `${CDN}/avatar-decoration-presets/${asset}.png`;
}

/**
 * Nameplate images. `asset` is a path prefix (e.g. "nameplates/nameplate_x/");
 * Discord serves a still PNG and a WEBM video under /assets/collectibles/.
 */
export function nameplateStaticUrl(asset: string): string {
  return `${CDN}/assets/collectibles/${asset}static.png`;
}
export function nameplateVideoUrl(asset: string): string {
  return `${CDN}/assets/collectibles/${asset}asset.webm`;
}
