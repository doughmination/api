/* =====================================================================
 * thirdparty/timezone.ts — user timezone from the client-mod Timezones plugin.
 *
 * The Vencord/Equicord "Timezones" plugin lets users publish their IANA
 * timezone to a community backend (default: timezone.creations.works). Given
 * a Discord id we ask that backend for the user's timezone, then compute their
 * current local time + UTC offset at read time. Backend URL + response shape
 * vary between forks, so the base is configurable and parsing is defensive.
 * Cache-first — the timezone itself changes rarely (the *local time* we
 * recompute fresh on every read, so the cache only stores the zone id).
 * ===================================================================== */

import type { Env, UnifiedTimezone } from "../types";

function apiBase(env: Env): string {
  return (env.TIMEZONE_API_BASE || "https://timezone.creations.works").replace(/\/+$/, "");
}

function cacheKey(id: string): string {
  return `timezone:${id}`;
}

const TTL_SECONDS = 86400; // the zone id is stable; a day is plenty

/** Pull an IANA timezone string out of whatever shape the backend returned. */
function extractZone(data: unknown, id: string): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (data && typeof data === "object") {
    const o = data as Record<string, any>;
    // Common shapes: { timezone }, { value }, { <id>: "Zone" }, { <id>: { value }}.
    const direct = o.timezone ?? o.value ?? o.tz ?? null;
    if (typeof direct === "string" && direct) return direct;
    const byId = o[id];
    if (typeof byId === "string" && byId) return byId;
    if (byId && typeof byId === "object") {
      const v = byId.value ?? byId.timezone ?? byid_str(byId);
      if (typeof v === "string" && v) return v;
    }
  }
  return null;
}
function byid_str(o: Record<string, any>): string | null {
  return typeof o.tz === "string" ? o.tz : null;
}

/** Validate a zone id by trying to format with it; returns offset minutes. */
function computeLocal(zone: string): { local_time: string | null; utc_offset_minutes: number | null } {
  try {
    const now = new Date();
    // Offset: compare the same instant formatted in the zone vs UTC.
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUTC = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") === 24 ? 0 : get("hour"),
      get("minute"),
      get("second")
    );
    const offsetMin = Math.round((asUTC - now.getTime()) / 60000);
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    // Build an ISO-ish local timestamp with the computed offset.
    const y = get("year");
    const mo = String(get("month")).padStart(2, "0");
    const d = String(get("day")).padStart(2, "0");
    const h = String(get("hour") === 24 ? 0 : get("hour")).padStart(2, "0");
    const mi = String(get("minute")).padStart(2, "0");
    const s = String(get("second")).padStart(2, "0");
    return {
      local_time: `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`,
      utc_offset_minutes: offsetMin,
    };
  } catch {
    return { local_time: null, utc_offset_minutes: null };
  }
}

export async function getTimezone(
  env: Env,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedTimezone | null> {
  let zone: string | null | undefined;

  if (!force) {
    const cached = await env.PROFILE_CACHE.get(cacheKey(id));
    if (cached !== null) zone = cached === "" ? null : cached;
  }

  if (zone === undefined) {
    try {
      const res = await fetch(`${apiBase(env)}/get?id=${id}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 404) zone = null;
      else if (!res.ok) zone = undefined;
      else {
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* leave as raw text */
        }
        zone = extractZone(parsed, id);
      }
    } catch {
      zone = undefined;
    }

    if (zone !== undefined) {
      const write = env.PROFILE_CACHE.put(cacheKey(id), zone ?? "", {
        expirationTtl: TTL_SECONDS,
      });
      if (ctx) ctx.waitUntil(write);
      else await write;
    }
  }

  if (!zone) return null;
  return { timezone: zone, ...computeLocal(zone) };
}
