/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * The Doughmination system API as a single Hono app, run inside the
 * SystemState Durable Object. Route groups:
 *
 *   /v2/plural/*        — auth, system, members, fronting, users, metrics,
 *                         admin, member status, bot, SEO (robots/sitemap)
 *   /v2/devices/*       — device state (battery, etc.)  (misc)
 *   /v2/guestbook/*     — public guestbook (post/list/delete)  (misc)
 *   /v2/system-data/*   — visitor logging + log viewer (misc)
 *
 * The single realtime socket /v2/ws is handled by the DO before the request
 * ever reaches this app (see do.ts).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "./hono";
import { HttpError } from "./errors";
import { corsOrigins } from "./config";
import { initializeAdminUser } from "./services/users";

import { authRoutes } from "./routes/auth";
import { systemRoutes } from "./routes/system";
import { membersRoutes } from "./routes/members";
import { frontingRoutes } from "./routes/fronting";
import { usersRoutes } from "./routes/users";
import { metricsRoutes } from "./routes/metrics";
import { adminRoutes } from "./routes/admin";
import { memberStatusRoutes } from "./routes/member_status";
import { botRoutes } from "./routes/bot";
import { staticRoutes } from "./routes/static";
import { deviceRoutes } from "./routes/devices";
import { guestbookRoutes } from "./routes/guestbook";
import { systemDataRoutes } from "./routes/system_data";

// One-time owner seed per DO lifetime (there is no startup phase on a Worker).
let seeded = false;
async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  seeded = true;
  try {
    await initializeAdminUser();
  } catch (err) {
    seeded = false;
    console.error(`Admin seed failed: ${String(err)}`);
  }
}

// ---- /v2/plural sub-app ----------------------------------------------------

const pluralApp = new Hono<Env>();
pluralApp.route("/", authRoutes);
pluralApp.route("/", systemRoutes);
pluralApp.route("/", membersRoutes);
pluralApp.route("/", frontingRoutes);
pluralApp.route("/", usersRoutes);
pluralApp.route("/", metricsRoutes);
pluralApp.route("/", adminRoutes);
pluralApp.route("/", memberStatusRoutes);
pluralApp.route("/", botRoutes);
pluralApp.route("/", staticRoutes);

// ---- Top-level app ---------------------------------------------------------

export const systemApp = new Hono<Env>();

systemApp.use(
  "*",
  cors({
    origin: (origin) => (corsOrigins().includes(origin) ? origin : ""),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

systemApp.use("*", async (_c, next) => {
  await ensureSeeded();
  await next();
});

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

systemApp.route("/v2/plural", pluralApp);
systemApp.route("/v2/devices", deviceRoutes);
systemApp.route("/v2/guestbook", guestbookRoutes);
systemApp.route("/v2/system-data", systemDataRoutes);

systemApp.notFound((c) => c.json({ detail: "Unknown route." }, 404));
