/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Email verification:
 *
 *   POST /v2/plural/verify-email          confirm an address with a token
 *   POST /v2/plural/resend-verification   send the confirmation link again
 *   POST /v2/plural/correct-email         fix a typo'd address, no password
 *
 * `correct-email` is the one to be careful with. It deliberately skips the
 * password so someone who mistyped their address at signup isn't locked out of
 * a mailbox they can't read. What makes that safe is the correction token: it
 * is returned only to the client that created the account, expires in a couple
 * of hours, is scoped to that one account, and stops working the moment the
 * account is verified. Without it this endpoint would let anyone repoint any
 * unverified account at their own inbox and claim it.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import type { Env } from "../hono";
import {
  CorrectEmailRequestSchema,
  ResendVerificationRequestSchema,
  VerifyEmailRequestSchema,
} from "../models";
import type { User } from "../models";
import { frontendUrl, verificationUrl, UNVERIFIED_ACCOUNT_TTL_HOURS } from "../config";
import {
  applyEmailVerification,
  correctUnverifiedEmail,
  getUserById,
  getUserByUsername,
  isEmailVerified,
  verifyUser,
} from "../services/users";
import {
  CORRECTION_TTL_HOURS,
  VERIFICATION_TTL_HOURS,
  createVerificationToken,
  consumeVerificationToken,
  peekCorrectionToken,
  revokeCorrectionTokensForUser,
} from "../services/email_verification";
import { sendEmail, verifyEmailTemplate } from "../services/email";
import { verifyTurnstileToken } from "../security";
import { HttpError } from "../errors";
import { rt } from "../runtime";

export const emailVerificationRoutes = new Hono<Env>();

const RATE_LIMIT_SECONDS = 60;

function clientIp(c: Context): string | undefined {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
}

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
 * Issue a token for `address` and email the confirmation link.
 * Shared by signup, resend, correction, and self-service email change.
 */
export async function sendVerificationEmail(
  user: User,
  address: string,
  purpose: "signup" | "change",
): Promise<boolean> {
  const token = await createVerificationToken(user.id, address, purpose);
  const link = `${verificationUrl()}?token=${encodeURIComponent(token)}`;

  const { subject, html, text } = verifyEmailTemplate({
    displayName: user.display_name || user.username,
    verifyUrl: link,
    ttlHours: VERIFICATION_TTL_HOURS,
    isChange: purpose === "change",
    deleteAfterHours: purpose === "signup" ? UNVERIFIED_ACCOUNT_TTL_HOURS : undefined,
  });

  return sendEmail({ to: address, subject, html, text });
}

// ---------------------------------------------------------------------------
// POST /verify-email
// ---------------------------------------------------------------------------

emailVerificationRoutes.post("/verify-email", async (c) => {
  const parsed = VerifyEmailRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const claim = await consumeVerificationToken(parsed.data.token);
  if (!claim) {
    throw new HttpError(
      400,
      "This confirmation link is invalid or has expired. Request a new one from the login page.",
    );
  }

  const updated = await applyEmailVerification(claim.userId, claim.email);
  if (!updated) {
    // Either the account is gone (swept as unverified) or the address moved on
    // after this token was issued, which makes the link stale.
    throw new HttpError(
      400,
      "This confirmation link is no longer valid. Request a new one from the login page.",
    );
  }

  // A verified account has no further use for its correction token.
  await revokeCorrectionTokensForUser(updated.id);

  console.info(`Email verified for user ${updated.id}`);
  return c.json({
    success: true,
    message: "Email confirmed. You can now log in.",
    username: updated.username,
  });
});

// ---------------------------------------------------------------------------
// POST /resend-verification
// ---------------------------------------------------------------------------

emailVerificationRoutes.post("/resend-verification", async (c) => {
  const parsed = ResendVerificationRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  if (!(await checkAndRecordRateLimit("resendverify_rl:", clientIp(c)))) {
    throw new HttpError(429, "Too many requests. Please wait a minute and try again.");
  }

  // Identify the account either by the signup tab's correction token, or by
  // credentials — login is blocked while unverified, so a correct password is
  // the only other way to prove which account this is.
  let user: User | null = null;

  if (parsed.data.correction_token) {
    const userId = await peekCorrectionToken(parsed.data.correction_token);
    if (userId) user = await getUserById(userId);
  } else if (parsed.data.username && parsed.data.password) {
    user = await verifyUser(parsed.data.username, parsed.data.password);
  } else {
    throw new HttpError(400, "Provide your username and password, or use the link from signup.");
  }

  if (!user) throw new HttpError(401, "We couldn't confirm which account that is.");

  const address = user.pending_email || user.email;
  if (!address) throw new HttpError(409, "That account has no email address on file.");

  if (isEmailVerified(user) && !user.pending_email) {
    return c.json({ success: true, message: "That address is already confirmed.", already: true });
  }

  const sent = await sendVerificationEmail(user, address, user.pending_email ? "change" : "signup");
  if (!sent) {
    throw new HttpError(502, "We couldn't send that email just now. Please try again shortly.");
  }

  return c.json({ success: true, message: "Confirmation email sent. Check your inbox." });
});

// ---------------------------------------------------------------------------
// POST /correct-email
// ---------------------------------------------------------------------------

emailVerificationRoutes.post("/correct-email", async (c) => {
  const parsed = CorrectEmailRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(400, firstIssueMessage(parsed.error.issues, "Invalid request format"));
  }

  const ok = await verifyTurnstileToken(parsed.data.turnstile_token, clientIp(c));
  if (!ok) throw new HttpError(400, "Security verification failed");

  if (!(await checkAndRecordRateLimit("correctemail_rl:", clientIp(c)))) {
    throw new HttpError(429, "Too many requests. Please wait a minute and try again.");
  }

  const userId = await peekCorrectionToken(parsed.data.correction_token);
  if (!userId) {
    throw new HttpError(
      400,
      "That correction link has expired. Sign up again, or contact @doughmination.",
    );
  }

  const user = await getUserById(userId);
  if (!user) throw new HttpError(404, "That account no longer exists.");

  let updated: User | null;
  try {
    updated = await correctUnverifiedEmail(user.id, parsed.data.email);
  } catch (err) {
    throw new HttpError(400, String(err instanceof Error ? err.message : err));
  }
  if (!updated) throw new HttpError(404, "That account no longer exists.");

  const sent = await sendVerificationEmail(updated, parsed.data.email, "signup");
  if (!sent) {
    throw new HttpError(502, "Address updated, but we couldn't send the confirmation email.");
  }

  return c.json({
    success: true,
    message: "Address updated. We've sent a new confirmation email.",
    login_url: `${frontendUrl()}/user/login`,
    correction_expires_in_hours: CORRECTION_TTL_HOURS,
  });
});
