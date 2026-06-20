/* =====================================================================
 * index.ts — Worker entry: HTTP router + cron keepalive.
 *
 * Routes
 *   GET  /                            service info
 *   GET  /v1/users/:id                unified (presence + profile + badges)
 *   GET  /v1/users/:id/presence       presence only
 *   GET  /v1/users/:id/profile        profile + badges only
 *   GET  /socket                      WebSocket (Lanyard protocol)
 *
 * The Durable Object is a singleton ("gateway") holding the Discord socket.
 * ===================================================================== */

import type { ApiEnvelope, Env, UnifiedPresence, UnifiedRecord } from "./types";
import { getProfile } from "./profile";
import { GatewayManager } from "./gateway";

export { GatewayManager };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json<T>(body: ApiEnvelope<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

function gatewayStub(env: Env): DurableObjectStub {
  return env.GATEWAY.get(env.GATEWAY.idFromName("gateway"));
}

async function fetchPresence(env: Env, id: string): Promise<UnifiedPresence | null> {
  const res = await gatewayStub(env).fetch(`https://do/presence/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { monitored: boolean; presence: UnifiedPresence | null };
  return body.presence;
}

const ID_RE = /^\d{16,21}$/;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ---- WebSocket ----
    if (path === "/socket" || path === "/ws") {
      return gatewayStub(env).fetch(new Request("https://do/ws", req));
    }

    // ---- Gateway status (debug) ----
    if (path === "/status") {
      const res = await gatewayStub(env).fetch("https://do/status");
      const body = await res.json();
      return json({ success: true, data: body as any });
    }

    if (path === "/") {
      return json({
        success: true,
        data: {
          service: "dough-restful",
          description: "Combined Discord presence + profile/badges API.",
          repository_url: "https://git.gay/doughmination/dough-restful",
          endpoints: ["/v1/users/:id", "/v1/users/:id/presence", "/v1/users/:id/profile", "/socket"],
        } as any,
      });
    }

    // ---- /v1/users/:id[/presence|/profile] ----
    const m = path.match(/^\/v1\/users\/(\d{1,32})(?:\/(presence|profile))?$/);
    if (m) {
      const id = m[1];
      const sub = m[2];
      if (!ID_RE.test(id)) {
        return json({ success: false, error: { code: "invalid_id", message: "Not a Discord snowflake." } }, 400);
      }

      // Debug/ops escape hatch: ?fresh=1 (or nocache / refresh) bypasses the
      // profile + per-SKU caches and forces a live re-fetch + re-resolve.
      const force =
        url.searchParams.has("fresh") ||
        url.searchParams.has("nocache") ||
        url.searchParams.has("refresh");

      if (sub === "presence") {
        const presence = await fetchPresence(env, id);
        if (!presence) {
          return json({ success: false, error: { code: "not_monitored", message: "User shares no monitored guild with the bot." } }, 404);
        }
        return json<UnifiedPresence>({ success: true, data: presence });
      }

      if (sub === "profile") {
        const profile = await getProfile(env, id, ctx, force);
        if (!profile) {
          return json({ success: false, error: { code: "not_found", message: "User not found." } }, 404);
        }
        return json({ success: true, data: profile as any });
      }

      // Unified record: profile (REST) + presence (gateway), in parallel.
      const [profile, presence] = await Promise.all([getProfile(env, id, ctx, force), fetchPresence(env, id)]);
      if (!profile) {
        return json({ success: false, error: { code: "not_found", message: "User not found." } }, 404);
      }
      const record: UnifiedRecord = {
        user: profile.user,
        presence,
        badges: profile.badges,
        connected_accounts: profile.connected_accounts,
        wishlist: profile.wishlist ?? null,
        updated_at: Date.now(),
        source: { presence: presence ? "gateway" : "none", profile: profile.source },
      };
      return json<UnifiedRecord>({ success: true, data: record });
    }

    return json({ success: false, error: { code: "not_found", message: "Unknown route." } }, 404);
  },

  // Cron keepalive — make sure the gateway DO is connected.
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await gatewayStub(env).fetch("https://do/connect");
  },
};
