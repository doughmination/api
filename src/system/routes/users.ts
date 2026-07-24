/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * User CRUD. The old multipart avatar-UPLOAD endpoint (multer + sharp) is
 * gone — avatars are now external URLs, set via `avatar_url` on PUT /users/:id.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { UserCreateSchema, UserUpdateSchema, toUserResponse } from "../models";
import type { User } from "../models";
import { getUsers, createUser, updateUser, deleteUser } from "../services/users";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { HttpError } from "../errors";

export const usersRoutes = new Hono<Env>();

usersRoutes.get("/users", requireAuth, requireAdmin, async (c) => {
  const users = await getUsers();
  return c.json(users.map(toUserResponse));
});

/** Render zod issues as a single human-readable message for the frontend. */
function validationDetail(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

usersRoutes.post("/users", requireAuth, requireAdmin, async (c) => {
  const parsed = UserCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ detail: validationDetail(parsed.error.issues) }, 422);

  try {
    // Admin-provisioned account. It becomes usable once the person signs in
    // through PocketID with a matching username (the link is filled in then),
    // or immediately if `pocket_id` was supplied.
    const newUser = await createUser(parsed.data, c.get("user") ?? null);
    return c.json(toUserResponse(newUser));
  } catch (err) {
    throw new HttpError(400, String(err instanceof Error ? err.message : err));
  }
});

usersRoutes.put("/users/:user_id", requireAuth, async (c) => {
  const userId = c.req.param("user_id") ?? "";
  const currentUser = c.get("user") as User;

  if (!currentUser.is_admin && currentUser.id !== userId) {
    throw new HttpError(403, "Not authorized to update this user");
  }

  const parsed = UserUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ detail: validationDetail(parsed.error.issues) }, 422);

  try {
    const updated = await updateUser(userId, parsed.data, currentUser);
    if (!updated) throw new HttpError(404, "User not found");
    return c.json(toUserResponse(updated));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, String(err instanceof Error ? err.message : err));
  }
});

usersRoutes.delete("/users/:user_id", requireAuth, requireAdmin, async (c) => {
  const userId = c.req.param("user_id") ?? "";
  const currentUser = c.get("user") as User;

  if (userId === currentUser.id) throw new HttpError(400, "Cannot delete your own account");

  try {
    const ok = await deleteUser(userId, currentUser);
    if (!ok) throw new HttpError(404, "User not found");
    return c.json({ message: "User deleted successfully" });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(403, String(err instanceof Error ? err.message : err));
  }
});
