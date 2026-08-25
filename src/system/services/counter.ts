/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Per-site visit counters, backed by the SystemState DO's embedded SQLite
 * (`rt().sql`). Replaces the old visitor-log system, which stored full
 * request headers, cookies and raw IPs for every hit.
 *
 * The counter deliberately stores NO personal data. A visitor is identified
 * only by a SHA-256 of `siteId | per-site random salt | ip | user-agent`.
 * The salt is generated when the site row is created and never leaves the
 * DO, so the hashes can't be reversed into IPs or correlated across sites.
 *
 * Three tables:
 *   counter_sites     one row per site: running total + its salt
 *   counter_visitors  one row per (site, visitor hash): all-time unique set
 *   counter_days      one row per (site, UTC day): the daily histogram
 */

import { rt } from "../runtime";

function db(): SqlStorage {
  return rt().sql;
}

/** A site id is a short, lowercase, DNS-ish slug — e.g. "is.doughmination.gay". */
export const SITE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * A repeat hit from the same visitor within this window does not move the
 * total. Without it a held-down F5 inflates the count without limit; with it
 * the number means "visits" rather than "page loads".
 */
export const VISIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/** Safety valve on auto-created sites, so an open endpoint can't be used to
 *  fill the DO with junk site rows. Ignored when COUNTER_SITE_IDS is set. */
export const MAX_SITES = 100;

/** Daily rows older than this are pruned when a new day is first recorded. */
const DAY_RETENTION = 400;

export interface CounterStats {
  site_id: string;
  /** Visits, all time (repeat hits inside the cooldown don't count). */
  total: number;
  /** Distinct visitors, all time. */
  unique: number;
  /** Visits so far during the current UTC day. */
  today: number;
  /** Epoch ms the site row was created. */
  created_at: number;
  /** Epoch ms of the most recent counted visit. */
  updated_at: number;
}

export interface HitResult extends CounterStats {
  /** False when the cooldown swallowed this hit, so the caller can tell the
   *  difference between "you were counted" and "you already were". */
  counted: boolean;
  /** True when this visitor had never been seen on this site before. */
  first_visit: boolean;
}

let initialised = false;

export function initCounterSchema(): void {
  if (initialised) return;
  const sql = db();

  // The visitor-log table this system replaces. Dropped on first touch so the
  // old per-request header/cookie/IP rows don't linger in DO storage.
  sql.exec("DROP TABLE IF EXISTS visitor_logs");

  sql.exec(`
    CREATE TABLE IF NOT EXISTS counter_sites (
      site_id    TEXT PRIMARY KEY,
      salt       TEXT NOT NULL,
      total      INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS counter_visitors (
      site_id      TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      first_seen   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      hits         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, visitor_hash)
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS counter_days (
      site_id TEXT NOT NULL,
      day     TEXT NOT NULL,
      hits    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, day)
    )
  `);

  initialised = true;
}

// ---- helpers ---------------------------------------------------------------

/** Current UTC day as YYYY-MM-DD. Days are UTC so the histogram doesn't shift
 *  with the caller's timezone. */
function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function clientIp(req: Request): string {
  for (const header of ["cf-connecting-ip", "true-client-ip", "x-real-ip"]) {
    const v = req.headers.get(header);
    if (v) return v;
  }
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
}

/** Opaque, non-reversible visitor id. See the file header for why. */
async function visitorHash(siteId: string, salt: string, req: Request): Promise<string> {
  const material = `${siteId}|${salt}|${clientIp(req)}|${req.headers.get("user-agent") ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface SiteRow {
  site_id: string;
  salt: string;
  total: number;
  created_at: number;
  updated_at: number;
}

function readSite(siteId: string): SiteRow | null {
  const rows = db()
    .exec("SELECT site_id, salt, total, created_at, updated_at FROM counter_sites WHERE site_id = ?", siteId)
    .toArray() as unknown as SiteRow[];
  return rows[0] ?? null;
}

function countSites(): number {
  return (db().exec("SELECT COUNT(*) AS n FROM counter_sites").one() as { n: number }).n;
}

function uniqueVisitors(siteId: string): number {
  return (
    db().exec("SELECT COUNT(*) AS n FROM counter_visitors WHERE site_id = ?", siteId).one() as {
      n: number;
    }
  ).n;
}

function dayHits(siteId: string, day: string): number {
  const rows = db()
    .exec("SELECT hits FROM counter_days WHERE site_id = ? AND day = ?", siteId, day)
    .toArray() as unknown as { hits: number }[];
  return rows[0]?.hits ?? 0;
}

function toStats(site: SiteRow, at: number): CounterStats {
  return {
    site_id: site.site_id,
    total: site.total,
    unique: uniqueVisitors(site.site_id),
    today: dayHits(site.site_id, utcDay(at)),
    created_at: site.created_at,
    updated_at: site.updated_at,
  };
}

// ---- public API ------------------------------------------------------------

/** Read a site's counts without recording anything. Null if it doesn't exist. */
export function getStats(siteId: string): CounterStats | null {
  initCounterSchema();
  const site = readSite(siteId);
  return site ? toStats(site, Date.now()) : null;
}

/** Every site with a counter, busiest first. */
export function listSites(): CounterStats[] {
  initCounterSchema();
  const now = Date.now();
  const sites = db()
    .exec(
      "SELECT site_id, salt, total, created_at, updated_at FROM counter_sites ORDER BY total DESC, site_id ASC",
    )
    .toArray() as unknown as SiteRow[];
  return sites.map((s) => toStats(s, now));
}

/** Thrown when a site can't be created — bad id, not on the allow-list, or the
 *  auto-create cap is already reached. */
export class SiteRejected extends Error {
  constructor(
    public readonly code: "invalid_site_id" | "not_allowed" | "too_many_sites",
    message: string,
  ) {
    super(message);
    this.name = "SiteRejected";
  }
}

/**
 * Record a visit and return the updated counts.
 *
 * `allowList` is the configured COUNTER_SITE_IDS; when it's empty any
 * well-formed id auto-creates a site (up to MAX_SITES), and when it's set
 * only those ids are accepted.
 */
export async function recordHit(
  siteId: string,
  req: Request,
  allowList: string[],
): Promise<HitResult> {
  initCounterSchema();

  if (!SITE_ID_RE.test(siteId)) {
    throw new SiteRejected(
      "invalid_site_id",
      "Site id must be 1–64 chars of lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.",
    );
  }

  const sql = db();
  const now = Date.now();
  const day = utcDay(now);
  let site = readSite(siteId);

  if (!site) {
    if (allowList.length && !allowList.includes(siteId)) {
      throw new SiteRejected("not_allowed", `Site '${siteId}' is not registered on this counter.`);
    }
    if (!allowList.length && countSites() >= MAX_SITES) {
      throw new SiteRejected("too_many_sites", "This counter is not accepting new sites.");
    }
    sql.exec(
      "INSERT INTO counter_sites (site_id, salt, total, created_at, updated_at) VALUES (?,?,0,?,?)",
      siteId,
      crypto.randomUUID(),
      now,
      now,
    );
    site = readSite(siteId)!;
  }

  const hash = await visitorHash(siteId, site.salt, req);
  const seen = sql
    .exec(
      "SELECT first_seen, last_seen, hits FROM counter_visitors WHERE site_id = ? AND visitor_hash = ?",
      siteId,
      hash,
    )
    .toArray() as unknown as { first_seen: number; last_seen: number; hits: number }[];
  const previous = seen[0] ?? null;

  const firstVisit = previous === null;
  const counted = firstVisit || now - previous.last_seen >= VISIT_COOLDOWN_MS;

  if (!counted) {
    // Still refresh last_seen so a continuous session keeps extending the
    // cooldown rather than tipping over mid-browse.
    sql.exec(
      "UPDATE counter_visitors SET last_seen = ? WHERE site_id = ? AND visitor_hash = ?",
      now,
      siteId,
      hash,
    );
    return { ...toStats(site, now), counted: false, first_visit: false };
  }

  if (firstVisit) {
    sql.exec(
      "INSERT INTO counter_visitors (site_id, visitor_hash, first_seen, last_seen, hits) VALUES (?,?,?,?,1)",
      siteId,
      hash,
      now,
      now,
    );
  } else {
    sql.exec(
      "UPDATE counter_visitors SET last_seen = ?, hits = hits + 1 WHERE site_id = ? AND visitor_hash = ?",
      now,
      siteId,
      hash,
    );
  }

  sql.exec(
    "UPDATE counter_sites SET total = total + 1, updated_at = ? WHERE site_id = ?",
    now,
    siteId,
  );

  const dayExisted = dayHits(siteId, day) > 0;
  sql.exec(
    `INSERT INTO counter_days (site_id, day, hits) VALUES (?,?,1)
     ON CONFLICT (site_id, day) DO UPDATE SET hits = hits + 1`,
    siteId,
    day,
  );
  if (!dayExisted) pruneDays(siteId, now);

  return { ...toStats(readSite(siteId)!, now), counted: true, first_visit: firstVisit };
}

/** Drop daily rows past the retention window. Called once per new day, so the
 *  histogram stays bounded without doing work on every hit. */
function pruneDays(siteId: string, at: number): void {
  const cutoff = utcDay(at - DAY_RETENTION * 86_400_000);
  db().exec("DELETE FROM counter_days WHERE site_id = ? AND day < ?", siteId, cutoff);
}

/** The daily histogram, oldest first — `days` back from today (UTC). */
export function getHistory(siteId: string, days: number): { day: string; hits: number }[] {
  initCounterSchema();
  const from = utcDay(Date.now() - (days - 1) * 86_400_000);
  return db()
    .exec(
      "SELECT day, hits FROM counter_days WHERE site_id = ? AND day >= ? ORDER BY day ASC",
      siteId,
      from,
    )
    .toArray() as unknown as { day: string; hits: number }[];
}

/** Delete a site and everything recorded for it. True if it existed. */
export function deleteSite(siteId: string): boolean {
  initCounterSchema();
  if (!readSite(siteId)) return false;
  db().exec("DELETE FROM counter_visitors WHERE site_id = ?", siteId);
  db().exec("DELETE FROM counter_days WHERE site_id = ?", siteId);
  db().exec("DELETE FROM counter_sites WHERE site_id = ?", siteId);
  return true;
}

/** Zero a site's counters, keeping the row (and its salt) in place. */
export function resetSite(siteId: string): CounterStats | null {
  initCounterSchema();
  if (!readSite(siteId)) return null;
  const now = Date.now();
  db().exec("DELETE FROM counter_visitors WHERE site_id = ?", siteId);
  db().exec("DELETE FROM counter_days WHERE site_id = ?", siteId);
  db().exec("UPDATE counter_sites SET total = 0, updated_at = ? WHERE site_id = ?", now, siteId);
  return toStats(readSite(siteId)!, now);
}
