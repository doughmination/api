/* =====================================================================
 * genshin.ts — Enka.Network passthrough + static-data merge for a
 * player's Genshin character roster (owned/not-owned + level), plus
 * per-character detail (weapon, artifacts, constellation, friendship).
 *
 * Three cache tiers in the same PROFILE_CACHE KV, since they change at
 * very different rates:
 *   - the character *catalog* (Enka's store/characters.json + store/loc.json,
 *     merged into id -> {name, element, rarity, icon}) barely ever changes —
 *     cached ~24h. `loc` (raw localization strings) is cached separately on
 *     the same TTL so weapon/artifact name lookups don't need their own fetch.
 *   - a given player's *raw* Enka UID response is cached using the `ttl`
 *     Enka itself returns, so we never serve staler data than Enka intends.
 *     Everything below (roster list, single-character detail, items,
 *     constellations) is derived from this one cached blob — one upstream
 *     fetch per UID per ttl window, no matter how many of these are called.
 *
 * Note: Enka only returns a player's full owned roster (`avatarInfoList`)
 * if they've enabled "Display all your characters" on their in-game
 * Character Showcase. Otherwise only the pinned showcase characters
 * (`showAvatarInfoList`, up to 8) come back — the roster response flags
 * this via `partial: true` so callers/UIs can prompt the user to enable it.
 *
 * Separately: even with "Display all" on, Mihoyo's own API (which Enka
 * passes through) only includes full builds (`equipList` — weapon +
 * artifacts) for characters currently sitting in the showcase (~8 max).
 * The rest of `avatarInfoList` only has level/ascension/constellation. So
 * `weapon`/`artifacts` can legitimately be empty for an owned, leveled
 * character that just isn't pinned right now — that's an Enka/game
 * limitation, not a bug here.
 * ===================================================================== */

import type {
  Env,
  UnifiedGenshinArtifact,
  UnifiedGenshinArtifactSlot,
  UnifiedGenshinCharacter,
  UnifiedGenshinCharacterConstellations,
  UnifiedGenshinCharacterDetail,
  UnifiedGenshinCharacterItems,
  UnifiedGenshinRoster,
  UnifiedGenshinStat,
  UnifiedGenshinWeapon,
} from "./types";
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
const LOC_KEY = "genshin:loc:v1";
const rawKey = (uid: string) => `genshin:raw:${uid}`;

const ELEMENT_NAMES: Record<string, string> = {
  Fire: "Pyro",
  Water: "Hydro",
  Wind: "Anemo",
  Electric: "Electro",
  Ice: "Cryo",
  Rock: "Geo",
  Grass: "Dendro",
};

/** The base Traveler entries (10000005/10000007) come back from Enka's
 *  catalog as a single generic "Traveler" with whatever element their most
 *  recently-used vision happens to be — not the two named, elementless
 *  identities players actually think of them as. Override both explicitly
 *  rather than trusting the catalog for these two ids. */
const TRAVELER_OVERRIDES: Record<string, { name: string; element: string }> = {
  "10000005": { name: "Aether", element: "All" },
  "10000007": { name: "Lumine", element: "All" },
};

/** appendPropId -> display name, for weapon/artifact stat lines. */
const STAT_NAMES: Record<string, string> = {
  FIGHT_PROP_HP: "HP",
  FIGHT_PROP_HP_PERCENT: "HP%",
  FIGHT_PROP_ATTACK: "ATK",
  FIGHT_PROP_ATTACK_PERCENT: "ATK%",
  FIGHT_PROP_DEFENSE: "DEF",
  FIGHT_PROP_DEFENSE_PERCENT: "DEF%",
  FIGHT_PROP_CRITICAL: "CRIT Rate",
  FIGHT_PROP_CRITICAL_HURT: "CRIT DMG",
  FIGHT_PROP_CHARGE_EFFICIENCY: "Energy Recharge",
  FIGHT_PROP_ELEMENT_MASTERY: "Elemental Mastery",
  FIGHT_PROP_HEAL_ADD: "Healing Bonus",
  FIGHT_PROP_FIRE_ADD_HURT: "Pyro DMG Bonus",
  FIGHT_PROP_WATER_ADD_HURT: "Hydro DMG Bonus",
  FIGHT_PROP_WIND_ADD_HURT: "Anemo DMG Bonus",
  FIGHT_PROP_ELEC_ADD_HURT: "Electro DMG Bonus",
  FIGHT_PROP_ICE_ADD_HURT: "Cryo DMG Bonus",
  FIGHT_PROP_ROCK_ADD_HURT: "Geo DMG Bonus",
  FIGHT_PROP_GRASS_ADD_HURT: "Dendro DMG Bonus",
  FIGHT_PROP_PHYSICAL_ADD_HURT: "Physical DMG Bonus",
};
/** Which of the above are percentages (Enka already reports these as e.g.
 *  46.6, not 0.466 — this just tells the caller whether to append "%"). */
const PERCENT_STAT_IDS = new Set([
  "FIGHT_PROP_HP_PERCENT",
  "FIGHT_PROP_ATTACK_PERCENT",
  "FIGHT_PROP_DEFENSE_PERCENT",
  "FIGHT_PROP_CRITICAL",
  "FIGHT_PROP_CRITICAL_HURT",
  "FIGHT_PROP_CHARGE_EFFICIENCY",
  "FIGHT_PROP_HEAL_ADD",
  "FIGHT_PROP_FIRE_ADD_HURT",
  "FIGHT_PROP_WATER_ADD_HURT",
  "FIGHT_PROP_WIND_ADD_HURT",
  "FIGHT_PROP_ELEC_ADD_HURT",
  "FIGHT_PROP_ICE_ADD_HURT",
  "FIGHT_PROP_ROCK_ADD_HURT",
  "FIGHT_PROP_GRASS_ADD_HURT",
  "FIGHT_PROP_PHYSICAL_ADD_HURT",
]);
/** equipType -> artifact slot. Fixed by the game, never changes. */
const ARTIFACT_SLOTS: Record<string, UnifiedGenshinArtifactSlot> = {
  EQUIP_BRACER: "flower",
  EQUIP_NECKLACE: "plume",
  EQUIP_SHOES: "sands",
  EQUIP_RING: "goblet",
  EQUIP_DRESS: "circlet",
};

interface RawCharacterEntry {
  Element?: string;
  QualityType?: string;
  SideIconName?: string;
  NameTextMapHash?: number;
}
type RawCharacters = Record<string, RawCharacterEntry>;
type RawLoc = Record<string, Record<string, string>>; // lang -> hash -> name

interface RawStat {
  appendPropId?: string;
  statValue?: number;
}
interface RawFlat {
  nameTextMapHash?: number | string;
  setNameTextMapHash?: number | string;
  rankLevel?: number;
  icon?: string;
  weaponStats?: RawStat[];
  reliquaryMainstat?: RawStat;
  reliquarySubstats?: RawStat[];
  equipType?: string;
}
interface RawWeaponData {
  level?: number;
  promoteLevel?: number;
  /** key = skill id, value = refine rank 0-4 (R1-R5). Single entry in practice. */
  affixMap?: Record<string, number>;
}
interface RawReliquaryData {
  /** 1-indexed — display level (the in-game "+N") is this minus 1. */
  level?: number;
}
interface RawEquip {
  itemId: number;
  weapon?: RawWeaponData;
  reliquary?: RawReliquaryData;
  flat: RawFlat;
}

interface EnkaShowAvatar {
  avatarId: number;
  level: number;
}
interface EnkaAvatarInfo {
  avatarId: number;
  propMap?: Record<string, { ival?: string }>;
  /** Unlocked constellations, in unlock order. Length == constellation count. */
  talentIdList?: number[];
  fetterInfo?: { expLevel?: number };
  /** Only present for characters currently in the showcase — see file header. */
  equipList?: RawEquip[];
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

/** Build (or fetch from cache) the raw en-locale string table (hash -> name).
 *  Shared by the character catalog and by weapon/artifact name lookups. */
async function getLoc(env: Env, ctx?: ExecutionContext, force = false): Promise<RawLoc> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(LOC_KEY, "json")) as RawLoc | null;
    if (cached) return cached;
  }
  const loc = await fetchJson<RawLoc>(LOC_JSON_URL);
  const write = env.PROFILE_CACHE.put(LOC_KEY, JSON.stringify(loc), { expirationTtl: CATALOG_TTL_SECONDS });
  if (ctx) ctx.waitUntil(write);
  else await write;
  return loc;
}

function locName(loc: RawLoc, hash: number | string | undefined): string {
  if (hash == null) return "Unknown";
  return loc.en?.[String(hash)] ?? "Unknown";
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
    getLoc(env, ctx, force),
  ]);
  const en = loc.en ?? {};

  const catalog: Catalog = {};
  for (const [id, entry] of Object.entries(characters)) {
    if (!isPlayableId(id, entry)) continue;
    const name = entry.NameTextMapHash != null ? en[String(entry.NameTextMapHash)] : undefined;
    const sideIcon = entry.SideIconName ?? "";
    // "UI_AvatarIcon_Side_Ayaka" -> "UI_AvatarIcon_Ayaka" (front-facing icon)
    const fullIcon = sideIcon.replace("_Side_", "_");
    const override = TRAVELER_OVERRIDES[id];
    catalog[id] = {
      name: override?.name ?? name ?? `Traveler ${id}`,
      element: override?.element ?? ELEMENT_NAMES[entry.Element ?? ""] ?? entry.Element ?? "Unknown",
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

/** Fetch (or return the cached copy of) the raw Enka UID response.
 *  This is the one and only upstream call per UID per ttl window — the
 *  roster list, single-character detail, items, and constellations
 *  endpoints all derive from this same cached blob. */
async function getCachedRaw(
  env: Env,
  uid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<EnkaUidResponse> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(rawKey(uid), "json")) as EnkaUidResponse | null;
    if (cached) return cached;
  }

  const res = await fetch(`${ENKA_UID_BASE}/${uid}`, {
    headers: { "User-Agent": ENKA_USER_AGENT, Accept: "application/json" },
  });
  if (res.status === 404 || res.status === 400) throw new EnkaNotFoundError(uid);
  if (!res.ok) throw new Error(`Enka upstream returned ${res.status}`);
  const raw = (await res.json()) as EnkaUidResponse;

  const ttl = Math.max(ROSTER_MIN_TTL_SECONDS, raw.ttl ?? ROSTER_MIN_TTL_SECONDS);
  const write = env.PROFILE_CACHE.put(rawKey(uid), JSON.stringify(raw), { expirationTtl: ttl });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return raw;
}

/** Raw Enka response + the static catalog + loc strings, all cache-first. */
async function getUidData(
  env: Env,
  uid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<{ raw: EnkaUidResponse; catalog: Catalog; loc: RawLoc }> {
  const [raw, catalog, loc] = await Promise.all([
    getCachedRaw(env, uid, ctx, force),
    getCatalog(env, ctx, force),
    getLoc(env, ctx, force),
  ]);
  return { raw, catalog, loc };
}

function toStat(raw: RawStat | undefined): UnifiedGenshinStat | null {
  if (!raw?.appendPropId) return null;
  const id = raw.appendPropId;
  return {
    name: STAT_NAMES[id] ?? id,
    value: raw.statValue ?? 0,
    is_percent: PERCENT_STAT_IDS.has(id),
  };
}

function buildWeapon(equip: RawEquip, loc: RawLoc): UnifiedGenshinWeapon | null {
  if (!equip.weapon) return null;
  const refine = Object.values(equip.weapon.affixMap ?? {})[0] ?? 0;
  return {
    id: String(equip.itemId),
    name: locName(loc, equip.flat.nameTextMapHash),
    rarity: equip.flat.rankLevel ?? 1,
    level: equip.weapon.level ?? 1,
    ascension: equip.weapon.promoteLevel ?? 0,
    refinement: refine + 1,
    base_stat: toStat(equip.flat.weaponStats?.[0]),
    sub_stat: toStat(equip.flat.weaponStats?.[1]),
    icon_url: equip.flat.icon ? `${ICON_BASE}/${equip.flat.icon}.png` : "",
  };
}

function buildArtifact(equip: RawEquip, loc: RawLoc): UnifiedGenshinArtifact | null {
  if (!equip.reliquary) return null;
  return {
    id: String(equip.itemId),
    name: locName(loc, equip.flat.nameTextMapHash),
    set_name: locName(loc, equip.flat.setNameTextMapHash),
    slot: ARTIFACT_SLOTS[equip.flat.equipType ?? ""] ?? "flower",
    rarity: equip.flat.rankLevel ?? 1,
    // Enka's raw reliquary.level is 1 higher than the in-game "+N" display.
    level: Math.max(0, (equip.reliquary.level ?? 1) - 1),
    main_stat: toStat(equip.flat.reliquaryMainstat),
    sub_stats: (equip.flat.reliquarySubstats ?? [])
      .map((s) => toStat(s))
      .filter((s): s is UnifiedGenshinStat => s !== null),
    icon_url: equip.flat.icon ? `${ICON_BASE}/${equip.flat.icon}.png` : "",
  };
}

/** Full owned/not-owned roster for a UID, merged against the character catalog.
 *  Cache-first, honoring the `ttl` Enka itself returns for that profile. */
export async function getGenshinRoster(
  env: Env,
  uid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinRoster> {
  const { raw, catalog } = await getUidData(env, uid, ctx, force);

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

  return {
    uid,
    nickname: raw.playerInfo.nickname ?? null,
    player_level: raw.playerInfo.level ?? null,
    partial,
    owned_count: owned.size,
    total_count: characters.length,
    characters,
    updated_at: Date.now(),
  };
}

/** Full detail (level, constellation, weapon, artifacts) for one character.
 *  Returns null if `heroId` isn't a real playable character id at all —
 *  an unowned-but-real character still returns a detail object (with
 *  `owned: false` and empty weapon/artifacts), since that's the normal
 *  shape for a wishlist entry. */
export async function getGenshinCharacterDetail(
  env: Env,
  uid: string,
  heroId: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinCharacterDetail | null> {
  const { raw, catalog, loc } = await getUidData(env, uid, ctx, force);
  const meta = catalog[heroId];
  if (!meta) return null;

  const entry = (raw.playerInfo.avatarInfoList ?? []).find((c) => String(c.avatarId) === heroId);
  const base = {
    id: heroId,
    name: meta.name,
    element: meta.element,
    rarity: meta.rarity,
    icon_url: meta.iconUrl,
    updated_at: Date.now(),
  };

  if (!entry) {
    return { ...base, owned: false, level: null, constellation: 0, friendship: null, weapon: null, artifacts: [] };
  }

  const level = Number(entry.propMap?.["4001"]?.ival ?? 0);
  const weaponEquip = entry.equipList?.find((e) => e.weapon);
  const artifactEquips = (entry.equipList ?? []).filter((e) => e.reliquary);

  return {
    ...base,
    owned: true,
    level,
    constellation: entry.talentIdList?.length ?? 0,
    friendship: entry.fetterInfo?.expLevel ?? null,
    weapon: weaponEquip ? buildWeapon(weaponEquip, loc) : null,
    artifacts: artifactEquips
      .map((e) => buildArtifact(e, loc))
      .filter((a): a is UnifiedGenshinArtifact => a !== null),
  };
}

/** Just the weapon + artifacts for one character. Thin slice of
 *  `getGenshinCharacterDetail` — same cache, no extra upstream cost. */
export async function getGenshinCharacterItems(
  env: Env,
  uid: string,
  heroId: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinCharacterItems | null> {
  const detail = await getGenshinCharacterDetail(env, uid, heroId, ctx, force);
  if (!detail) return null;
  return { weapon: detail.weapon, artifacts: detail.artifacts };
}

/** Just the constellation count/unlock order + friendship level for one
 *  character. Thin slice, same cache as the roster/detail calls. */
export async function getGenshinCharacterConstellations(
  env: Env,
  uid: string,
  heroId: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinCharacterConstellations | null> {
  const { raw, catalog } = await getUidData(env, uid, ctx, force);
  if (!catalog[heroId]) return null;

  const entry = (raw.playerInfo.avatarInfoList ?? []).find((c) => String(c.avatarId) === heroId);
  const unlocked = entry?.talentIdList ?? [];
  return {
    constellation: unlocked.length,
    unlocked_talent_ids: unlocked,
    friendship: entry?.fetterInfo?.expLevel ?? null,
  };
}
