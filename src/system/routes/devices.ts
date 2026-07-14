/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Device state. Mounted at /v2/devices.
 *   POST /v2/devices?device=iphone&level=25&charging=1&lpm=0   (X-Battery-Key required)
 *   GET    /v2/devices                                         (public, all devices)
 *   GET    /v2/devices/:device                                 (public, one device)
 *   DELETE /v2/devices?device=iphone                           (X-Battery-Key required)
 *
 * Only `device` is required on POST. `level`, `charging` and `lpm` are each
 * optional — any supplied field is updated, the rest are left untouched.
 *   level    — integer 0–100
 *   charging — 1 (true) or 0 (false)
 *   lpm      — 1 (true) or 0 (false), stored as `lowPowerMode`
 *   wifi     — any string (the network name), 0–128 chars
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { deleteDevice, getAllLevels, getDeviceLevel, setDeviceLevel } from "../services/devices";
import { verifyBatteryAccess } from "../middleware/auth";
import { broadcastDeviceUpdate } from "../ws";

export const deviceRoutes = new Hono<Env>();

/** Parse a "1"/"0" flag query param. Returns undefined if absent, null if invalid. */
function parseFlag(raw: string | undefined): boolean | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

deviceRoutes.post("/", verifyBatteryAccess, async (c) => {
  const device = c.req.query("device");
  if (typeof device !== "string" || device.length < 1 || device.length > 64) {
    return c.json({ detail: "Query param 'device' must be a string between 1 and 64 characters" }, 422);
  }

  const patch: { level?: number; charging?: boolean; lowPowerMode?: boolean; wifi?: string } = {};

  const levelRaw = c.req.query("level");
  if (levelRaw !== undefined) {
    const level = Number(levelRaw);
    if (levelRaw === "" || !Number.isInteger(level) || level < 0 || level > 100) {
      return c.json({ detail: "Query param 'level' must be an integer between 0 and 100" }, 422);
    }
    patch.level = level;
  }

  const charging = parseFlag(c.req.query("charging"));
  if (charging === null) {
    return c.json({ detail: "Query param 'charging' must be 1 (true) or 0 (false)" }, 422);
  }
  if (charging !== undefined) patch.charging = charging;

  const lpm = parseFlag(c.req.query("lpm"));
  if (lpm === null) {
    return c.json({ detail: "Query param 'lpm' must be 1 (true) or 0 (false)" }, 422);
  }
  if (lpm !== undefined) patch.lowPowerMode = lpm;

  const wifi = c.req.query("wifi");
  if (wifi !== undefined) {
    if (wifi.length > 128) {
      return c.json({ detail: "Query param 'wifi' must be 128 characters or fewer" }, 422);
    }
    patch.wifi = wifi;
  }

  const record = await setDeviceLevel(device, patch);
  broadcastDeviceUpdate(record);
  return c.json({ success: true, ...record });
});

deviceRoutes.delete("/", verifyBatteryAccess, async (c) => {
  const device = c.req.query("device");
  if (typeof device !== "string" || device.length < 1 || device.length > 64) {
    return c.json({ detail: "Query param 'device' must be a string between 1 and 64 characters" }, 422);
  }

  const deleted = await deleteDevice(device);
  if (!deleted) {
    return c.json({ detail: `No state recorded for device '${device}'` }, 404);
  }
  broadcastDeviceUpdate({ device, deleted: true });
  return c.json({ success: true, device, deleted: true });
});

deviceRoutes.get("/", async (c) => {
  const levels = await getAllLevels();
  const result: Record<string, unknown> = {};
  for (const [device, record] of Object.entries(levels)) {
    result[device] = { device, ...record };
  }
  return c.json(result);
});

deviceRoutes.get("/:device", async (c) => {
  const device = c.req.param("device");
  const record = await getDeviceLevel(device);
  if (record === null) {
    return c.json({ detail: `No state recorded for device '${device}'` }, 404);
  }
  return c.json({ device, ...record });
});
