/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import { UserResponseSchema, LoginRequestSchema, EmailSchema } from "../models";
import type { User } from "../models";
import { verifyUser, createUser, getUsers, isEmailVerified } from "../services/users";
import { createCorrectionToken, CORRECTION_TTL_HOURS } from "../services/email_verification";
import { sendVerificationEmail } from "./email_verification";
import { UNVERIFIED_ACCOUNT_TTL_HOURS } from "../config";
import { createAccessToken, verifyTurnstileToken } from "../security";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../errors";
import { rt } from "../runtime";

export const authRoutes = new Hono<Env>();

function toUserResponseJson(user: User) {
  return UserResponseSchema.parse({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    email: user.email ?? null,
    email_verified: isEmailVerified(user),
    pending_email: user.pending_email ?? null,
    created_at: user.created_at ?? null,
    is_admin: user.is_admin,
    is_owner: user.is_owner,
    is_pet: user.is_pet,
    avatar_url: user.avatar_url ?? null,
  });
}

function clientIp(c: Context): string | undefined {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
}

/** Unified login: JSON (with Turnstile) or legacy form data. */
authRoutes.post("/login", async (c) => {
  const contentType = c.req.header("content-type") ?? "";

  let username: string | undefined;
  let password: string | undefined;

  if (contentType.includes("application/json")) {
    const parsed = LoginRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request format");

    const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
    if (!ok) throw new HttpError(400, "Security verification failed");

    username = parsed.data.username;
    password = parsed.data.password;
  } else {
    const body = await c.req.parseBody();
    username = typeof body.username === "string" ? body.username : undefined;
    password = typeof body.password === "string" ? body.password : undefined;
    if (!username || !password) throw new HttpError(400, "Username and password required");
  }

  const user = await verifyUser(username, password);
  if (!user) {
    throw new HttpError(401, "Invalid credentials", { "WWW-Authenticate": "Bearer" });
  }

  // Unconfirmed signups cannot log in. The credentials were correct, so it's
  // safe to say why — and the frontend needs to know in order to offer a
  // resend. Legacy accounts predate verification and are treated as confirmed
  // (see isEmailVerified), so this never locks out an existing user.
  if (!isEmailVerified(user)) {
    throw new HttpError(
      403,
      "Confirm your email address before logging in. Check your inbox for the confirmation link.",
      { "X-Auth-Reason": "email_unverified" },
    );
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

  return c.json({ access_token: token, token_type: "bearer", success: true });
});

/** Public signup with Turnstile. */
authRoutes.post("/signup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const username = String(body.username ?? "").trim();
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = String(body.display_name ?? "").trim() || null;
  const turnstileToken = typeof body.turnstile_token === "string" ? body.turnstile_token : "";

  if (!username) throw new HttpError(400, "Username is required");
  if (!password) throw new HttpError(400, "Password is required");
  if (password.length < 10) throw new HttpError(400, "Password must be at least 10 characters long");

  // Email is required at signup — it is the only self-service account
  // recovery route. Existing accounts predate this and are backfilled by hand.
  const emailParsed = EmailSchema.safeParse(body.email ?? "");
  if (!emailParsed.success) {
    throw new HttpError(400, emailParsed.error.issues[0]?.message ?? "A valid email is required");
  }
  const email = emailParsed.data;

  if (!turnstileToken) throw new HttpError(400, "Security verification is required");

  const ok = await verifyTurnstileToken(turnstileToken, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  const users = await getUsers();
  const usernameLower = username.toLowerCase();
  if (users.some((u) => u.username.toLowerCase() === usernameLower)) {
    throw new HttpError(400, "Username already exists");
  }
  if (users.some((u) => u.email && u.email.toLowerCase() === email)) {
    throw new HttpError(400, "Email address is already in use");
  }

  try {
    const newUser = await createUser(
      { username, password, email, display_name: displayName, is_admin: false, is_pet: false },
      null,
      { emailVerified: false },
    );

    const sent = await sendVerificationEmail(newUser, email, "signup");

    // The correction token goes ONLY to the client that just created the
    // account, and is what lets them fix a typo'd address without a password.
    // Treat it like a credential: it is not recoverable once this tab is gone.
    const correctionToken = await createCorrectionToken(newUser.id);

    return c.json({
      success: true,
      message: sent
        ? "Account created. Check your inbox to confirm your email address."
        : "Account created, but we couldn't send the confirmation email. Use the resend option.",
      email_sent: sent,
      correction_token: correctionToken,
      correction_expires_in_hours: CORRECTION_TTL_HOURS,
      unverified_deleted_after_hours: UNVERIFIED_ACCOUNT_TTL_HOURS,
      user: toUserResponseJson(newUser),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, String(err instanceof Error ? err.message : err));
  }
});

/** Public username availability check. */
authRoutes.get("/users/check-username", async (c) => {
  const username = c.req.query("username") ?? "";
  if (!username.trim()) throw new HttpError(400, "Username parameter is required");

  const users = await getUsers();
  const usernameLower = username.trim().toLowerCase();
  const exists = users.some((u) => u.username.toLowerCase() === usernameLower);
  return c.json({ username, exists, available: !exists });
});

/**
 * Public email availability check, powering the live signup field.
 *
 * This intentionally reveals whether an address is registered — same trade-off
 * as /forgot-password, accepted so signup can flag duplicates before submit.
 * Rate limited per IP because that disclosure makes it worth probing.
 */
authRoutes.get("/users/check-email", async (c) => {
  const raw = c.req.query("email") ?? "";
  const parsedEmail = EmailSchema.safeParse(raw);
  if (!parsedEmail.success) {
    throw new HttpError(400, "A valid email parameter is required");
  }

  const ip = clientIp(c);
  if (ip) {
    const key = `checkemail_rl:${ip}`;
    const bucket = await rt().store.get<{ count: number; reset: number }>(key, {
      count: 0,
      reset: 0,
    });
    const now = Date.now();
    const window = now > bucket.reset ? { count: 0, reset: now + 60_000 } : bucket;
    if (window.count >= 20) {
      throw new HttpError(429, "Too many lookups. Please wait a minute and try again.");
    }
    await rt().store.put(key, { count: window.count + 1, reset: window.reset });
  }

  const users = await getUsers();
  const exists = users.some((u) => u.email && u.email.toLowerCase() === parsedEmail.data);
  return c.json({ email: parsedEmail.data, exists, available: !exists });
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
