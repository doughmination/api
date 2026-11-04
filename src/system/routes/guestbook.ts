/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Guestbook. Mounted at /v2/guestbook.
 *   GET    /v2/guestbook?limit=50&offset=0   (public, newest first)
 *   POST   /v2/guestbook                     (public; honeypot + Turnstile + rate limit)
 *   DELETE /v2/guestbook/:id                 (X-Battery-Key required)
 *   POST   /v2/guestbook/import              (X-Battery-Key required; migration, no captcha)
 *
 * Moderation (X-Guestbook-Key, or an admin bearer token):
 *   GET    /v2/guestbook/admin/entries?status=pending|approved|all
 *   PATCH  /v2/guestbook/admin/entries/:id   { status?, name?, message?, website? }
 *   DELETE /v2/guestbook/admin/entries/:id
 *   GET    /v2/guestbook/admin/blocklist     → { words }
 *   PUT    /v2/guestbook/admin/blocklist     { words: string[] } (replaces the list)
 *
 * POST body (JSON): { name, message, website?, url2?, turnstileToken? | "cf-turnstile-response"? }
 *   - url2 is a honeypot: if filled we pretend success and drop the entry.
 *   - Turnstile is only enforced when TURNSTILE_SECRET is configured.
 *
 * Each accepted entry is assigned a random UID (entry.id); delete by that UID.
 * Entries that hit the word blocklist are held as pending and only appear in
 * the public list once approved.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import { verifyBatteryAccess, verifyGuestbookAdmin } from "../middleware/auth";
import { verifyTurnstileToken } from "../security";
import { turnstileSecret } from "../config";
import {
  LIMITS,
  RATE_LIMIT_SECONDS,
  clean,
  cleanWebsite,
  readEntries,
  addEntry,
  deleteEntry,
  checkAndRecordRateLimit,
  isApproved,
  publicEntry,
  updateEntry,
  readBlocklist,
  saveBlocklist,
} from "../services/guestbook";

export const guestbookRoutes = new Hono<Env>();

interface PostBody {
  name?: unknown;
  message?: unknown;
  website?: unknown;
  url2?: unknown; // honeypot
  turnstileToken?: unknown;
  "cf-turnstile-response"?: unknown;
}

function clientIp(c: Context): string | undefined {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
}

// ---- Public read -----------------------------------------------------------

guestbookRoutes.get("/", async (c) => {
  const entries = (await readEntries()).filter(isApproved);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "") || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query("offset") || "") || 0, 0);
  return c.json({
    entries: entries.slice(offset, offset + limit).map(publicEntry),
    total: entries.length,
    limit,
    offset,
  });
});

// ---- Public write (captcha + honeypot + rate limit) ------------------------

guestbookRoutes.post("/", async (c) => {
  let body: PostBody;
  try {
    body = await c.req.json<PostBody>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  // Honeypot: real users never fill this hidden field.
  if (clean(body.url2 ?? "", 100)) {
    return c.json({ ok: true, skipped: true }); // pretend success
  }

  // Turnstile — only enforced when a secret is configured.
  if (turnstileSecret()) {
    const token = body.turnstileToken ?? body["cf-turnstile-response"];
    const ok = typeof token === "string" && token
      ? await verifyTurnstileToken(token, clientIp(c))
      : false;
    if (!ok) {
      return c.json({ error: "Captcha verification failed. Please try again." }, 403);
    }
  }

  const name = clean(body.name, LIMITS.name);
  const message = clean(body.message, LIMITS.message);
  const website = cleanWebsite(body.website);

  if (!name) return c.json({ error: "Please enter a name." }, 400);
  if (!message) return c.json({ error: "Please enter a message." }, 400);

  const allowed = await checkAndRecordRateLimit(clientIp(c));
  if (!allowed) {
    return c.json(
      { error: `Slow down a moment — you can post again in ~${RATE_LIMIT_SECONDS}s.` },
      429,
    );
  }

  const entry = await addEntry({ name, message, website });
  // A held entry is acknowledged without echoing it back or saying which word
  // tripped the filter.
  if (!isApproved(entry)) return c.json({ ok: true, pending: true }, 202);
  return c.json({ ok: true, entry: publicEntry(entry) }, 201);
});

// ---- Delete by UID (protected) ---------------------------------------------

guestbookRoutes.delete("/:id", verifyBatteryAccess, async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ detail: "Missing entry id" }, 400);
  }
  const deleted = await deleteEntry(id);
  if (!deleted) {
    return c.json({ detail: `No guestbook entry with id '${id}'` }, 404);
  }
  return c.json({ success: true, id, deleted: true });
});

// ---- Migration import (protected; no captcha / no rate limit) --------------

guestbookRoutes.post("/import", verifyBatteryAccess, async (c) => {
  let body: PostBody;
  try {
    body = await c.req.json<PostBody>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const name = clean(body.name, LIMITS.name);
  const message = clean(body.message, LIMITS.message);
  const website = cleanWebsite(body.website);

  if (!name) return c.json({ error: "Please enter a name." }, 400);
  if (!message) return c.json({ error: "Please enter a message." }, 400);

  const entry = await addEntry({ name, message, website });
  return c.json({ ok: true, entry }, 201);
});

// ---- Moderation (guestbook key or admin) --------------------------------------

guestbookRoutes.use("/admin/*", verifyGuestbookAdmin);

guestbookRoutes.get("/admin/entries", async (c) => {
  const status = c.req.query("status") ?? "all";
  const entries = await readEntries();
  const filtered =
    status === "pending"
      ? entries.filter((e) => !isApproved(e))
      : status === "approved"
        ? entries.filter(isApproved)
        : entries;
  return c.json({
    entries: filtered.map((e) => ({ ...e, status: e.status ?? "approved" })),
    total: filtered.length,
    pending: entries.filter((e) => !isApproved(e)).length,
  });
});

guestbookRoutes.patch("/admin/entries/:id", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }
  const entry = await updateEntry(c.req.param("id"), body);
  if (!entry) return c.json({ detail: `No guestbook entry with id '${c.req.param("id")}'` }, 404);
  return c.json({ ok: true, entry: { ...entry, status: entry.status ?? "approved" } });
});

guestbookRoutes.delete("/admin/entries/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await deleteEntry(id))) {
    return c.json({ detail: `No guestbook entry with id '${id}'` }, 404);
  }
  return c.json({ success: true, id, deleted: true });
});

guestbookRoutes.get("/admin/blocklist", async (c) => {
  return c.json({ words: await readBlocklist() });
});

guestbookRoutes.put("/admin/blocklist", async (c) => {
  let body: { words?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }
  if (!Array.isArray(body.words)) return c.json({ error: "Expected { words: string[] }." }, 400);
  return c.json({ ok: true, words: await saveBlocklist(body.words) });
});
