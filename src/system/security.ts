/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/** Constant-time key comparison and Turnstile verification. */

import { turnstileSecret } from "./config";
import { HttpError } from "./errors";

const enc = new TextEncoder();

/** Constant-time byte comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time string comparison, tolerant of differing lengths. */
export function constantTimeStringEqual(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
}

export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const secret = turnstileSecret();
  if (!secret) {
    console.error("TURNSTILE_SECRET environment variable not set");
    throw new HttpError(500, "Server configuration error");
  }

  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set("remoteip", remoteIp);

  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: params,
    });
    const data = (await resp.json()) as TurnstileResponse;
    if (!data.success) {
      console.warn(`Turnstile verification failed: ${JSON.stringify(data["error-codes"] ?? [])}`);
      return false;
    }
    return true;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error(`Failed to verify Turnstile token: ${String(err)}`);
    throw new HttpError(500, "Failed to verify security token");
  }
}
