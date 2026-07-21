/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Transactional email via Resend.
 *
 * Deliberately dependency-free — the `resend` npm package pulls in Node
 * built-ins that don't exist on Workers, and the REST API is a single POST.
 *
 * Sending never throws into a request handler: callers on the password-reset
 * path must not leak "this address exists" through an error response, so
 * failures are logged and reported as a boolean.
 */

import { emailFrom, resendApiBase, resendApiKey } from "../config";

function resendEndpoint(): string {
  return `${resendApiBase()}/emails`;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional Resend idempotency key, prevents duplicate sends on retry. */
  idempotencyKey?: string;
}

interface ResendErrorBody {
  message?: string;
  name?: string;
}

/**
 * Send one email. Returns true on success, false on any failure.
 * Never throws.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const apiKey = resendApiKey();
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set — cannot send email");
    return false;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  try {
    const resp = await fetch(resendEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: emailFrom(),
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as ResendErrorBody | null;
      // Log the status and Resend's message, never the recipient address.
      console.error(
        `Resend send failed: ${resp.status} ${body?.name ?? ""} ${body?.message ?? ""}`.trim(),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Resend request threw: ${String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PasswordResetEmail {
  displayName: string;
  resetUrl: string;
  ttlMinutes: number;
}

export function passwordResetTemplate({ displayName, resetUrl, ttlMinutes }: PasswordResetEmail): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(displayName);
  const url = escapeHtml(resetUrl);

  const text = [
    `Hi ${displayName},`,
    "",
    "Someone requested a password reset for your Doughmination System account.",
    "Open the link below to choose a new password:",
    "",
    resetUrl,
    "",
    `This link expires in ${ttlMinutes} minutes and can only be used once.`,
    "",
    "If you did not request this, you can ignore this email — your password",
    "will not change until the link above is used.",
    "",
    "— Doughmination System",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#1c0f14;font-family:ui-sans-serif,system-ui,sans-serif;color:#f5dde6;">
  <div style="max-width:520px;margin:0 auto;background:#2b1620;border:1px solid #3d1f2c;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 16px;font-size:20px;color:#ff5c8a;">Reset your password</h1>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Hi ${name},</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">
      Someone requested a password reset for your Doughmination System account.
      Use the button below to choose a new password.
    </p>
    <p style="margin:24px 0;text-align:center;">
      <a href="${url}" style="display:inline-block;background:#ff5c8a;color:#1c0f14;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:8px;font-size:15px;">Choose a new password</a>
    </p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#c9a8b9;">
      This link expires in ${ttlMinutes} minutes and can only be used once.
    </p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#c9a8b9;">
      If you did not request this, you can ignore this email — your password will
      not change until the link above is used.
    </p>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#9a7489;word-break:break-all;">
      Button not working? Paste this into your browser:<br />${url}
    </p>
  </div>
</body>
</html>`;

  return { subject: "Reset your Doughmination System password", html, text };
}
