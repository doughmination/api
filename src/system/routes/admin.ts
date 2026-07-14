/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { broadcastFrontendUpdate } from "../ws";
import { HttpError } from "../errors";

export const adminRoutes = new Hono<Env>();

/** Force every connected /v2/ws client to refresh (admin only). */
adminRoutes.post("/admin/refresh", requireAuth, requireAdmin, async (c) => {
  try {
    broadcastFrontendUpdate("force_refresh", { message: "Admin initiated refresh" });
    return c.json({ success: true, message: "Refresh broadcast sent" });
  } catch (err) {
    throw new HttpError(500, `Failed to broadcast refresh: ${String(err)}`);
  }
});
