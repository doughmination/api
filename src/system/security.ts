/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Security utilities, rewritten for the Workers runtime (Web Crypto only —
 * no `bcrypt`, `jsonwebtoken`, or `axios`).
 *
 *  - JWT: HS256 signed/verified with SubtleCrypto HMAC. This is the token the
 *    API issues to the browser AFTER a successful PocketID (OIDC) login, so
 *    every existing bearer-auth route keeps working unchanged.
 *  - OIDC helpers: cryptographically random state/PKCE-verifier generation and
 *    the S256 code-challenge digest.
 *  - Turnstile: verified with `fetch` (still used by the public guestbook).
 *
 * Local password hashing has been removed — login is PocketID-only.
 */

import { ACCESS_TOKEN_EXPIRE_MINUTES, jwtSecret, turnstileSecret } from "./config";
import { HttpError } from "./errors";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(obj: unknown): string {
  return bytesToB64url(enc.encode(JSON.stringify(obj)));
}

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
// OIDC / PKCE helpers
// ---------------------------------------------------------------------------

/** A URL-safe, cryptographically random token — used for OIDC `state` and the
 *  PKCE code verifier. `bytes` is the amount of entropy, not the string length. */
export function randomUrlToken(bytes = 32): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The PKCE S256 code challenge: base64url( SHA-256( verifier ) ). */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return bytesToB64url(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// JWT (HS256)
// ---------------------------------------------------------------------------

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(jwtSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createAccessToken(data: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...data,
    iat: now,
    exp: now + ACCESS_TOKEN_EXPIRE_MINUTES * 60,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await hmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(signingInput)));
  return `${signingInput}.${bytesToB64url(sig)}`;
}

export interface JwtPayload {
  sub?: string;
  [k: string]: unknown;
}

export async function decodeAccessToken(token: string): Promise<JwtPayload> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed");
    const [h, p, s] = parts;
    const key = await hmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(s),
      enc.encode(`${h}.${p}`),
    );
    if (!valid) throw new Error("bad signature");

    const payload = JSON.parse(dec.decode(b64urlToBytes(p))) as JwtPayload & { exp?: number };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("expired");
    }
    return payload;
  } catch {
    throw new HttpError(401, "Invalid or expired token", { "WWW-Authenticate": "Bearer" });
  }
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
