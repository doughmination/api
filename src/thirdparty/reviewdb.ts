/* =====================================================================
 * thirdparty/reviewdb.ts — user reviews/reputation from ReviewDB.
 *
 * ReviewDB (used by the Vencord/Equicord "ReviewDB" plugin) lets people leave
 * reviews on a user's Discord profile. GET /users/:id/reviews returns the
 * reviews left *on* that user, already resolved with sender info. We flatten
 * them into a small summary. Cache-first; someone else's service to throttle.
 * ===================================================================== */

import type { Env, UnifiedReview, UnifiedReviews } from "../types";

function apiBase(env: Env): string {
  return (env.REVIEWDB_API_BASE || "https://manti.vendicated.dev/api/reviewdb").replace(/\/+$/, "");
}

function maxReviews(env: Env): number {
  return Math.max(1, Math.min(100, Number(env.REVIEWDB_MAX || "25")));
}

function cacheKey(id: string): string {
  return `reviewdb:${id}`;
}

const TTL_SECONDS = 1800; // reviews trickle in; half an hour is fine

interface RawReview {
  id?: number;
  comment?: string;
  star?: number;
  type?: number;
  timestamp?: number | string;
  sender?: {
    discordID?: string;
    username?: string;
    profilePhoto?: string;
    badges?: unknown[];
  };
}

interface RawReviewsResponse {
  reviews?: RawReview[];
  reviewCount?: number;
  // some deployments return a bare array
}

/** Normalize a ReviewDB timestamp (unix seconds or ISO) to ISO 8601. */
function toIso(ts: number | string | undefined): string | null {
  if (ts == null) return null;
  if (typeof ts === "number") {
    // seconds if it looks like a 10-digit epoch, else ms
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function mapReview(r: RawReview): UnifiedReview {
  const s = r.sender || {};
  return {
    id: typeof r.id === "number" ? r.id : null,
    comment: typeof r.comment === "string" ? r.comment : "",
    sender_id: typeof s.discordID === "string" ? s.discordID : null,
    sender_username: typeof s.username === "string" ? s.username : null,
    sender_avatar_url: typeof s.profilePhoto === "string" ? s.profilePhoto : null,
    type: typeof r.type === "number" ? r.type : null,
    timestamp: toIso(r.timestamp),
  };
}

export async function getReviews(
  env: Env,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedReviews | null> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(cacheKey(id), "json")) as UnifiedReviews | null;
    if (cached) return cached;
  }

  let result: UnifiedReviews | null | undefined;
  try {
    const res = await fetch(`${apiBase(env)}/users/${id}/reviews`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) result = { count: 0, reviews: [] };
    else if (!res.ok) result = undefined;
    else {
      const data = (await res.json()) as RawReviewsResponse | RawReview[];
      const arr = Array.isArray(data) ? data : Array.isArray(data.reviews) ? data.reviews : [];
      const reviews = arr
        .filter((r) => r && (r.comment || r.sender))
        .slice(0, maxReviews(env))
        .map(mapReview);
      const count =
        !Array.isArray(data) && typeof data.reviewCount === "number" ? data.reviewCount : reviews.length;
      result = { count, reviews };
    }
  } catch {
    result = undefined;
  }

  if (result === undefined) return null;

  const write = env.PROFILE_CACHE.put(cacheKey(id), JSON.stringify(result), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}
