/* =====================================================================
 * cloudflare.ts — nuke ALL Cloudflare cache.
 *
 * purgeAllCache() lists every zone the CF_API_TOKEN can see (which spans
 * every account the token has access to, including the one that owns this
 * Worker) and issues `purge_everything` against each. Powers /v2/burst.
 *
 * Token permissions required (single token):
 *   - Zone → Zone      : Read          (to enumerate every zone)
 *   - Zone → Cache Purge: Purge         (to purge each zone)
 * Create it at: My Profile → API Tokens → Create Token. Then set it as a
 * secret:  wrangler secret put CF_API_TOKEN
 * ===================================================================== */

import type { Env } from "./types";

const CF_API = "https://api.cloudflare.com/client/v4";

/** Outcome of a burst: ok + how many zones were purged, or the first error. */
export interface BurstResult {
  ok: boolean;
  error?: string;
  purged: number;
  total: number;
}

interface CfZone {
  id: string;
  name: string;
}

interface CfError {
  code?: number;
  message?: string;
}

interface CfResultInfo {
  page?: number;
  total_pages?: number;
}

interface CfListResponse {
  success: boolean;
  errors?: CfError[];
  result?: CfZone[];
  result_info?: CfResultInfo;
}

interface CfMutResponse {
  success: boolean;
  errors?: CfError[];
}

/** First human-readable message out of a CF error envelope, if any. */
function cfErr(body: { errors?: CfError[] }): string | null {
  const first = body.errors?.[0];
  if (!first) return null;
  return first.message ?? (first.code != null ? `code ${first.code}` : null);
}

/**
 * Purge everything, everywhere. Stops at the first failure and reports it so
 * the caller can surface `code: {error}`. Any thrown network error is caught
 * by the route and turned into the same envelope.
 */
export async function purgeAllCache(env: Env): Promise<BurstResult> {
  const token = env.CF_API_TOKEN;
  if (!token) {
    return { ok: false, error: "CF_API_TOKEN is not configured", purged: 0, total: 0 };
  }

  const auth = { Authorization: `Bearer ${token}` };

  // 1. Enumerate every zone across every account this token can reach.
  const zones: CfZone[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${CF_API}/zones?per_page=50&page=${page}`, { headers: auth });
    const body = (await res.json()) as CfListResponse;
    if (!res.ok || !body.success) {
      return {
        ok: false,
        error: cfErr(body) ?? `zone list failed (HTTP ${res.status})`,
        purged: 0,
        total: zones.length,
      };
    }
    for (const z of body.result ?? []) zones.push({ id: z.id, name: z.name });

    const totalPages = body.result_info?.total_pages ?? page;
    if (page >= totalPages || (body.result?.length ?? 0) === 0) break;
    page++;
  }

  if (zones.length === 0) {
    return { ok: false, error: "no zones visible to CF_API_TOKEN", purged: 0, total: 0 };
  }

  // 2. Purge everything on each zone. First failure aborts and is reported.
  let purged = 0;
  for (const z of zones) {
    const res = await fetch(`${CF_API}/zones/${z.id}/purge_cache`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ purge_everything: true }),
    });
    const body = (await res.json()) as CfMutResponse;
    if (!res.ok || !body.success) {
      return {
        ok: false,
        error: `${z.name}: ${cfErr(body) ?? `HTTP ${res.status}`}`,
        purged,
        total: zones.length,
      };
    }
    purged++;
  }

  return { ok: true, purged, total: zones.length };
}
