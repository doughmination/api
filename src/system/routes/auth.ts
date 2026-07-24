/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Authentication — PocketID (OpenID Connect) only.
 *
 *   GET /auth/pocketid/login     — redirect to PocketID to start the flow.
 *   GET /auth/pocketid/callback  — PocketID redirects back here; we exchange
 *                                  the code, link/create the account, mint a
 *                                  JWT and hand the browser back to the frontend
 *                                  with the token in the URL fragment.
 *
 * Everything downstream (the /user_info + /auth/is_* checks and every
 * requireAuth route) keeps using the same HS256 bearer token as before.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { UserResponseSchema } from "../models";
import type { User } from "../models";
import { findOrCreateFromPocketId } from "../services/users";
import { beginLogin, completeLogin } from "../services/oidc";
import { pocketIdPostLoginUrl, pocketIdLoginErrorUrl } from "../config";
import { createAccessToken } from "../security";
import { requireAuth } from "../middleware/auth";

export const authRoutes = new Hono<Env>();

function toUserResponseJson(user: User) {
  return UserResponseSchema.parse({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email ?? null,
    created_at: user.created_at ?? null,
    is_admin: user.is_admin,
    is_owner: user.is_owner,
    is_pet: user.is_pet,
    avatar_url: user.avatar_url ?? null,
  });
}

/** A same-origin-ish app path, defended against open-redirect abuse: only a
 *  path beginning with a single "/" is accepted, never "//host" or a full URL. */
function safeReturnPath(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/** Start the PocketID login: 302 to the provider's authorization endpoint. */
authRoutes.get("/auth/pocketid/login", async (c) => {
  const from = safeReturnPath(c.req.query("from"));
  const authUrl = await beginLogin(from);
  return c.redirect(authUrl, 302);
});

/** PocketID redirects the browser back here after the user authenticates. */
authRoutes.get("/auth/pocketid/callback", async (c) => {
  const errorParam = c.req.query("error");
  if (errorParam) {
    const url = new URL(pocketIdLoginErrorUrl());
    url.searchParams.set("error", errorParam);
    return c.redirect(url.toString(), 302);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    const url = new URL(pocketIdLoginErrorUrl());
    url.searchParams.set("error", "missing_code");
    return c.redirect(url.toString(), 302);
  }

  let result;
  try {
    result = await completeLogin(code, state);
  } catch (err) {
    const url = new URL(pocketIdLoginErrorUrl());
    url.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Login failed. Please try again.",
    );
    return c.redirect(url.toString(), 302);
  }

  const { identity, from } = result;

  let user: User;
  try {
    user = await findOrCreateFromPocketId({
      sub: identity.sub,
      username: identity.preferredUsername,
      email: identity.email,
      displayName: identity.displayName,
    });
  } catch (err) {
    const url = new URL(pocketIdLoginErrorUrl());
    url.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Could not sign you in.",
    );
    return c.redirect(url.toString(), 302);
  }

  const token = await createAccessToken({
    sub: user.username,
    id: user.id,
    display_name: user.display_name,
    admin: user.is_admin,
    owner: user.is_owner,
    pet: user.is_pet,
    avatar_url: user.avatar_url ?? null,
  });

  // Token goes in the fragment so it never lands in a server access log or the
  // Referer header; the frontend callback page reads it from location.hash.
  const dest = new URL(pocketIdPostLoginUrl());
  dest.hash = `token=${encodeURIComponent(token)}&from=${encodeURIComponent(from)}`;
  return c.redirect(dest.toString(), 302);
});

authRoutes.get("/user_info", requireAuth, (c) => c.json(toUserResponseJson(c.get("user") as User)));

authRoutes.get("/auth/is_admin", requireAuth, (c) =>
  c.json({ isAdmin: c.get("user")?.is_admin ?? false }),
);
authRoutes.get("/auth/is_pet", requireAuth, (c) =>
  c.json({ isPet: c.get("user")?.is_pet ?? false }),
);
authRoutes.get("/auth/is_owner", requireAuth, (c) =>
  c.json({ isOwner: c.get("user")?.is_owner ?? false }),
);
