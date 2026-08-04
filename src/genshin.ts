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
 * Persistent ownership ledger (the fourth "tier", and the reason this file
 * no longer loses data): every character ever seen owned for a UID is
 * recorded permanently in a NON-expiring KV key (`genshin:owned:<uid>`),
 * separate from the transient caches above. Ownership is monotonic — once a
 * character is in the ledger it stays, even after it drops out of Enka
 * (unpinned from the showcase, "Display all" turned off, profile went
 * private). Every roster/detail response is the UNION of the live Enka data
 * and this ledger: live-owned characters are `tracked: true` with a fresh
 * level; characters known only from the ledger are still `owned: true` but
 * `tracked: false` with their last-known level. If the live Enka fetch fails
 * entirely, the ledger alone is served as a `stale: true` response instead of
 * erroring. This is what stops the API returning partial/no data.
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
/** Persistent per-UID ownership ledger. NO expirationTtl — this key outlives
 *  every cache above and is the source of truth for "has ever been owned". */
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

/** The base Traveler entries (10000005/10000007) come back from Enka's
 *  catalog as a single generic "Traveler" with whatever element their most
 *  recently-used vision happens to be — not the two named, elementless
 *  identities players actually think of them as. Override both explicitly
 *  rather than trusting the catalog for these two ids. */
const TRAVELER_OVERRIDES: Record<string, { name: string; element: string }> = {
  "10000005": { name: "Aether", element: "All" },
  "10000007": { name: "Lumine", element: "All" },
};

/**
 * Some characters ship under an internal dev codename that differs from
 * their public localized name — Enka's catalog can lag behind a reveal (or
 * never get corrected) and resolve `NameTextMapHash` to the codename
 * instead. Applied to whatever name the catalog resolves, regardless of
 * source, so it self-heals once a real `id` override (like
 * `TRAVELER_OVERRIDES` above) can be added.
 *
 * Known case: Sandrone resolves to her Fatui Harbinger codename here.
 */
const NAME_ALIASES: Record<string, string> = {
  Marionette: "Sandrone",
  MarionetteNew: "Sandrone",
};

function resolveDisplayName(rawName: string | undefined): string | undefined {
  if (!rawName) return rawName;
  return NAME_ALIASES[rawName] ?? rawName;
}

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
/** Artifact main stat has a distinct shape from sub/weapon stats — the id
 *  field is called `mainPropId`, not `appendPropId`. */
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

/** Shared by weapon stats, artifact substats, and (via `statFromId`) the
 *  artifact main stat, which uses a differently-shaped raw field. */
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
    // Enka's raw reliquary.level is 1 higher than the in-game "+N" display.
    level: Math.max(0, (equip.reliquary.level ?? 1) - 1),
    main_stat: statFromId(equip.flat.artifactMainData?.mainPropId, equip.flat.artifactMainData?.statValue),
    sub_stats: (equip.flat.reliquarySubStats ?? [])
      .map((s) => toStat(s))
      .filter((s): s is UnifiedGenshinStat => s !== null),
    icon_url: equip.flat.icon ? `${ICON_BASE}/${equip.flat.icon}.png` : "",
  };
}


// ---- Persistent ownership ledger ----------------------------------------
//
// Everything below is the durable, NON-expiring record of what a UID has
// EVER owned. It's deliberately independent of the Enka/catalog caches above:
// those answer "what does Enka show right now", this answers "what does this
// player own, period". The two are unioned when building a response.

/** Don't rewrite the ledger just to bump a `last_seen` more often than this.
 *  Structural changes (a new character, a level-up, a new constellation) still
 *  write immediately; this only throttles no-op "seen again" touches so a
 *  hammered UID doesn't hit KV's per-key write rate limit. */
const LEDGER_TOUCH_MS = 1000 * 60 * 5;

/** One character's entry in the durable ownership ledger. */
interface LedgerEntry {
  /** Highest level ever seen live. */
  level: number;
  /** Highest constellation count ever seen live (0 until a detail/constellation
   *  fetch has ever included this character — the roster list alone can't tell). */
  constellation: number;
  /** Epoch ms first recorded as owned. */
  first_seen: number;
  /** Epoch ms last present in a live Enka response. */
  last_seen: number;
}

/** The full durable ledger for one UID. heroId -> entry. */
interface OwnedLedger {
  uid: string;
  updated_at: number;
  characters: Record<string, LedgerEntry>;
}

/** One currently-live-owned character, as fed into the ledger. `constellation`
 *  is only known from detail/constellation fetches, not the roster list. */
interface LiveOwned {
  id: string;
  level: number;
  constellation?: number;
}

/** Load the durable ledger for a UID, or an empty one if none exists yet. */
async function loadLedger(env: Env, uid: string): Promise<OwnedLedger> {
  const stored = (await env.PROFILE_CACHE.get(ledgerKey(uid), "json")) as OwnedLedger | null;
  if (stored && stored.characters) return stored;
  return { uid, updated_at: 0, characters: {} };
}

/** Persist the ledger under its non-expiring key (note: no expirationTtl). */
async function saveLedger(env: Env, ledger: OwnedLedger, ctx?: ExecutionContext): Promise<void> {
  const write = env.PROFILE_CACHE.put(ledgerKey(ledger.uid), JSON.stringify(ledger));
  if (ctx) ctx.waitUntil(write);
  else await write;
}

/** Upsert every currently-live-owned character into the ledger. Monotonic:
 *  entries are only ever added or bumped upward, never removed or lowered. In
 *  memory each seen entry's `last_seen` is refreshed to `now`; the boolean
 *  return says whether the change is worth persisting (a new/level-up/const
 *  change, or a `last_seen` that's drifted past LEDGER_TOUCH_MS) so callers can
 *  skip redundant KV writes on plain cache-hit reads. */
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

/** Build the unified character list as the UNION of the static catalog, the
 *  live-owned levels (empty when serving stale), and the durable ledger.
 *  Ownership = live OR in-ledger; `tracked` = present in the live data. Call
 *  this AFTER mergeLedger so freshly-seen characters already carry a ledger
 *  entry (and thus an accurate `last_seen`). */
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

/**
 * Look up one character's ownership + level, with the same fallback the
 * roster builder uses: prefer the full detailed `avatarInfoList` (only
 * present if "Display all your characters" is on), else fall back to the
 * pinned `showAvatarInfoList` (up to 8, level only — no equip/talent/fetter
 * data, since Enka never returns that for the lightweight showcase list).
 */
function findOwnedAvatar(
  raw: EnkaUidResponse,
  heroId: string,
): { owned: false } | { owned: true; level: number; detail: EnkaAvatarInfo | null } {
  const full = raw.playerInfo.avatarInfoList;
  if (full && full.length > 0) {
    const entry = full.find((c) => String(c.avatarId) === heroId);
    if (!entry) return { owned: false };
    return { owned: true, level: Number(entry.propMap?.["4001"]?.ival ?? 0), detail: entry };
  }
  const shown = (raw.playerInfo.showAvatarInfoList ?? []).find((c) => String(c.avatarId) === heroId);
  if (!shown) return { owned: false };
  return { owned: true, level: shown.level, detail: null };
}

/** Full owned/not-owned roster for a UID, merged against the character catalog.
 *  Cache-first, honoring the `ttl` Enka itself returns for that profile. */
export async function getGenshinRoster(
  env: Env,
  uid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedGenshinRoster> {
  const ledger = await loadLedger(env, uid);

  // Live Enka fetch. If it fails for ANY reason (private profile, unindexed
  // UID, Enka upstream down) but we've recorded this UID's roster before,
  // serve the ledger alone rather than erroring — see stale branch below.
  let raw: EnkaUidResponse;
  let catalog: Catalog;
  try {
    const data = await getUidData(env, uid, ctx, force);
    raw = data.raw;
    catalog = data.catalog;
  } catch (err) {
    if (Object.keys(ledger.characters).length === 0) throw err; // nothing to fall back to
    // Catalog is Enka-independent (GitHub + KV); if IT is what failed this
    // rethrows and the route surfaces the real error.
    const staleCatalog = await getCatalog(env, ctx);
    const staleChars = buildRosterCharacters(staleCatalog, ledger, new Map());
    return {
      uid,
      nickname: null,
      player_level: null,
      partial: false,
      stale: true,
      owned_count: staleChars.filter((c) => c.owned).length,
      tracked_count: 0, // nothing is live in a stale response
      total_count: staleChars.length,
      characters: staleChars,
      updated_at: ledger.updated_at,
    };
  }

  // Prefer the full roster (only present if the player enabled "Display all
  // your characters"); fall back to the pinned showcase otherwise.
  const full = raw.playerInfo.avatarInfoList;
  const partial = !full || full.length === 0;
  const liveLevels = new Map<string, number>(); // avatarId -> level

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

  // Record everything seen live into the durable ledger (monotonic), then
  // build the response as the union of live data + ledger. Only characters
  // that survive the playable-character catalog filter are fed in.
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
    // Derived from the filtered `characters` list rather than raw map size —
    // Enka's showcase data can include a handful of ids (trial/event NPCs,
    // etc.) that don't survive the playable-character catalog filter, which
    // would otherwise make this count larger than what's actually visible.
    owned_count: characters.filter((c) => c.owned).length,
    tracked_count: characters.filter((c) => c.tracked).length,
    total_count: characters.length,
    characters,
    updated_at: now,
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
    // Enka unavailable. If this character is in the durable ledger, serve it
    // as owned-but-untracked (last-known level/constellation, no live build).
    const led = ledger.characters[heroId];
    const staleCatalog = await getCatalog(env, ctx); // Enka-independent; rethrows if IT failed
    const meta = staleCatalog[heroId];
    if (!meta) return null;
    if (!led) throw err; // real, playable character but nothing owned to fall back to
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
    // Not in the live data — but if the ledger has it, it's still owned, just
    // not currently tracked (unpinned / "Display all" off since we last saw it).
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

  // Record this live sighting (level + constellation) in the durable ledger.
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
  const ledger = await loadLedger(env, uid);

  let raw: EnkaUidResponse;
  let catalog: Catalog;
  try {
    const data = await getUidData(env, uid, ctx, force);
    raw = data.raw;
    catalog = data.catalog;
  } catch (err) {
    // Enka down — fall back to the ledger's last-known constellation count.
    const staleCatalog = await getCatalog(env, ctx);
    if (!staleCatalog[heroId]) return null;
    const led = ledger.characters[heroId];
    if (!led) throw err;
    // No live talentIdList when stale, so unlocked_talent_ids is empty even
    // though `constellation` is the last-known count.
    return { constellation: led.constellation, unlocked_talent_ids: [], friendship: null };
  }

  if (!catalog[heroId]) return null;

  const found = findOwnedAvatar(raw, heroId);
  if (!found.owned) {
    // Owned per the ledger but not live — surface the last-known count.
    const led = ledger.characters[heroId];
    if (led) return { constellation: led.constellation, unlocked_talent_ids: [], friendship: null };
    return { constellation: 0, unlocked_talent_ids: [], friendship: null };
  }

  const unlocked = found.detail?.talentIdList ?? [];

  // Keep the ledger's constellation count current from this live sighting.
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