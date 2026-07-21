/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Password reset:
 *
 *   POST /v2/plural/forgot-password        request a reset link
 *   GET  /v2/plural/reset-password/check   is this token still usable?
 *   POST /v2/plural/reset-password         set a new password with a token
 *
 * Anti-enumeration: /forgot-password returns the same body whether or not the
 * address maps to an account, whether or not that account has an email, and
 * whether or not Resend actually accepted the message. The only distinguishing
 * responses are validation (400) and rate limit (429), neither of which depends
 * on account existence.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import { ForgotPasswordRequestSchema, ResetPasswordRequestSchema } from "../models";
import { PASSWORD_RESET_TTL_MINUTES, passwordResetUrl } from "../config";
import { getUserByEmail, getUserById, setPassword } from "../services/users";
import {
  consumeResetToken,
  createResetToken,
  peekResetToken,
  revokeResetTokensForUser,
} from "../services/password_reset";
import { passwordResetTemplate, sendEmail } from "../services/email";
import { verifyTurnstileToken } from "../security";
import { HttpError } from "../errors";
import { rt } from "../runtime";

export const passwordResetRoutes = new Hono<Env>();

/** Same opaque answer for every outcome — see the module comment. */
const GENERIC_FORGOT_RESPONSE = {
  success: true,
  message: "If an account exists for that email address, a reset link is on its way.",
};

const RL_PREFIX = "pwreset_rl:";
/** Minimum seconds between reset requests from one IP. */
const RATE_LIMIT_SECONDS = 60;

function clientIp(c: Context): string | undefined {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
}

/** Per-IP throttle. True = allowed (and recorded). Blank IP is never limited. */
async function checkAndRecordRateLimit(ip: string | undefined): Promise<boolean> {
  if (!ip) return true;
  const key = RL_PREFIX + ip;
  const last = await rt().store.get<number>(key, 0);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) return false;
  await rt().store.put(key, now);
  return true;
}

function firstIssueMessage(issues: Array<{ message: string }>, fallback: string): string {
  return issues[0]?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// POST /forgot-password
// ---------------------------------------------------------------------------

passwordResetRoutes.post("/forgot-password", async (c) => {
  const parsed = ForgotPasswordRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  if (!(await checkAndRecordRateLimit(clientIp(c)))) {
    throw new HttpError(429, "Too many reset requests. Please wait a minute and try again.");
  }

  const user = await getUserByEmail(parsed.data.email);

  // No account, or an account with no email on file: stop here, but return the
  // same body as the success path so the caller learns nothing.
  if (!user || !user.email) {
    console.info("Password reset requested for an address with no matching account");
    return c.json(GENERIC_FORGOT_RESPONSE);
  }

  const token = await createResetToken(user.id);
  const resetUrl = `${passwordResetUrl()}?token=${encodeURIComponent(token)}`;

  const { subject, html, text } = passwordResetTemplate({
    displayName: user.display_name || user.username,
    resetUrl,
    ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
  });

  const sent = await sendEmail({ to: user.email, subject, html, text });
  if (!sent) {
    // Don't surface the failure — a "send failed" response would confirm the
    // address exists. Log it; wrangler tail will show it.
    console.error(`Failed to send password reset email for user ${user.id}`);
  }

  return c.json(GENERIC_FORGOT_RESPONSE);
});

// ---------------------------------------------------------------------------
// GET /reset-password/check?token=...
// ---------------------------------------------------------------------------

/** Lets the frontend show "this link expired" before rendering the form. */
passwordResetRoutes.get("/reset-password/check", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) throw new HttpError(400, "Token parameter is required");

  const userId = await peekResetToken(token);
  return c.json({ valid: userId !== null });
});

// ---------------------------------------------------------------------------
// POST /reset-password
// ---------------------------------------------------------------------------

passwordResetRoutes.post("/reset-password", async (c) => {
  const parsed = ResetPasswordRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  // Consumed up front, so a token is spent even if the write below fails.
  // Better to make the user request a fresh link than to leave a live token.
  const userId = await consumeResetToken(parsed.data.token);
  if (!userId) {
    throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.");
  }

  const user = await getUserById(userId);
  if (!user) throw new HttpError(400, "This reset link is no longer valid.");

  const updated = await setPassword(userId, parsed.data.new_password);
  if (!updated) throw new HttpError(400, "This reset link is no longer valid.");

  // Belt and braces — consumeResetToken already removed this one.
  await revokeResetTokensForUser(userId);

  console.info(`Password reset completed for user ${userId}`);
  return c.json({
    success: true,
    message: "Your password has been reset. You can now log in with your new password.",
  });
});
