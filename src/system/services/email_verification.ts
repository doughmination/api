/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Email verification and "correction" tokens.
 *
 * Two token kinds live here:
 *
 *  - VERIFICATION — emailed to an address to prove the user controls it.
 *    Carries the address being proven, so a change that lands in
 *    `pending_email` can be applied on confirmation.
 *
 *  - CORRECTION — handed to the client that just created an account, so a
 *    mistyped address can be fixed without a password. This is the only thing
 *    authorising that endpoint, so it is scoped to one account, expires
 *    quickly, and is refused once the account is verified.
 *
 * As with password resets, only a SHA-256 digest of each token is persisted;
 * the raw value exists in the email (or the signup response) and nowhere else.
 */

import { rt } from "../runtime";

const VERIFY_KEY = "email_verifications";
const CORRECTION_KEY = "email_corrections";

/** A verification link should outlive a night's sleep. */
export const VERIFICATION_TTL_HOURS = 24;
/** The correction token only needs to survive the signup sitting. */
export const CORRECTION_TTL_HOURS = 2;

export type VerificationPurpose = "signup" | "change";

interface VerificationRecord {
  user_id: string;
  /** The address this token proves. May differ from the user's current email
   *  when it's a pending change. */
  email: string;
  purpose: VerificationPurpose;
  expires_at: number;
  created_at: number;
}

interface CorrectionRecord {
  user_id: string;
  expires_at: number;
  created_at: number;
}

const enc = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function digestToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return bytesToHex(new Uint8Array(buf));
}

function newToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

function pruneExpired<T extends { expires_at: number }>(
  table: Record<string, T>,
  now: number,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [digest, record] of Object.entries(table)) {
    if (record.expires_at > now) out[digest] = record;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verification tokens
// ---------------------------------------------------------------------------

/**
 * Issue a verification token for `email`, revoking any earlier one for the
 * same user so an old link can't resurrect a superseded address.
 */
export async function createVerificationToken(
  userId: string,
  email: string,
  purpose: VerificationPurpose,
): Promise<string> {
  const now = Date.now();
  const raw = newToken();
  const digest = await digestToken(raw);

  const table = pruneExpired(
    await rt().store.get<Record<string, VerificationRecord>>(VERIFY_KEY, {}),
    now,
  );

  for (const [existing, record] of Object.entries(table)) {
    if (record.user_id === userId) delete table[existing];
  }

  table[digest] = {
    user_id: userId,
    email,
    purpose,
    created_at: now,
    expires_at: now + VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
  };

  await rt().store.put(VERIFY_KEY, table);
  return raw;
}

/** Spend a verification token. Returns its payload, or null if unknown/expired. */
export async function consumeVerificationToken(
  token: string,
): Promise<{ userId: string; email: string; purpose: VerificationPurpose } | null> {
  const now = Date.now();
  const digest = await digestToken(token);
  const table = pruneExpired(
    await rt().store.get<Record<string, VerificationRecord>>(VERIFY_KEY, {}),
    now,
  );

  const record = table[digest];
  if (!record) {
    await rt().store.put(VERIFY_KEY, table);
    return null;
  }

  delete table[digest];
  await rt().store.put(VERIFY_KEY, table);

  if (record.expires_at <= now) return null;
  return { userId: record.user_id, email: record.email, purpose: record.purpose };
}

export async function revokeVerificationTokensForUser(userId: string): Promise<void> {
  const table = pruneExpired(
    await rt().store.get<Record<string, VerificationRecord>>(VERIFY_KEY, {}),
    Date.now(),
  );
  let changed = false;
  for (const [digest, record] of Object.entries(table)) {
    if (record.user_id === userId) {
      delete table[digest];
      changed = true;
    }
  }
  if (changed) await rt().store.put(VERIFY_KEY, table);
}

// ---------------------------------------------------------------------------
// Correction tokens
// ---------------------------------------------------------------------------

/** Issue the token that lets a freshly-signed-up client fix its address. */
export async function createCorrectionToken(userId: string): Promise<string> {
  const now = Date.now();
  const raw = newToken();
  const digest = await digestToken(raw);

  const table = pruneExpired(
    await rt().store.get<Record<string, CorrectionRecord>>(CORRECTION_KEY, {}),
    now,
  );

  for (const [existing, record] of Object.entries(table)) {
    if (record.user_id === userId) delete table[existing];
  }

  table[digest] = {
    user_id: userId,
    created_at: now,
    expires_at: now + CORRECTION_TTL_HOURS * 60 * 60 * 1000,
  };

  await rt().store.put(CORRECTION_KEY, table);
  return raw;
}

/**
 * Resolve a correction token to its user WITHOUT spending it — correcting an
 * address twice (two typos) has to keep working within the window.
 */
export async function peekCorrectionToken(token: string): Promise<string | null> {
  const now = Date.now();
  const digest = await digestToken(token);
  const table = await rt().store.get<Record<string, CorrectionRecord>>(CORRECTION_KEY, {});
  const record = table[digest];
  if (!record || record.expires_at <= now) return null;
  return record.user_id;
}

/** Drop a user's correction token — called once they verify. */
export async function revokeCorrectionTokensForUser(userId: string): Promise<void> {
  const table = pruneExpired(
    await rt().store.get<Record<string, CorrectionRecord>>(CORRECTION_KEY, {}),
    Date.now(),
  );
  let changed = false;
  for (const [digest, record] of Object.entries(table)) {
    if (record.user_id === userId) {
      delete table[digest];
      changed = true;
    }
  }
  if (changed) await rt().store.put(CORRECTION_KEY, table);
}
