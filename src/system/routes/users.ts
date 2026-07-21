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
import { getUsers, createUser, updateUser, deleteUser, getUserById } from "../services/users";
import { sendEmail, emailChangeAlertTemplate } from "../services/email";
import { sendVerificationEmail } from "./email_verification";
import { maskEmail } from "./password_reset";
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
    // Owner/admin-created accounts skip confirmation: the address is being
    // assigned deliberately, not self-asserted by a stranger.
    const newUser = await createUser(parsed.data, c.get("user") ?? null, { emailVerified: true });
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

  // Captured before the write so we can tell whether this request started a
  // new email change, rather than re-sending on every unrelated profile save.
  const before = await getUserById(userId);
  const previousPending = before?.pending_email ?? null;

  try {
    const updated = await updateUser(userId, parsed.data, currentUser);
    if (!updated) throw new HttpError(404, "User not found");

    const newPending = updated.pending_email ?? null;
    let emailPending = false;

    if (newPending && newPending !== previousPending) {
      emailPending = true;

      // Confirmation to the new address — until this is clicked, the account
      // keeps its existing address.
      const sent = await sendVerificationEmail(updated, newPending, "change");
      if (!sent) {
        console.error(`Failed to send change-confirmation for user ${updated.id}`);
      }

      // Heads-up to the OLD address, so a takeover attempt is visible to
      // whoever actually owns the account. Best-effort; never blocks.
      if (before?.email) {
        const alert = emailChangeAlertTemplate({
          displayName: updated.display_name || updated.username,
          newEmailMasked: maskEmail(newPending),
        });
        const alerted = await sendEmail({
          to: before.email,
          subject: alert.subject,
          html: alert.html,
          text: alert.text,
        });
        if (!alerted) {
          console.error(`Failed to send change alert to previous address for ${updated.id}`);
        }
      }
    }

    return c.json({
      ...toUserResponse(updated),
      email_change_pending: emailPending,
      ...(emailPending
        ? {
            message:
              "Check the new address for a confirmation link. Your current email stays active until then.",
          }
        : {}),
    });
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
