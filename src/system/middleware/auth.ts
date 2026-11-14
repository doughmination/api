/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Key and admin checks for devices, guestbook and counters. Failures throw
 * HttpError, translated by app.onError.
 *
 * Site accounts live on the system site (doughmination.co.uk) now, so a
 * bearer token is checked by asking it, over the SITE service binding.
 */

import type { Context, Next } from "hono";
import type { Env } from "../hono";
import { HttpError } from "../errors";
import { verifyBatteryKey, verifyGuestbookKey } from "../services/keys";
import { rt } from "../runtime";

/** Verify battery API access via the X-Battery-Key header. */
export async function verifyBatteryAccess(c: Context<Env>, next: Next): Promise<void> {
  const key = c.req.header("X-Battery-Key");
  if (!key) throw new HttpError(401, "Missing X-Battery-Key header");
  if (!verifyBatteryKey(key)) throw new HttpError(401, "Invalid battery API key");
  await next();
}

/** True when the site says this bearer token belongs to an admin. */
async function isSiteAdmin(authorization: string): Promise<boolean> {
  const res = await rt().env.SITE.fetch("https://doughmination.co.uk/api/plural/auth/is_admin", {
    headers: { Authorization: authorization },
  });
  if (res.status === 401) throw new HttpError(401, "Invalid or expired token", { "WWW-Authenticate": "Bearer" });
  if (!res.ok) throw new HttpError(502, "Could not check your account with the system site");
  const body = (await res.json()) as { isAdmin?: boolean };
  return body.isAdmin === true;
}

/**
 * Guestbook moderation: either the X-Guestbook-Key header (the website's
 * server, after its own SSO login) or a signed-in admin's bearer token.
 */
export async function verifyGuestbookAdmin(c: Context<Env>, next: Next): Promise<void> {
  const key = c.req.header("X-Guestbook-Key");
  if (key) {
    if (!verifyGuestbookKey(key)) throw new HttpError(401, "Invalid guestbook key");
    await next();
    return;
  }

  const authorization = c.req.header("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "Not authenticated", { "WWW-Authenticate": "Bearer" });
  }
  if (!(await isSiteAdmin(authorization))) throw new HttpError(403, "Admin privileges required");
  await next();
}
