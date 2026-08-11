/* genshin.ts */

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
  "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/avatars.json";
const LOC_JSON_URL = "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/locs.json";
const LOC_LEGACY_JSON_URL =
  "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/loc.json";
const ICON_BASE = "https://enka.network/ui";
const ENKA_USER_AGENT = `doughmination-genshin-roster/1.0 (+https://doughmination.uk; contact: ${ABUSE_CONTACT})`;

const CATALOG_TTL_SECONDS = 60 * 60 * 24;
const ROSTER_MIN_TTL_SECONDS = 30;
const CATALOG_KEY = "genshin:catalog:v2";
const LOC_KEY = "genshin:loc:v2";
const rawKey = (uid: string) => `genshin:raw:${uid}`;
const ledgerKey = (uid: string) => `genshin:owned:${uid}`;

const ELEMENT_NAMES: Record<string, string> = {
  Fire: "Pyro",
  Water: "Hydro",
  Wind: "Anemo",
  Electric: "Electro",
  Ice: "Cryo",
  Rock: "Geo",
  Grass: "Dendro",
};

const TRAVELER_OVERRIDES: Record<string, { name: string; element: string }> = {
  "10000005": { name: "Aether", element: "All" },
  "10000007": { name: "Lumine", element: "All" },
};

const NAME_ALIASES: Record<string, string> = {
  Marionette: "Sandrone",
  MarionetteNew: "Sandrone",
};

function resolveDisplayName(rawName: string | undefined): string | undefined {
  if (!rawName) return rawName;
  return NAME_ALIASES[rawName] ?? rawName;
}

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
type RawLoc = Record<string, Record<string, string>>;

interface RawStat {
  appendPropId?: string;
  statValue?: number;
}

interface RawArtifactMainStat {
  mainPropId?: string;
  statValue?: number;
}

interface RawFlat {
  nameTextMapHash?: number | string;
  setNameTextMapHash?: number | string;
  rankLevel?: number;
  icon?: string;
  weaponStats?: RawStat[];
  artifactMainData?: RawArtifactMainStat;
  reliquarySubStats?: RawStat[];
  equipType?: string;
}

interface RawWeaponData {
  level?: number;
  promoteLevel?: number;
  affixMap?: Record<string, number>;
}

interface RawReliquaryData {
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
  talentIdList?: number[];
  fetterInfo?: { expLevel?: number };
  equipList?: RawEquip[];
}

interface EnkaUidResponse {
  playerInfo: {
    nickname?: string;
    level?: number;
    showAvatarInfoList?: EnkaShowAvatar[];
  };
  // Top level, NOT under playerInfo.
  avatarInfoList?: EnkaAvatarInfo[];
  ttl?: number;
}

function isPlayableId(id: string, entry: RawCharacterEntry): boolean {
  if (!entry || !entry.QualityType) return false;
  if (id.includes("-")) return false;
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  if (n >= 11000000) return false;
  if (n >= 10000900 && n < 10001000) return false;
  return true;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": ENKA_USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream ${url} returned ${res.status}`);
  return (await res.json()) as T;
}

async function getLoc(env: Env, ctx?: ExecutionContext, force = false): Promise<RawLoc> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(LOC_KEY, "json")) as RawLoc | null;
    if (cached) return cached;
  }
  const [modern, legacy] = await Promise.all([
    fetchJson<RawLoc>(LOC_JSON_URL),
    fetchJson<RawLoc>(LOC_LEGACY_JSON_URL).catch(() => ({}) as RawLoc),
  ]);
  const merged: RawLoc = {};
  for (const lang of new Set([...Object.keys(legacy), ...Object.keys(modern)])) {
    merged[lang] = { ...(legacy[lang] ?? {}), ...(modern[lang] ?? {}) };
  }
  const write = env.PROFILE_CACHE.put(LOC_KEY, JSON.stringify(merged), { expirationTtl: CATALOG_TTL_SECONDS });
  if (ctx) ctx.waitUntil(write);
  else await write;
  return merged;
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

function iconStem(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  if (s.toLowerCase().endsWith(".png")) s = s.slice(0, -4);
  return s;
}

const INJECTED_CHARACTERS: Record<string, CatalogEntry> = {
  "10000117": {
    name: "Manekin",
    element: "All",
    rarity: 5,
    iconUrl: `${ICON_BASE}/UI_AvatarIcon_MannequinBoy.png`,
    sideIconUrl: `${ICON_BASE}/UI_AvatarIcon_Side_MannequinBoy.png`,
  },
  "10000118": {
    name: "Manekina",
    element: "All",
    rarity: 5,
    iconUrl: `${ICON_BASE}/UI_AvatarIcon_MannequinGirl.png`,
    sideIconUrl: `${ICON_BASE}/UI_AvatarIcon_Side_MannequinGirl.png`,
  },
};

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
    const sideIcon = iconStem(entry.SideIconName);
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

  for (const [id, entry] of Object.entries(INJECTED_CHARACTERS)) {
    if (!catalog[id]) catalog[id] = entry;
  }

  const write = env.PROFILE_CACHE.put(CATALOG_KEY, JSON.stringify(catalog), {
    expirationTtl: CATALOG_TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return catalog;
}

export class EnkaNotFoundError extends Error {
  constructor(uid: string) {
    super(`No Enka.Network record for UID ${uid}`);
    this.name = "EnkaNotFoundError";
  }
}

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

function statFromId(id: string | undefined, value: number | undefined): UnifiedGenshinStat | null {
  if (!id) return null;
  return {
    name: STAT_NAMES[id] ?? id,
    value: value ?? 0,
    is_percent: PERCENT_STAT_IDS.has(id),
  };
}

function toStat(raw: RawStat | undefined): UnifiedGenshinStat | null {
  return raw ? statFromId(raw.appendPropId, raw.statValue) : null;
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
    // Raw reliquary.level is 1 higher than the in-game "+N".
    level: Math.max(0, (equip.reliquary.level ?? 1) - 1),
    main_stat: statFromId(equip.flat.artifactMainData?.mainPropId, equip.flat.artifactMainData?.statValue),
    sub_stats: (equip.flat.reliquarySubStats ?? [])
      .map((s) => toStat(s))
      .filter((s): s is UnifiedGenshinStat => s !== null),
    icon_url: equip.flat.icon ? `${ICON_BASE}/${equip.flat.icon}.png` : "",
  };
}

const LEDGER_TOUCH_MS = 1000 * 60 * 5;

interface LedgerEntry {
  level: number;
  constellation: number;
  first_seen: number;
  last_seen: number;
}

interface OwnedLedger {
  uid: string;
  updated_at: number;
  characters: Record<string, LedgerEntry>;
}

interface LiveOwned {
  id: string;
  level: number;
  constellation?: number;
}

async function loadLedger(env: Env, uid: string): Promise<OwnedLedger> {
  const stored = (await env.PROFILE_CACHE.get(ledgerKey(uid), "json")) as OwnedLedger | null;
  if (stored && stored.characters) return stored;
  return { uid, updated_at: 0, characters: {} };
}

async function saveLedger(env: Env, ledger: OwnedLedger, ctx?: ExecutionContext): Promise<void> {
  const write = env.PROFILE_CACHE.put(ledgerKey(ledger.uid), JSON.stringify(ledger));
  if (ctx) ctx.waitUntil(write);
  else await write;
}

function mergeLedger(ledger: OwnedLedger, live: LiveOwned[], now: number): boolean {
  let changed = false;
  for (const c of live) {
    const existing = ledger.characters[c.id];
    if (!existing) {
      ledger.characters[c.id] = {
        level: c.level,
        constellation: c.constellation ?? 0,
        first_seen: now,
        last_seen: now,
      };
      changed = true;
      continue;
    }
    if (c.level > existing.level) {
      existing.level = c.level;
      changed = true;
    }
    if (c.constellation != null && c.constellation > existing.constellation) {
      existing.constellation = c.constellation;
      changed = true;
    }
    if (now - existing.last_seen > LEDGER_TOUCH_MS) changed = true;
    existing.last_seen = now;
  }
  if (changed) ledger.updated_at = now;
  return changed;
}

function buildRosterCharacters(
  catalog: Catalog,
  ledger: OwnedLedger,
  liveLevels: Map<string, number>,
): UnifiedGenshinCharacter[] {
  const characters = Object.entries(catalog).map(([id, meta]) => {
    const led = ledger.characters[id];
    const isLive = liveLevels.has(id);
    return {
      id,
      name: meta.name,
      element: meta.element,
      rarity: meta.rarity,
      icon_url: meta.iconUrl,
      owned: isLive || !!led,
      level: isLive ? liveLevels.get(id)! : led ? led.level : null,
      tracked: isLive,
      last_seen: led ? led.last_seen : null,
    };
  });
  characters.sort((a, b) => (b.owned === a.owned ? a.name.localeCompare(b.name) : b.owned ? 1 : -1));
  return characters;
}

function findOwnedAvatar(
  raw: EnkaUidResponse,
  heroId: string,
): { owned: false } | { owned: true; level: number; detail: EnkaAvatarInfo | null } {
  const full = raw.avatarInfoList;
  if (full && full.length > 0) {
    const entry = full.find((c) => String(c.avatarId) === heroId);
    if (!entry) return { owned: false };
    return { owned: true, level: Number(entry.propMap?.["4001"]?.ival ?? 0), detail: entry };
  }
  const shown = (raw.playerInfo.showAvatarInfoList ?? []).find((c) => String(c.avatarId) === heroId);
  if (!shown) return { owned: false };
  return { owned: true, level: shown.level, detail: null };
}

export async function getGenshinRoster(
  env: Env,
  uid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinRoster> {
  const ledger = await loadLedger(env, uid);

  let raw: EnkaUidResponse;
  let catalog: Catalog;
  try {
    const data = await getUidData(env, uid, ctx, force);
    raw = data.raw;
    catalog = data.catalog;
  } catch (err) {
    if (Object.keys(ledger.characters).length === 0) throw err;
    const staleCatalog = await getCatalog(env, ctx);
    const staleChars = buildRosterCharacters(staleCatalog, ledger, new Map());
    return {
      uid,
      nickname: null,
      player_level: null,
      partial: false,
      stale: true,
      owned_count: staleChars.filter((c) => c.owned).length,
      tracked_count: 0,
      total_count: staleChars.length,
      characters: staleChars,
      updated_at: ledger.updated_at,
    };
  }

  const full = raw.avatarInfoList;
  const partial = !full || full.length === 0;
  const liveLevels = new Map<string, number>();

  if (full) {
    for (const c of full) {
      const level = Number(c.propMap?.["4001"]?.ival ?? 0);
      liveLevels.set(String(c.avatarId), level);
    }
  } else {
    for (const c of raw.playerInfo.showAvatarInfoList ?? []) {
      liveLevels.set(String(c.avatarId), c.level);
    }
  }

  const now = Date.now();
  const live: LiveOwned[] = [];
  for (const [id, level] of liveLevels) if (catalog[id]) live.push({ id, level });
  if (mergeLedger(ledger, live, now)) await saveLedger(env, ledger, ctx);

  const characters = buildRosterCharacters(catalog, ledger, liveLevels);

  return {
    uid,
    nickname: raw.playerInfo.nickname ?? null,
    player_level: raw.playerInfo.level ?? null,
    partial,
    stale: false,
    owned_count: characters.filter((c) => c.owned).length,
    tracked_count: characters.filter((c) => c.tracked).length,
    total_count: characters.length,
    characters,
    updated_at: now,
  };
}

export async function getGenshinCharacterDetail(
  env: Env,
  uid: string,
  heroId: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinCharacterDetail | null> {
  const ledger = await loadLedger(env, uid);

  let raw: EnkaUidResponse;
  let catalog: Catalog;
  let loc: RawLoc;
  try {
    const data = await getUidData(env, uid, ctx, force);
    raw = data.raw;
    catalog = data.catalog;
    loc = data.loc;
  } catch (err) {
    const led = ledger.characters[heroId];
    const staleCatalog = await getCatalog(env, ctx);
    const meta = staleCatalog[heroId];
    if (!meta) return null;
    if (!led) throw err;
    return {
      id: heroId,
      name: meta.name,
      element: meta.element,
      rarity: meta.rarity,
      icon_url: meta.iconUrl,
      owned: true,
      tracked: false,
      last_seen: led.last_seen,
      level: led.level,
      constellation: led.constellation,
      friendship: null,
      weapon: null,
      artifacts: [],
      updated_at: ledger.updated_at,
    };
  }

  const meta = catalog[heroId];
  if (!meta) return null;

  const base = {
    id: heroId,
    name: meta.name,
    element: meta.element,
    rarity: meta.rarity,
    icon_url: meta.iconUrl,
    updated_at: Date.now(),
  };

  const found = findOwnedAvatar(raw, heroId);
  if (!found.owned) {
    const led = ledger.characters[heroId];
    if (led) {
      return {
        ...base,
        owned: true,
        tracked: false,
        last_seen: led.last_seen,
        level: led.level,
        constellation: led.constellation,
        friendship: null,
        weapon: null,
        artifacts: [],
      };
    }
    return {
      ...base,
      owned: false,
      tracked: false,
      last_seen: null,
      level: null,
      constellation: 0,
      friendship: null,
      weapon: null,
      artifacts: [],
    };
  }

  const entry = found.detail;
  const constellation = entry?.talentIdList?.length ?? 0;

  const now = Date.now();
  if (mergeLedger(ledger, [{ id: heroId, level: found.level, constellation }], now)) {
    await saveLedger(env, ledger, ctx);
  }

  const weaponEquip = entry?.equipList?.find((e) => e.weapon);
  const artifactEquips = (entry?.equipList ?? []).filter((e) => e.reliquary);

  return {
    ...base,
    owned: true,
    tracked: true,
    last_seen: now,
    level: found.level,
    constellation,
    friendship: entry?.fetterInfo?.expLevel ?? null,
    weapon: weaponEquip ? buildWeapon(weaponEquip, loc) : null,
    artifacts: artifactEquips
      .map((e) => buildArtifact(e, loc))
      .filter((a): a is UnifiedGenshinArtifact => a !== null),
  };
}

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

export async function getGenshinCharacterConstellations(
  env: Env,
  uid: string,
  heroId: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinCharacterConstellations | null> {
  const ledger = await loadLedger(env, uid);

  let raw: EnkaUidResponse;
  let catalog: Catalog;
  try {
    const data = await getUidData(env, uid, ctx, force);
    raw = data.raw;
    catalog = data.catalog;
  } catch (err) {
    const staleCatalog = await getCatalog(env, ctx);
    if (!staleCatalog[heroId]) return null;
    const led = ledger.characters[heroId];
    if (!led) throw err;
    return { constellation: led.constellation, unlocked_talent_ids: [], friendship: null };
  }

  if (!catalog[heroId]) return null;

  const found = findOwnedAvatar(raw, heroId);
  if (!found.owned) {
    const led = ledger.characters[heroId];
    if (led) return { constellation: led.constellation, unlocked_talent_ids: [], friendship: null };
    return { constellation: 0, unlocked_talent_ids: [], friendship: null };
  }

  const unlocked = found.detail?.talentIdList ?? [];

  const now = Date.now();
  if (mergeLedger(ledger, [{ id: heroId, level: found.level, constellation: unlocked.length }], now)) {
    await saveLedger(env, ledger, ctx);
  }

  return {
    constellation: unlocked.length,
    unlocked_talent_ids: unlocked,
    friendship: found.detail?.fetterInfo?.expLevel ?? null,
  };
}
