/* =====================================================================
 * genshin.ts — Enka.Network passthrough + static-data merge for a
 * player's Genshin character roster (owned/not-owned + level).
 *
 * Two independent cache tiers in the same PROFILE_CACHE KV, since they
 * change at very different rates:
 *   - the character *catalog* (Enka's store/characters.json + store/loc.json,
 *     merged into id -> {name, element, rarity, icon}) barely ever changes —
 *     cached ~24h.
 *   - a given player's *roster* (their UID response) can change any time
 *     they refresh their in-game showcase — cached using the `ttl` Enka
 *     itself returns, so we never serve staler data than Enka intends.
 *
 * Note: Enka only returns a player's full owned roster (`avatarInfoList`)
 * if they've enabled "Display all your characters" on their in-game
 * Character Showcase. Otherwise only the pinned showcase characters
 * (`showAvatarInfoList`, up to 8) come back — the response below flags
 * this via `partial: true` so callers/UIs can prompt the user to enable it.
 * ===================================================================== */

import type { Env, UnifiedGenshinCharacter, UnifiedGenshinRoster } from "./types";
import { ABUSE_CONTACT } from "./abuse";

const ENKA_UID_BASE = "https://enka.network/api/uid";
const CHARACTERS_JSON_URL =
  "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/characters.json";
const LOC_JSON_URL = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/loc.json";
const ICON_BASE = "https://enka.network/ui";
// Enka's docs explicitly ask for a custom, identifiable User-Agent per
// integration (not a shared generic one) so they can track/support it —
// see https://github.com/EnkaNetwork/API-docs. Kept distinct from the
// Mojang/mc-heads UA used elsewhere in this Worker.
const ENKA_USER_AGENT = `doughmination-genshin-roster/1.0 (+https://doughmination.uk; contact: ${ABUSE_CONTACT})`;

const CATALOG_TTL_SECONDS = 60 * 60 * 24; // static game data — refresh daily
const ROSTER_MIN_TTL_SECONDS = 30; // floor under Enka's own ttl, avoids 0/negative
const CATALOG_KEY = "genshin:catalog:v1";
const rosterKey = (uid: string) => `genshin:roster:${uid}`;

const ELEMENT_NAMES: Record<string, string> = {
  Fire: "Pyro",
  Water: "Hydro",
  Wind: "Anemo",
  Electric: "Electro",
  Ice: "Cryo",
  Rock: "Geo",
  Grass: "Dendro",
};

interface RawCharacterEntry {
  Element?: string;
  QualityType?: string;
  SideIconName?: string;
  NameTextMapHash?: number;
}
type RawCharacters = Record<string, RawCharacterEntry>;
type RawLoc = Record<string, Record<string, string>>; // lang -> hash -> name

interface EnkaShowAvatar {
  avatarId: number;
  level: number;
}
interface EnkaAvatarInfo {
  avatarId: number;
  propMap?: Record<string, { ival?: string }>;
}
interface EnkaUidResponse {
  playerInfo: {
    nickname?: string;
    level?: number;
    showAvatarInfoList?: EnkaShowAvatar[];
    avatarInfoList?: EnkaAvatarInfo[];
  };
  ttl?: number;
}

/** Character ids that are real, currently-playable characters — excludes empty
 *  placeholder entries, alt-costume/trial recolors (10000900+, 11000000+),
 *  and per-element Traveler skill variants (ids containing a hyphen). */
function isPlayableId(id: string, entry: RawCharacterEntry): boolean {
  if (!entry || !entry.QualityType) return false;
  if (id.includes("-")) return false;
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  if (n >= 11000000) return false; // duplicate/legacy recolors
  if (n >= 10000900 && n < 10001000) return false; // trial/alt-costume recolors
  return true;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": ENKA_USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream ${url} returned ${res.status}`);
  return (await res.json()) as T;
}

interface CatalogEntry {
  name: string;
  element: string;
  rarity: number;
  iconUrl: string;
  sideIconUrl: string;
}
type Catalog = Record<string, CatalogEntry>;

/** Build (or fetch from cache) the full playable-character catalog. */
async function getCatalog(env: Env, ctx?: ExecutionContext, force = false): Promise<Catalog> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(CATALOG_KEY, "json")) as Catalog | null;
    if (cached) return cached;
  }

  const [characters, loc] = await Promise.all([
    fetchJson<RawCharacters>(CHARACTERS_JSON_URL),
    fetchJson<RawLoc>(LOC_JSON_URL),
  ]);
  const en = loc.en ?? {};

  const catalog: Catalog = {};
  for (const [id, entry] of Object.entries(characters)) {
    if (!isPlayableId(id, entry)) continue;
    const name = entry.NameTextMapHash != null ? en[String(entry.NameTextMapHash)] : undefined;
    const sideIcon = entry.SideIconName ?? "";
    // "UI_AvatarIcon_Side_Ayaka" -> "UI_AvatarIcon_Ayaka" (front-facing icon)
    const fullIcon = sideIcon.replace("_Side_", "_");
    catalog[id] = {
      name: name ?? `Traveler ${id}`,
      element: ELEMENT_NAMES[entry.Element ?? ""] ?? entry.Element ?? "Unknown",
      rarity: entry.QualityType?.startsWith("QUALITY_ORANGE") ? 5 : 4,
      iconUrl: fullIcon ? `${ICON_BASE}/${fullIcon}.png` : "",
      sideIconUrl: sideIcon ? `${ICON_BASE}/${sideIcon}.png` : "",
    };
  }

  const write = env.PROFILE_CACHE.put(CATALOG_KEY, JSON.stringify(catalog), {
    expirationTtl: CATALOG_TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return catalog;
}

/** Thrown when Enka has no record of this UID (private/unindexed/typo'd). */
export class EnkaNotFoundError extends Error {
  constructor(uid: string) {
    super(`No Enka.Network record for UID ${uid}`);
    this.name = "EnkaNotFoundError";
  }
}

/** Full owned/not-owned roster for a UID, merged against the character catalog.
 *  Cache-first, honoring the `ttl` Enka itself returns for that profile. */
export async function getGenshinRoster(
  env: Env,
  uid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinRoster> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(rosterKey(uid), "json")) as UnifiedGenshinRoster | null;
    if (cached) return cached;
  }

  const [raw, catalog] = await Promise.all([
    (async () => {
      const res = await fetch(`${ENKA_UID_BASE}/${uid}`, {
        headers: { "User-Agent": ENKA_USER_AGENT, Accept: "application/json" },
      });
      if (res.status === 404 || res.status === 400) throw new EnkaNotFoundError(uid);
      if (!res.ok) throw new Error(`Enka upstream returned ${res.status}`);
      return (await res.json()) as EnkaUidResponse;
    })(),
    getCatalog(env, ctx, force),
  ]);

  // Prefer the full roster (only present if the player enabled "Display all
  // your characters"); fall back to the pinned showcase otherwise.
  const full = raw.playerInfo.avatarInfoList;
  const partial = !full || full.length === 0;
  const owned = new Map<string, number>(); // avatarId -> level

  if (full) {
    for (const c of full) {
      const level = Number(c.propMap?.["4001"]?.ival ?? 0);
      owned.set(String(c.avatarId), level);
    }
  } else {
    for (const c of raw.playerInfo.showAvatarInfoList ?? []) {
      owned.set(String(c.avatarId), c.level);
    }
  }

  const characters: UnifiedGenshinCharacter[] = Object.entries(catalog).map(([id, meta]) => ({
    id,
    name: meta.name,
    element: meta.element,
    rarity: meta.rarity,
    icon_url: meta.iconUrl,
    owned: owned.has(id),
    level: owned.get(id) ?? null,
  }));
  characters.sort((a, b) => (b.owned === a.owned ? a.name.localeCompare(b.name) : b.owned ? 1 : -1));

  const result: UnifiedGenshinRoster = {
    uid,
    nickname: raw.playerInfo.nickname ?? null,
    player_level: raw.playerInfo.level ?? null,
    partial,
    owned_count: owned.size,
    total_count: characters.length,
    characters,
    updated_at: Date.now(),
  };

  const ttl = Math.max(ROSTER_MIN_TTL_SECONDS, raw.ttl ?? ROSTER_MIN_TTL_SECONDS);
  const write = env.PROFILE_CACHE.put(rosterKey(uid), JSON.stringify(result), { expirationTtl: ttl });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}