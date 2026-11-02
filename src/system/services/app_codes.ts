/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * One-time sign-in codes for native apps.
 *
 * A browser can be handed its JWT in a URL fragment, but an app's redirect URI
 * (a custom scheme) can be claimed by any other app on the phone. So an
 * app-started login ends with a short-lived, single-use code instead, and the
 * app swaps it at POST /v2/plural/auth/app/token together with the PKCE
 * verifier only it holds. Anyone else who catches the redirect gets a useless
 * code: without the verifier it can't be redeemed, and once redeemed (or after
 * a minute) it's gone.
 */

import { rt } from "../runtime";
import { constantTimeStringEqual, randomUrlToken, sha256Base64Url } from "../security";

/** How long an app has to redeem its code. */
export const APP_CODE_TTL_SECONDS = 60;

/** An S256 PKCE challenge: base64url of a SHA-256 digest, 43 characters. */
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** A code from saveAppCode: 32 random bytes, base64url. */
export const APP_CODE = /^[A-Za-z0-9_-]{43}$/;

/** RFC 7636 verifier: 43–128 unreserved characters. */
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

interface StoredAppCode {
  token: string;
  challenge: string;
  expiresAt: number;
}

function codeKey(code: string): string {
  return `app_code:${code}`;
}

/** Park a freshly minted JWT behind a one-time code bound to the app's challenge. */
export async function saveAppCode(token: string, challenge: string): Promise<string> {
  const code = randomUrlToken(32);
  await rt().store.put(codeKey(code), {
    token,
    challenge,
    expiresAt: Date.now() + APP_CODE_TTL_SECONDS * 1000,
  } satisfies StoredAppCode);
  return code;
}

/**
 * The JWT for a code, exactly once. The code is consumed on the first attempt,
 * right or wrong, so a guessed verifier can't be retried. Null when the code is
 * unknown, already used, expired, or the verifier doesn't match.
 */
export async function takeAppCode(code: string, verifier: string): Promise<string | null> {
  const key = codeKey(code);
  const stored = await rt().store.get<StoredAppCode | null>(key, null);
  if (!stored) return null;
  await rt().store.delete(key);

  if (Date.now() > stored.expiresAt) return null;
  const challenge = await sha256Base64Url(verifier);
  return constantTimeStringEqual(challenge, stored.challenge) ? stored.token : null;
}
