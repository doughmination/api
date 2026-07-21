/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Account recovery:
 *
 *   POST /v2/plural/forgot-password        username  -> reset link, emailed
 *   POST /v2/plural/forgot-username        email     -> username, emailed
 *   GET  /v2/plural/reset-password/check   is this token still usable?
 *   POST /v2/plural/reset-password         set a new password with a token
 *
 * Password reset is keyed on USERNAME: the link is sent to whatever address is
 * on file for that account, and the response reports a masked hint (a•••@d•••)
 * so the user knows which inbox to open without the full address being printed
 * to anyone who guesses a username.
 *
 * NOTE ON ENUMERATION — deliberate product decision, not an oversight.
 * /forgot-password says so when a username doesn't exist, and /forgot-username
 * says so when an address isn't registered, so users aren't left waiting on
 * mail that was never going to arrive. The trade-off is that both endpoints
 * confirm whether an account exists. The per-IP rate limits below are
 * therefore the primary abuse control on these routes, not a secondary one —
 * do not relax them.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import {
  ForgotPasswordRequestSchema,
  ForgotUsernameRequestSchema,
  ResetPasswordRequestSchema,
} from "../models";
import { PASSWORD_RESET_TTL_MINUTES, frontendUrl, passwordResetUrl } from "../config";
import { getUserByEmail, getUserById, getUserByUsername, setPassword } from "../services/users";
import {
  consumeResetToken,
  createResetToken,
  peekResetToken,
  revokeResetTokensForUser,
} from "../services/password_reset";
import { passwordResetTemplate, sendEmail, usernameReminderTemplate } from "../services/email";
import { verifyTurnstileToken } from "../security";
import { HttpError } from "../errors";
import { rt } from "../runtime";

export const passwordResetRoutes = new Hono<Env>();

/** Minimum seconds between recovery requests from one IP. Because these
 *  endpoints confirm account existence (see module comment), this is what
 *  keeps bulk probing impractical. */
const RATE_LIMIT_SECONDS = 60;

function clientIp(c: Context): string | undefined {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
}

/** Per-IP throttle. True = allowed (and recorded). Blank IP is never limited. */
async function checkAndRecordRateLimit(prefix: string, ip: string | undefined): Promise<boolean> {
  if (!ip) return true;
  const key = prefix + ip;
  const last = await rt().store.get<number>(key, 0);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) return false;
  await rt().store.put(key, now);
  return true;
}

function firstIssueMessage(issues: Array<{ message: string }>, fallback: string): string {
  return issues[0]?.message ?? fallback;
}

/**
 * Mask an address for display: `admin@doughmination.win` -> `a•••@d•••.win`.
 * Enough to recognise your own inbox, not enough to learn someone else's.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  const maskedLocal = local.length <= 1 ? "•" : `${local[0]}•••`;

  const dot = domain.lastIndexOf(".");
  if (dot <= 0) return `${maskedLocal}@•••`;

  const domainName = domain.slice(0, dot);
  const tld = domain.slice(dot); // includes the dot
  const maskedDomain = domainName.length <= 1 ? "•" : `${domainName[0]}•••`;

  return `${maskedLocal}@${maskedDomain}${tld}`;
}

// ---------------------------------------------------------------------------
// POST /forgot-password  — by username
// ---------------------------------------------------------------------------

passwordResetRoutes.post("/forgot-password", async (c) => {
  const parsed = ForgotPasswordRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  if (!(await checkAndRecordRateLimit("pwreset_rl:", clientIp(c)))) {
    throw new HttpError(429, "Too many reset requests. Please wait a minute and try again.");
  }

  const user = await getUserByUsername(parsed.data.username);
  if (!user) {
    throw new HttpError(
      404,
      "No account exists with that username. Check the spelling, or use “forgot username” if you're not sure.",
    );
  }

  if (!user.email) {
    throw new HttpError(
      409,
      "That account has no email address on file, so it can't be reset automatically. Contact @doughmination to recover it.",
    );
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
    console.error(`Failed to send password reset email for user ${user.id}`);
    throw new HttpError(
      502,
      "We couldn't send the reset email just now. Please try again in a few minutes.",
    );
  }

  return c.json({
    success: true,
    message: "Reset link sent. The link expires in 15 minutes.",
    sent_to: maskEmail(user.email),
  });
});

// ---------------------------------------------------------------------------
// POST /forgot-username  — by email
// ---------------------------------------------------------------------------

passwordResetRoutes.post("/forgot-username", async (c) => {
  const parsed = ForgotUsernameRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  if (!(await checkAndRecordRateLimit("username_rl:", clientIp(c)))) {
    throw new HttpError(429, "Too many requests. Please wait a minute and try again.");
  }

  const user = await getUserByEmail(parsed.data.email);
  if (!user) {
    throw new HttpError(404, "No account is registered with that email address.");
  }

  // The username is emailed rather than returned, so that knowing an address
  // isn't enough to learn the username attached to it.
  const { subject, html, text } = usernameReminderTemplate({
    username: user.username,
    displayName: user.display_name || user.username,
    loginUrl: `${frontendUrl()}/user/login`,
  });

  const sent = await sendEmail({ to: parsed.data.email, subject, html, text });
  if (!sent) {
    console.error(`Failed to send username reminder for user ${user.id}`);
    throw new HttpError(
      502,
      "We couldn't send that email just now. Please try again in a few minutes.",
    );
  }

  return c.json({
    success: true,
    message: "We've sent your username to that address.",
    sent_to: maskEmail(parsed.data.email),
  });
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
    username: user.username,
  });
});
