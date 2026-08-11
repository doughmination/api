/* =====================================================================
 * thirdparty/pronoundb.ts — pronouns from PronounDB.
 *
 * pronoundb.org is the pronoun service used by Vencord/Equicord/BetterDiscord.
 * The v2 lookup endpoint keys results by the platform account id and returns
 * pronoun "sets" per locale, e.g. { "<id>": { sets: { en: ["he","him"] } } }.
 * We resolve the English set to a display string ("He/Him"). Cache-first,
 * since this is someone else's service to rate-limit.
 * ===================================================================== */

import type { Env } from "../types";

function apiBase(env: Env): string {
  return (env.PRONOUNDB_API_BASE || "https://pronoundb.org").replace(/\/+$/, "");
}

function cacheKey(id: string): string {
  return `pronoundb:${id}`;
}

const TTL_SECONDS = 3600;

/** PronounDB v2 returns short pronoun codes; most English ones are literal
 *  ("he","him"). These are the special non-literal codes worth expanding. */
const SPECIAL: Record<string, string> = {
  any: "Any pronouns",
  ask: "Ask me",
  avoid: "Avoid pronouns, use my name",
  other: "Other",
  unspecified: "",
};

/** Turn a pronoun set like ["he","him"] into a display string "He/Him". */
function formatSet(set: string[] | undefined): string | null {
  if (!Array.isArray(set) || set.length === 0) return null;
  // A single special code short-circuits to its phrase.
  if (set.length === 1 && SPECIAL[set[0]] !== undefined) {
    return SPECIAL[set[0]] || null;
  }
  const words = set
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .filter(Boolean);
  return words.length ? words.join("/") : null;
}

/** Look up a user's pronouns. Returns the display string, "" style handled as
 *  null, or null when unavailable / not set. */
export async function getPronouns(
  env: Env,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<string | null> {
  if (!force) {
    const cached = await env.PROFILE_CACHE.get(cacheKey(id));
    // We cache the string; an empty string sentinel means "checked, none set".
    if (cached !== null) return cached === "" ? null : cached;
  }

  let value: string | null | undefined;
  try {
    const res = await fetch(`${apiBase(env)}/api/v2/lookup?platform=discord&ids=${id}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) value = null;
    else if (!res.ok) value = undefined;
    else {
      const data = (await res.json()) as Record<string, { sets?: Record<string, string[]> }>;
      const entry = data?.[id];
      value = formatSet(entry?.sets?.en);
    }
  } catch {
    value = undefined; // network error — don't cache
  }

  if (value === undefined) return null;

  const write = env.PROFILE_CACHE.put(cacheKey(id), value ?? "", {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return value;
}
