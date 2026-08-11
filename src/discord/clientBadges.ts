/* =====================================================================
 * discord/clientBadges.ts — third-party client-mod badges.
 *
 * badges.equicord.org aggregates badges from Vencord, Equicord, Aliucord,
 * and a bunch of other client mods (Nekocord, ReviewDB, BadgeVault, Aero,
 * Raincord, Velocity, Enmity, Replugged, Paicord) into one "global badges"
 * style response. We just hit the plain GET /:userId (no query params) —
 * that's already the combined view across every service — and cache it,
 * since none of this is ours to rate-limit.
 *
 * This is intentionally kept separate from `badges` (Discord's own
 * flags/profile badges): different source, different trust level, and the
 * caller asked for it to live at `data.clientBadges` instead.
 * ===================================================================== */

import type { Env, UnifiedClientBadge } from "../types";

const API_BASE = "https://badges.equicord.org";

interface EquibadgesResponse {
  status: number;
  /** Flat array (no `separated` query) — one list across all services. */
  badges: { tooltip: string; badge: string }[];
}

function cacheKey(id: string): string {
  return `clientbadges:${id}`;
}

/** Cache freshness window — these change rarely, so an hour is plenty. */
const TTL_SECONDS = 3600;

/**
 * Fetch a user's third-party client-mod badges, cache-first.
 * Returns [] when the user has none, null when the aggregator couldn't be
 * reached and there's nothing usable cached either.
 */
export async function getClientBadges(
  env: Env,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedClientBadge[] | null> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(cacheKey(id), "json")) as
      | UnifiedClientBadge[]
      | null;
    if (cached) return cached;
  }

  const fetched = await fetchClientBadges(id);

  // 404 ("no badges found") is a valid, cacheable empty result — only a
  // genuine fetch failure (network error, 5xx, etc.) should fall through.
  if (fetched === undefined) {
    if (force) {
      // Caller explicitly asked for a fresh fetch; fall back to whatever's
      // cached (even if stale) rather than returning null outright.
      const stale = (await env.PROFILE_CACHE.get(cacheKey(id), "json")) as
        | UnifiedClientBadge[]
        | null;
      return stale ?? null;
    }
    return null;
  }

  const write = env.PROFILE_CACHE.put(cacheKey(id), JSON.stringify(fetched), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return fetched;
}

/** Returns the badge list, [] for none, or undefined on a fetch failure. */
async function fetchClientBadges(id: string): Promise<UnifiedClientBadge[] | undefined> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${id}`, { signal: AbortSignal.timeout(5000) });
  } catch {
    return undefined;
  }

  if (res.status === 404) return [];
  if (!res.ok) return undefined;

  let data: EquibadgesResponse;
  try {
    data = (await res.json()) as EquibadgesResponse;
  } catch {
    return undefined;
  }

  if (!Array.isArray(data.badges)) return [];

  return data.badges
    .filter((b) => b && typeof b.badge === "string")
    // The aggregator also throws in official Discord badges (HypeSquad,
    // Nitro, etc) under /public/badges/discord/. Those already live in
    // `data.badges` via Discord's own flags, so drop them here to avoid
    // duplicating them under clientBadges.
    .filter((b) => !/\/public\/badges\/discord\//i.test(b.badge))
    .map((b) => {
      const tooltip = typeof b.tooltip === "string" ? b.tooltip : "";
      return {
        id: badgeId(tooltip, b.badge),
        tooltip,
        icon_url: b.badge,
        source: sourceForIconUrl(b.badge),
      };
    });
}

/**
 * Host -> display-name table. The equicord endpoint aggregates several
 * underlying services, and the only thing in the response that tells us
 * which one a given badge actually came from is the hostname of its icon
 * URL. Add new services here as we spot them in the wild — anything not
 * listed falls back to "Equicord" (the aggregator's own native badges,
 * e.g. /public/badges/equicord.png, live on that host too).
 *
 * Still TBD / not yet seen in a sample response: ReviewDB, Aero, Aliucord,
 * Raincord, Velocity, Enmity, Replugged, Paicord.
 */
const SOURCE_BY_HOST: Record<string, string> = {
  "gb.obamabot.me": "BadgeVault",
  "nekocord.dev": "Nekocord",
  "badges.vencord.dev": "Vencord",
  "badges.equicord.org": "Equicord",
  "cdn.nest.rip": "Nekocord",
  "reviewdb.mant.gg": "ReviewDB",
  "manti.vendicated.dev": "ReviewDB",
  "aliucord.com": "Aliucord",
  "cdn.aliucord.com": "Aliucord",
  "enmity.app": "Enmity",
  "files.enmity.app": "Enmity",
  "replugged.dev": "Replugged",
  "cdn.replugged.dev": "Replugged",
  "clientmodbadges.raincord.org": "Raincord",
  "velocity.gg": "Velocity",
  "paincord.xyz": "Paicord",
  "i.imgur.com": "GlobalBadges",
};

/** Falls back to "Equicord" for unknown/malformed hosts. */
function sourceForIconUrl(iconUrl: string): string {
  try {
    const host = new URL(iconUrl).hostname;
    return SOURCE_BY_HOST[host] ?? "Equicord";
  } catch {
    return "Equicord";
  }
}

/**
 * Human-readable id for a badge — the upstream API has no id field of its
 * own (these are arbitrary per-user badges, not a fixed catalog), so we
 * build one from the originating service + tooltip, e.g.
 * "GlobalBadges - Moffman" or "Equicord - Equicord Contributor".
 *
 * Note: this is NOT guaranteed unique — two badges from the same service
 * with the same tooltip text collide. Fine for display/grouping; if exact
 * per-badge identity is ever needed, icon_url is the only unique field.
 */
function badgeId(tooltip: string, iconUrl: string): string {
  return `${sourceForIconUrl(iconUrl)} - ${tooltip}`;
}