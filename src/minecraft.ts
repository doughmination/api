/* =====================================================================
 * minecraft.ts — resolve a Minecraft UUID -> profile / Hypixel stats.
 *
 * Split into two endpoints so callers only pay for what they use:
 *   /v2/minecraft/general/:uuid  -> Mojang name + skin/cape textures.
 *   /v2/minecraft/hypixel/:uuid  -> raw Hypixel player + SkyBlock profiles.
 *
 * Hypixel needs an API key (HYPIXEL_API_KEY, sent as the `API-Key` header);
 * without it the Hypixel sections come back null with source "unavailable".
 * Both endpoints are cache-first (~5 min) since the upstreams drift slowly
 * and would rather not be hammered.
 * ===================================================================== */

import type {
  Env,
  MinecraftSourceState,
  UnifiedMinecraftGeneral,
  UnifiedMinecraftHypixel,
} from "./types";

const MOJANG_PROFILE = "https://sessionserver.mojang.com/session/minecraft/profile";
const HYPIXEL_BASE = "https://api.hypixel.net/v2";
const CRAFTHEAD = "https://crafthead.net";
const TTL_SECONDS = 300;
const USER_AGENT = "doughmination-restful/2.0 (+https://doughmination.uk)";

/**
 * Thrown when Mojang answers with something other than "here's the profile"
 * or "no such profile" — e.g. a 429 rate-limit, a 5xx, or a network blip.
 * The caller must NOT turn this into a 404: the account may well exist, Mojang
 * just wouldn't tell us right now. Let the route surface a 502 instead.
 */
export class MojangUpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Mojang sessionserver returned ${status || "a network error"}`);
    this.name = "MojangUpstreamError";
  }
}

/** Strip dashes and lowercase — the form Mojang/Hypixel expect in URLs. */
function undash(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Mojang hands back texture URLs as plain http://textures.minecraft.net/...
 *  The host serves the same bytes over https, so upgrade the scheme to keep
 *  our output uniform (and dodge mixed-content blocking on https callers). */
function httpsify(u: string | null): string | null {
  return u ? u.replace(/^http:\/\//i, "https://") : u;
}

/** Insert dashes into a 32-char hex uuid -> canonical 8-4-4-4-12 form. */
function dash(short: string): string {
  return `${short.slice(0, 8)}-${short.slice(8, 12)}-${short.slice(12, 16)}-${short.slice(16, 20)}-${short.slice(20)}`;
}

/** True for a 32-hex-char uuid with or without dashes. */
export function isMinecraftUuid(uuid: string): boolean {
  return /^[0-9a-fA-F]{32}$/.test(undash(uuid));
}

const generalKey = (short: string) => `minecraft:general:${short}`;
const hypixelKey = (short: string) => `minecraft:hypixel:${short}`;

interface MojangTexturePayload {
  textures?: {
    SKIN?: { url?: string; metadata?: { model?: string } };
    CAPE?: { url?: string };
  };
}

interface MojangProfileResponse {
  id: string;
  name: string;
  properties?: Array<{ name: string; value: string }>;
}

/** Fetch a Hypixel v2 endpoint and unwrap { success, <key> }.
 *  Returns [value, state] where state explains a null value. */
async function fetchHypixel<T>(
  env: Env,
  path: string,
  key: string,
): Promise<[T | null, MinecraftSourceState]> {
  const apiKey = env.HYPIXEL_API_KEY;
  if (!apiKey) return [null, "unavailable"];
  try {
    const res = await fetch(`${HYPIXEL_BASE}${path}`, {
      headers: { "API-Key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) return [null, "error"];
    const body = (await res.json()) as Record<string, unknown> & { success?: boolean };
    if (!body.success) return [null, "error"];
    const value = body[key] as T | null | undefined;
    // Hypixel returns success:true with player:null for accounts that never
    // logged in — treat that as not_found rather than an error.
    if (value === null || value === undefined) return [null, "not_found"];
    return [value, "ok"];
  } catch {
    return [null, "error"];
  }
}

/**
 * Mojang identity + skin/cape for a UUID. Cache-first (~5 min). Returns null
 * only when the UUID doesn't map to a Mojang account (so the caller can 404).
 */
export async function getMinecraftGeneral(
  env: Env,
  uuid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedMinecraftGeneral | null> {
  const short = undash(uuid);

  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(generalKey(short), "json")) as UnifiedMinecraftGeneral | null;
    if (cached) return cached;
  }

  let name: string | null = null;
  let skin_url: string | null = null;
  let cape_url: string | null = null;
  let skin_model: "classic" | "slim" | null = null;

  let res: Response;
  try {
    res = await fetch(`${MOJANG_PROFILE}/${short}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
  } catch {
    // DNS/TLS/connection failure — transient, not a missing account.
    throw new MojangUpstreamError(0);
  }

  // Mojang answers 204 (No Content) or 404 for a UUID that maps to no account.
  // That's the only case where a null (-> 404 to the caller) is correct.
  if (res.status === 204 || res.status === 404) return null;

  // Anything else non-2xx — 429 rate-limit (common from Cloudflare egress IPs),
  // 5xx, etc. — means Mojang wouldn't answer, NOT that the account is gone.
  // Bubble up so the route returns 502 rather than a lying 404.
  if (!res.ok) throw new MojangUpstreamError(res.status);

  let data: MojangProfileResponse;
  try {
    data = (await res.json()) as MojangProfileResponse;
  } catch {
    // 200 with an empty/garbled body — also a Mojang hiccup, not a real 404.
    throw new MojangUpstreamError(res.status);
  }

  name = data.name ?? null;
  const texturesB64 = data.properties?.find((p) => p.name === "textures")?.value;
  if (texturesB64) {
    try {
      const decoded = JSON.parse(atob(texturesB64)) as MojangTexturePayload;
      skin_url = httpsify(decoded.textures?.SKIN?.url ?? null);
      cape_url = httpsify(decoded.textures?.CAPE?.url ?? null);
      if (skin_url) skin_model = decoded.textures?.SKIN?.metadata?.model === "slim" ? "slim" : "classic";
    } catch {
      /* malformed texture blob — leave nulls */
    }
  }

  const result: UnifiedMinecraftGeneral = {
    uuid: dash(short),
    uuid_short: short,
    name,
    skin_url,
    skin_model,
    cape_url,
    render: {
      avatar: `${CRAFTHEAD}/avatar/${short}`,
      head: `${CRAFTHEAD}/head/${short}`,
      body: `${CRAFTHEAD}/body/${short}`,
    },
    updated_at: Date.now(),
  };

  const write = env.PROFILE_CACHE.put(generalKey(short), JSON.stringify(result), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}

/**
 * Raw Hypixel player object + SkyBlock profiles for a UUID. Cache-first
 * (~5 min). Never returns null: Hypixel gaps degrade gracefully via `source`
 * (unavailable / not_found / error), so the caller gets a 200 either way.
 */
export async function getMinecraftHypixel(
  env: Env,
  uuid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedMinecraftHypixel> {
  const short = undash(uuid);

  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(hypixelKey(short), "json")) as UnifiedMinecraftHypixel | null;
    if (cached) return cached;
  }

  const [[player, playerState], [skyblock, skyblockState]] = await Promise.all([
    fetchHypixel<Record<string, unknown>>(env, `/player?uuid=${short}`, "player"),
    fetchHypixel<unknown[]>(env, `/skyblock/profiles?uuid=${short}`, "profiles"),
  ]);

  const result: UnifiedMinecraftHypixel = {
    uuid: dash(short),
    name: (player?.displayname as string | undefined) ?? null,
    player,
    skyblock,
    updated_at: Date.now(),
    source: { player: playerState, skyblock: skyblockState },
  };

  const write = env.PROFILE_CACHE.put(hypixelKey(short), JSON.stringify(result), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}
