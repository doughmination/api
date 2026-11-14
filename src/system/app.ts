/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Devices, guestbook and counters as a single Hono app, run inside the
 * SystemState Durable Object. Route groups:
 *
 *   /v2/devices/*       — device state (battery, etc.)
 *   /v2/guestbook/*     — public guestbook (post/list/delete)
 *   /v2/counter/*       — per-site visit counters
 *
 * The single realtime socket /v2/ws is handled by the DO before the request
 * ever reaches this app (see do.ts).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./hono";
import { HttpError } from "./errors";
import { corsOrigins, isLocalhostOrigin } from "./config";

import { deviceRoutes } from "./routes/devices";
import { guestbookRoutes } from "./routes/guestbook";
import { counterRoutes } from "./routes/counter";

// ---- Top-level app ---------------------------------------------------------

export const systemApp = new Hono<Env>();

systemApp.use(
  "*",
  cors({
    // /v2/counter is meant to be called from whatever site owns the :siteId,
    // so it echoes any origin. Everything else stays on the allow-list.
    origin: (origin, c) =>
      c.req.path.startsWith("/v2/counter") ||
      isLocalhostOrigin(origin) ||
      corsOrigins().includes(origin)
        ? origin
        : "",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

systemApp.onError((err, c) => {
  if (err instanceof HttpError) {
    if (err.headers) {
      for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
    }
    return c.json({ detail: err.message }, err.statusCode as never);
  }
  console.error("Unhandled error:", err);
  return c.json({ detail: "Internal server error" }, 500);
});

systemApp.route("/v2/devices", deviceRoutes);
systemApp.route("/v2/guestbook", guestbookRoutes);
systemApp.route("/v2/counter", counterRoutes);

systemApp.notFound((c) => c.json({ detail: "Unknown route." }, 404));
