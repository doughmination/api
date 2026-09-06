/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import { getFrontingTimeMetrics, getSwitchFrequencyMetrics } from "../services/metrics";
import { HttpError } from "../errors";

export const metricsRoutes = new Hono<Env>();

function parseDays(c: Context): number {
  const raw = c.req.query("days");
  const parsed = Number(raw);
  return raw !== undefined && !Number.isNaN(parsed) ? parsed : 30;
}

metricsRoutes.get("/metrics/fronting-time", async (c) => {
  try {
    return c.json(await getFrontingTimeMetrics(parseDays(c)));
  } catch (err) {
    throw new HttpError(500, `Failed to fetch fronting metrics: ${String(err)}`);
  }
});

metricsRoutes.get("/metrics/switch-frequency", async (c) => {
  try {
    return c.json(await getSwitchFrequencyMetrics(parseDays(c)));
  } catch (err) {
    throw new HttpError(500, `Failed to fetch switch frequency metrics: ${String(err)}`);
  }
});
