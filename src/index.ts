/* =====================================================================
 * index.ts — Worker entry: v2 router + cron keepalive.
 *
 * Namespaces
 *   /v2/ws            — the single realtime socket for ALL live updates
 *                       (presence, fronting, mental state, devices)  (SystemState DO)
 *   /v2/lanyard/*     — live presence REST (users / status)
 *   /v2/discord/*     — general Discord info: profile, badges, guilds, girls
 *   /v2/plural/*      — Doughmination system API   (SystemState DO)
 *   /v2/devices/*     — device state (battery, etc.) (SystemState DO)
 *   /v2/guestbook/*   — public guestbook            (SystemState DO)
 *   /v2/system-data/* — visitor logs + viewer      (SystemState DO)
 *   /abuse, /terms, /privacy, /.well-known/security.txt — contact & legal pages
 *   /docs, /openapi.json — API reference (HTML + OpenAPI 3.1)
 *   /v2/health        — liveness for uptime monitors
 *
 * Two Durable Objects:
 *   GATEWAY  — singleton holding the Discord gateway socket (presence). Relays
 *              presence updates to SYSTEM for fan-out; no browser sockets.
 *   SYSTEM   — singleton running the Doughmination API + the single /v2/ws hub.
 * ===================================================================== */

import type {
  ApiEnvelope,
  Env,
  UnifiedPresence,
  UnifiedRecord,
  UnifiedGuildInvite,
  UnifiedGirlsRole,
  UnifiedGirlsMember,
  UnifiedMinecraftGeneral,
  UnifiedMinecraftHypixel,
  VanillaCapeList,
} from "./types";
import { getProfile } from "./profile";
import { GatewayManager } from "./gateway";
import { getGuildInvite } from "./guild";
import { getGirlsResource, isGirlsIdType } from "./girls";
import { getMinecraftGeneral, getMinecraftHypixel, getVanillaCapeList, normalizeMcUuid, MojangUpstreamError } from "./minecraft";
import { getContributions } from "./contribapi";
import { DOCS_HTML } from "./docs";
import { ABUSE_HTML, ABUSE_CONTACT, securityTxt } from "./abuse";
import { TERMS_HTML, PRIVACY_HTML, NOT_FOUND_HTML } from "./pages";
import { OPENAPI_JSON } from "./openapi";
import { SystemState } from "./system/do";

export { GatewayManager, SystemState };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Security headers on every Worker response. HTML pages additionally get a
// CSP: they're fully self-contained (inline style + script, /icon.png), so
// everything else is locked down.
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const HTML_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

function json<T>(body: ApiEnvelope<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...SECURITY_HEADERS },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=3600" : "no-store",
      ...CORS,
      ...HTML_SECURITY_HEADERS,
    },
  });
}

function gatewayStub(env: Env): DurableObjectStub {
  return env.GATEWAY.get(env.GATEWAY.idFromName("gateway"));
}

function systemStub(env: Env): DurableObjectStub {
  return env.SYSTEM.get(env.SYSTEM.idFromName("system"));
}

async function fetchPresence(env: Env, id: string): Promise<UnifiedPresence | null> {
  const res = await gatewayStub(env).fetch(`https://do/presence/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { monitored: boolean; presence: UnifiedPresence | null };
  return body.presence;
}

/** Every monitored presence in one Durable Object round-trip (used by the
 *  batch endpoint so N users cost one DO call instead of N). */
async function fetchAllPresences(env: Env): Promise<Record<string, UnifiedPresence>> {
  const res = await gatewayStub(env).fetch("https://do/presences");
  if (!res.ok) return {};
  return (await res.json()) as Record<string, UnifiedPresence>;
}

/** Merge REST profile + gateway presence into the unified record shape the
 *  website's presence cards consume (identical to the old /v1/users/:id). */
function buildRecord(
  profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>,
  presence: UnifiedPresence | null,
): UnifiedRecord {
  return {
    user: profile.user,
    presence,
    badges: profile.badges,
    clientBadges: profile.clientBadges,
    connected_accounts: profile.connected_accounts,
    wishlist: profile.wishlist ?? null,
    mutual_guilds: profile.mutual_guilds ?? null,
    mutual_friends: profile.mutual_friends ?? null,
    mutual_friends_count: profile.mutual_friends_count ?? null,
    guild_memberships: profile.guild_memberships ?? null,
    pronoundb: profile.pronoundb ?? null,
    timezone: profile.timezone ?? null,
    reviews: profile.reviews ?? null,
    updated_at: Date.now(),
    source: { presence: presence ? "gateway" : "none", profile: profile.source },
  };
}

const ID_RE = /^\d{16,21}$/;

/** Paths owned by the SystemState Durable Object. */
function isSystemPath(path: string): boolean {
  return (
    path === "/v2/ws" ||
    path === "/v2/plural" ||
    path.startsWith("/v2/plural/") ||
    path === "/v2/devices" ||
    path.startsWith("/v2/devices/") ||
    path === "/v2/guestbook" ||
    path.startsWith("/v2/guestbook/") ||
    path === "/v2/system-data" ||
    path.startsWith("/v2/system-data/")
  );
}

/** decodeURIComponent that returns the raw input instead of throwing on a
 *  malformed %-sequence, so a bad path param becomes a clean 400, not a 500. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function wantsForce(url: URL): boolean {
  return (
    url.searchParams.has("fresh") ||
    url.searchParams.has("nocache") ||
    url.searchParams.has("refresh")
  );
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // ---- Enforce HTTPS ---------------------------------------------------
    // Anything arriving over plain http is 301-redirected to the https URL
    // before any routing runs. Cloudflare terminates TLS, so the original
    // client scheme is read from the URL, x-forwarded-proto, or cf-visitor.
    if (isInsecure(req, url)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ---- SystemState DO (plural / devices / system-data / realtime) ------
    // Forwarded first, and untouched, so its Hono CORS + the single realtime
    // WebSocket upgrade (/v2/ws) work end-to-end.
    if (isSystemPath(path)) {
      return systemStub(env).fetch(req);
    }

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // ---- API reference + OpenAPI spec ------------------------------------
    if (path === "/docs") return html(DOCS_HTML);
    if (path === "/openapi.json") {
      return new Response(OPENAPI_JSON, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...CORS, ...SECURITY_HEADERS },
      });
    }

    // ---- Abuse / terms / privacy / security contact ----------------------
    if (path === "/abuse") return html(ABUSE_HTML);
    if (path === "/terms") return html(TERMS_HTML);
    if (path === "/privacy") return html(PRIVACY_HTML);
    if (path === "/.well-known/security.txt" || path === "/security.txt") {
      return new Response(securityTxt(url.origin), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400", ...CORS, ...SECURITY_HEADERS },
      });
    }

    // ---- /v2/health  (liveness for uptime monitors) ----------------------
    // Gateway DO status + SYSTEM DO reachability in parallel. 200 when both
    // are up and the Discord gateway socket is connected, 503 otherwise.
    if (path === "/v2/health") {
      const [gw, sys] = await Promise.all([
        gatewayStub(env)
          .fetch("https://do/status")
          .then((r) => (r.ok ? (r.json() as Promise<{ connected: boolean; tracked: number; connected_since: number | null }>) : null))
          .catch(() => null),
        systemStub(env)
          .fetch("https://do/v2/health-probe") // any response (even 404) proves the DO is up
          .then(() => true)
          .catch(() => false),
      ]);
      const ok = !!gw?.connected && sys;
      return json(
        {
          success: true,
          data: {
            status: ok ? "ok" : "degraded",
            gateway: gw ?? { connected: false },
            system: sys ? "ok" : "unreachable",
            timestamp: Date.now(),
          },
        } as never,
        ok ? 200 : 503,
      );
    }

    // ---- Lanyard gateway status (debug) ----------------------------------
    if (path === "/v2/lanyard/status") {
      const res = await gatewayStub(env).fetch("https://do/status");
      const body = await res.json();
      return json({ success: true, data: body as never });
    }

    // ---- Service info ----------------------------------------------------
    if (path === "/") {
      return json({
        success: true,
        data: {
          service: "Doughmination API",
          description: "Universal API: live Discord presence + profiles + plural system.",
          licence: "ESAL-2.1",
          repository_url: "https://github.com/doughmination/restful",
          docs: "/docs",
          openapi: "/openapi.json",
          health: "/v2/health",
          abuse: "/abuse",
          abuse_contact: ABUSE_CONTACT,
          terms: "/terms",
          privacy: "/privacy",
          security_txt: "/.well-known/security.txt",
        },
      } as never);
    }

    // ---- /v2/contribapi  (merged git contribution heatmaps) --------------
    // Stateless: fetch + merge each configured forge's heatmap. Cached at the
    // edge for an hour since contribution graphs move at most daily.
    if (path === "/v2/contribapi") {
      const data = await getContributions(env);
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...CORS,
        },
      });
    }

    // ---- /v2/discord/guilds/:invite --------------------------------------
    const gm = path.match(/^\/v2\/discord\/guilds\/([\w-]+)$/);
    if (gm) {
      const invite = await getGuildInvite(env, gm[1], ctx, wantsForce(url));
      if (!invite) {
        return json(
          { success: false, error: { code: "not_found", message: "Invalid or expired invite." } },
          404,
        );
      }
      return json<UnifiedGuildInvite>({ success: true, data: invite });
    }

    // ---- /v2/discord/girls/:idType/:id -----------------------------------
    const gr = path.match(/^\/v2\/discord\/girls\/([\w-]+)\/(\d{1,32})$/);
    if (gr) {
      const [, idType, id] = gr;
      if (!isGirlsIdType(idType)) {
        return json(
          {
            success: false,
            error: { code: "invalid_id_type", message: "idType must be one of: role, member." },
          },
          400,
        );
      }
      try {
        const resource = await getGirlsResource(env, idType, id, ctx, wantsForce(url));
        if (!resource) {
          return json(
            { success: false, error: { code: "not_found", message: `No ${idType} with that id.` } },
            404,
          );
        }
        return json<UnifiedGirlsRole | UnifiedGirlsMember>({ success: true, data: resource });
      } catch (err) {
        return json(
          { success: false, error: { code: "misconfigured", message: (err as Error).message } },
          500,
        );
      }
    }

    // ---- /v2/minecraft/capes  (accumulated vanilla cape catalogue) -------
    // Grows as accounts are looked up via /general — every vanilla Mojang cape
    // seen is catalogued once, keyed by texture hash.
    if (path === "/v2/minecraft/capes") {
      const data = await getVanillaCapeList(env);
      return json<VanillaCapeList>({ success: true, data });
    }

    // ---- /v2/minecraft/general/:uuid  (Mojang profile + skin) ------------
    // Just Mojang identity + skin/cape, so callers that only want a skin
    // don't trigger the Hypixel round-trips.
    const mcg = path.match(/^\/v2\/minecraft\/general\/(.+)$/);
    if (mcg) {
      const short = normalizeMcUuid(safeDecode(mcg[1]));
      if (!short) {
        return json(
          { success: false, error: { code: "invalid_uuid", message: "Not a Minecraft UUID (dashed, undashed, or NBT int-array form)." } },
          400,
        );
      }
      try {
        const data = await getMinecraftGeneral(env, short, ctx, wantsForce(url));
        if (!data) {
          return json({ success: false, error: { code: "not_found", message: "No Minecraft account with that UUID." } }, 404);
        }
        return json<UnifiedMinecraftGeneral>({ success: true, data });
      } catch (err) {
        if (err instanceof MojangUpstreamError) {
          return json(
            { success: false, error: { code: "upstream_error", message: err.message } },
            502,
          );
        }
        throw err;
      }
    }

    // ---- /v2/minecraft/hypixel/:uuid  (raw Hypixel + SkyBlock) -----------
    // Only fetched when asked for. Returns 200 even when the player never
    // joined Hypixel — `source` says why each section is null.
    const mch = path.match(/^\/v2\/minecraft\/hypixel\/(.+)$/);
    if (mch) {
      const short = normalizeMcUuid(safeDecode(mch[1]));
      if (!short) {
        return json(
          { success: false, error: { code: "invalid_uuid", message: "Not a Minecraft UUID (dashed, undashed, or NBT int-array form)." } },
          400,
        );
      }
      const data = await getMinecraftHypixel(env, short, ctx, wantsForce(url));
      return json<UnifiedMinecraftHypixel>({ success: true, data });
    }

    // ---- /v2/lanyard/users  (batch presence) -----------------------------
    if (path === "/v2/lanyard/users") {
      const ids = parseIds(url);
      const bad = validateIds(ids);
      if (bad) return bad;

      const presences = await fetchAllPresences(env);
      const data: Record<string, UnifiedPresence | null> = {};
      for (const id of ids) data[id] = presences[id] ?? null;
      return json<Record<string, UnifiedPresence | null>>({ success: true, data });
    }

    // ---- /v2/discord/users  (batch: merged profile + presence) -----------
    // Full user record (profile + badges + live presence) in one round-trip:
    // one DO call for all presences, profiles fetched in parallel (KV-cached).
    if (path === "/v2/discord/users") {
      const ids = parseIds(url);
      const bad = validateIds(ids);
      if (bad) return bad;

      const force = wantsForce(url);
      const [presences, profiles] = await Promise.all([
        fetchAllPresences(env),
        Promise.all(ids.map((id) => getProfile(env, id, ctx, force).catch(() => null))),
      ]);

      const data: Record<string, UnifiedRecord | null> = {};
      ids.forEach((id, i) => {
        const profile = profiles[i];
        data[id] = profile ? buildRecord(profile, presences[id] ?? null) : null;
      });
      return json<Record<string, UnifiedRecord | null>>({ success: true, data });
    }

    // ---- /v2/lanyard/users/:id  (presence) -------------------------------
    const lm = path.match(/^\/v2\/lanyard\/users\/(\d{1,32})$/);
    if (lm) {
      const id = lm[1];
      if (!ID_RE.test(id)) {
        return json({ success: false, error: { code: "invalid_id", message: "Not a Discord snowflake." } }, 400);
      }
      const presence = await fetchPresence(env, id);
      if (!presence) {
        return json(
          {
            success: false,
            error: { code: "not_monitored", message: "User shares no monitored guild with the bot." },
          },
          404,
        );
      }
      return json<UnifiedPresence>({ success: true, data: presence });
    }

    // ---- /v2/discord/users/:id  (merged profile + presence) --------------
    // Profile (REST) + presence (gateway) in parallel — the full user record
    // the website's presence cards render from.
    const dm = path.match(/^\/v2\/discord\/users\/(\d{1,32})$/);
    if (dm) {
      const id = dm[1];
      if (!ID_RE.test(id)) {
        return json({ success: false, error: { code: "invalid_id", message: "Not a Discord snowflake." } }, 400);
      }
      const [profile, presence] = await Promise.all([
        getProfile(env, id, ctx, wantsForce(url)),
        fetchPresence(env, id),
      ]);
      if (!profile) {
        return json({ success: false, error: { code: "not_found", message: "User not found." } }, 404);
      }
      return json<UnifiedRecord>({ success: true, data: buildRecord(profile, presence) });
    }

    // ---- 404 --------------------------------------------------------------
    // Browsers (Accept: text/html) get the friendly page; API clients keep
    // the JSON error envelope.
    if ((req.headers.get("accept") || "").includes("text/html")) {
      return html(NOT_FOUND_HTML, 404);
    }
    return json({ success: false, error: { code: "not_found", message: "Unknown route. See /docs." } }, 404);
  },

  // Cron keepalive — keep the gateway DO connected.
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await gatewayStub(env).fetch("https://do/connect");
  },
};

/** True when the request reached us over plain http (so we should redirect to
 *  https). Cloudflare terminates TLS, so we check the URL scheme plus the
 *  proxy headers that carry the original client scheme. */
function isInsecure(req: Request, url: URL): boolean {
  // Local dev (wrangler / bun dev) has no TLS — never redirect localhost.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") return false;
  if (url.protocol === "http:") return true;
  const xfProto = req.headers.get("x-forwarded-proto");
  if (xfProto && xfProto.split(",")[0].trim().toLowerCase() === "http") return true;
  const visitor = req.headers.get("cf-visitor");
  if (visitor && /"scheme"\s*:\s*"http"/i.test(visitor)) return true;
  return false;
}

function parseIds(url: URL): string[] {
  return Array.from(
    new Set(
      (url.searchParams.get("ids") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** Returns an error Response if the id list is invalid, else null. */
function validateIds(ids: string[]): Response | null {
  if (!ids.length) {
    return json(
      { success: false, error: { code: "missing_ids", message: "Provide ?ids=comma,separated,snowflakes." } },
      400,
    );
  }
  if (ids.length > 100) {
    return json({ success: false, error: { code: "too_many_ids", message: "Maximum 100 ids per request." } }, 400);
  }
  const bad = ids.find((id) => !ID_RE.test(id));
  if (bad) {
    return json({ success: false, error: { code: "invalid_id", message: `Not a Discord snowflake: ${bad}` } }, 400);
  }
  return null;
}
