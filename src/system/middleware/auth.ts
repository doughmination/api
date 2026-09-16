/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Auth middleware, ported from the Express dependencies. On success the
 * resolved user is attached with `c.set("user", user)` (the Hono analogue
 * of `req.user`). Failures throw HttpError, translated by app.onError.
 */

import type { Context, Next } from "hono";
import type { Env } from "../hono";
import { decodeAccessToken } from "../security";
import { HttpError } from "../errors";
import { getUserByUsername } from "../services/users";
import { currentSsoSession } from "../services/sso_sessions";
import { verifyBotToken, verifyBatteryKey } from "../services/keys";
import type { User } from "../models";

function extractBearer(c: Context<Env>): string | undefined {
  const header = c.req.header("Authorization");
  if (!header) return undefined;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return undefined;
  return parts[1];
}

async function resolveCurrentUser(c: Context<Env>): Promise<User> {
  const token = extractBearer(c);
  if (!token) {
    throw new HttpError(401, "Not authenticated", { "WWW-Authenticate": "Bearer" });
  }

  const payload = await decodeAccessToken(token);
  const username = payload.sub;
  if (!username || typeof username !== "string") {
    throw new HttpError(401, "Invalid token", { "WWW-Authenticate": "Bearer" });
  }

  // Every token belongs to an SSO-backed session: logging out, the session
  // expiring, or the SSO no longer vouching for the account all end it here.
  // Tokens from before sessions existed carry no sid and must sign in again.
  const session = typeof payload.sid === "string" ? await currentSsoSession(payload.sid) : null;
  if (!session || session.username.toLowerCase() !== username.toLowerCase()) {
    throw new HttpError(401, "Session ended. Please sign in again.", { "WWW-Authenticate": "Bearer" });
  }

  const user = await getUserByUsername(username);
  if (!user) {
    throw new HttpError(401, "User not found", { "WWW-Authenticate": "Bearer" });
  }
  return user;
}

/** Require an authenticated user. */
export async function requireAuth(c: Context<Env>, next: Next): Promise<void> {
  c.set("user", await resolveCurrentUser(c));
  await next();
}

/** Attach user if authenticated, otherwise leave undefined. Never rejects. */
export async function optionalAuth(c: Context<Env>, next: Next): Promise<void> {
  try {
    c.set("user", await resolveCurrentUser(c));
  } catch {
    // ignore
  }
  await next();
}

export async function requireAdmin(c: Context<Env>, next: Next): Promise<void> {
  const user = c.get("user") as User | undefined;
  if (!user?.is_admin) throw new HttpError(403, "Admin privileges required");
  await next();
}

export async function requireOwner(c: Context<Env>, next: Next): Promise<void> {
  const user = c.get("user") as User | undefined;
  if (!user?.is_owner) throw new HttpError(403, "Owner privileges required");
  await next();
}

export async function requirePet(c: Context<Env>, next: Next): Promise<void> {
  const user = c.get("user") as User | undefined;
  if (!user?.is_pet) throw new HttpError(403, "Pet privileges required");
  await next();
}

/**
 * Verify Discord bot access: `Authorization: Bearer <DOUGH_BOT_TOKEN>` plus a
 * `User-Agent: CloveShortcuts/<version>` header.
 */
export async function verifyBotAccess(c: Context<Env>, next: Next): Promise<void> {
  const userAgent = c.req.header("User-Agent");
  const authorization = c.req.header("Authorization");

  if (!userAgent || !userAgent.startsWith("CloveShortcuts/")) {
    throw new HttpError(403, "Invalid User-Agent. Expected 'CloveShortcuts/<version>'");
  }
  if (!authorization) {
    throw new HttpError(401, "Missing Authorization header", { "WWW-Authenticate": "Bearer" });
  }

  const parts = authorization.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    throw new HttpError(401, "Invalid Authorization header format. Expected 'Bearer <token>'", {
      "WWW-Authenticate": "Bearer",
    });
  }

  if (!verifyBotToken(parts[1])) {
    throw new HttpError(401, "Invalid bot access token", { "WWW-Authenticate": "Bearer" });
  }
  await next();
}

/** Verify battery API access via the X-Battery-Key header. */
export async function verifyBatteryAccess(c: Context<Env>, next: Next): Promise<void> {
  const key = c.req.header("X-Battery-Key");
  if (!key) throw new HttpError(401, "Missing X-Battery-Key header");
  if (!verifyBatteryKey(key)) throw new HttpError(401, "Invalid battery API key");
  await next();
}
