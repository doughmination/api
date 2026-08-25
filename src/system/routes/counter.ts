/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Site visit counters. Mounted at /v2/counter. Replaces /v2/system-data.
 *
 *   GET    /v2/counter                      list every site's counts
 *   GET    /v2/counter/:siteId              read counts (records nothing)
 *   POST   /v2/counter/:siteId              record a visit → updated counts
 *   GET    /v2/counter/:siteId/hit          record a visit via a plain GET
 *   GET    /v2/counter/:siteId/history?days=30   daily histogram
 *   DELETE /v2/counter/:siteId              delete the site   (X-Battery-Key)
 *   POST   /v2/counter/:siteId/reset        zero the counters (X-Battery-Key)
 *
 * A repeat visit from the same person inside VISIT_COOLDOWN_MS is answered
 * with the current counts and `counted: false`, so refreshing doesn't inflate
 * the number. Nothing identifying is stored — see services/counter.ts.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import { verifyBatteryAccess } from "../middleware/auth";
import { counterSiteIds } from "../config";
import { HttpError } from "../errors";
import {
  SITE_ID_RE,
  SiteRejected,
  deleteSite,
  getHistory,
  getStats,
  listSites,
  recordHit,
  resetSite,
} from "../services/counter";

export const counterRoutes = new Hono<Env>();

/** Validate a :siteId path param, 422 if malformed. */
function siteIdOf(raw: string | undefined): string {
  const siteId = (raw ?? "").toLowerCase();
  if (!SITE_ID_RE.test(siteId)) {
    throw new HttpError(
      422,
      "Site id must be 1–64 chars of lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.",
    );
  }
  return siteId;
}

/** SiteRejected carries the reason a site couldn't be created; map it onto a
 *  status the caller can act on (bad id vs. closed counter). */
function rejectionStatus(code: SiteRejected["code"]): number {
  return code === "invalid_site_id" ? 422 : 403;
}

async function hit(c: Context<Env>) {
  const siteId = siteIdOf(c.req.param("siteId"));
  try {
    const result = await recordHit(siteId, c.req.raw, counterSiteIds());
    // Never cached: the whole point is that the next reader sees this visit.
    c.header("Cache-Control", "no-store");
    return c.json(result);
  } catch (err) {
    if (err instanceof SiteRejected) {
      throw new HttpError(rejectionStatus(err.code), err.message);
    }
    throw err;
  }
}

// ---- Public read -----------------------------------------------------------

counterRoutes.get("/", (c) => c.json({ sites: listSites() }));

counterRoutes.get("/:siteId", (c) => {
  const siteId = siteIdOf(c.req.param("siteId"));
  const stats = getStats(siteId);
  if (!stats) throw new HttpError(404, `No counter for site '${siteId}'.`);
  c.header("Cache-Control", "no-store");
  return c.json(stats);
});

counterRoutes.get("/:siteId/history", (c) => {
  const siteId = siteIdOf(c.req.param("siteId"));
  if (!getStats(siteId)) throw new HttpError(404, `No counter for site '${siteId}'.`);
  let days = Number(c.req.query("days") ?? 30);
  if (Number.isNaN(days)) days = 30;
  days = Math.min(400, Math.max(1, Math.trunc(days)));
  return c.json({ site_id: siteId, days, history: getHistory(siteId, days) });
});

// ---- Public write (record a visit) -----------------------------------------

counterRoutes.post("/:siteId", hit);

// The GET twin exists for callers that can't send a POST — a no-JS <img>/beacon
// or a hand-typed URL. Same effect, so it's deliberately not a bare GET on the
// site path (which must stay side-effect free for the read above).
counterRoutes.get("/:siteId/hit", hit);

// ---- Protected admin (X-Battery-Key) ---------------------------------------

counterRoutes.post("/:siteId/reset", verifyBatteryAccess, (c) => {
  const siteId = siteIdOf(c.req.param("siteId"));
  const stats = resetSite(siteId);
  if (!stats) throw new HttpError(404, `No counter for site '${siteId}'.`);
  return c.json({ ok: true, reset: true, ...stats });
});

counterRoutes.delete("/:siteId", verifyBatteryAccess, (c) => {
  const siteId = siteIdOf(c.req.param("siteId"));
  if (!deleteSite(siteId)) throw new HttpError(404, `No counter for site '${siteId}'.`);
  return c.json({ ok: true, site_id: siteId, deleted: true });
});
