/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Password-reset tokens.
 *
 * Policy (see PASSWORD_RESET_TTL_MINUTES in ../config):
 *   - valid for 15 minutes
 *   - single use — consumed the moment a reset succeeds
 *   - one active token per user — issuing a new one revokes the previous
 *
 * The raw token only ever exists in the email. What's persisted is a SHA-256
 * digest of it, so read access to the DO store does not let you take over an
 * account. Lookup is by digest, which is why the store is keyed on it.
 */

import { PASSWORD_RESET_TTL_MINUTES } from "../config";
import { rt } from "../runtime";

/** digest -> record */
const RESET_KEY = "password_resets";

interface ResetRecord {
  user_id: string;
  /** epoch ms */
  expires_at: number;
  created_at: number;
}

type ResetTable = Record<string, ResetRecord>;

const enc = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** SHA-256 hex digest. Tokens are high-entropy random, so a plain digest is
 *  sufficient here — no salt/stretching needed as there is nothing to guess. */
async function digestToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return bytesToHex(new Uint8Array(buf));
}

async function readTable(): Promise<ResetTable> {
  return rt().store.get<ResetTable>(RESET_KEY, {});
}

async function writeTable(table: ResetTable): Promise<void> {
  await rt().store.put(RESET_KEY, table);
}

/** Drop expired rows. Called on every read path so the table self-cleans. */
function pruneExpired(table: ResetTable, now: number): ResetTable {
  const out: ResetTable = {};
  for (const [digest, record] of Object.entries(table)) {
    if (record.expires_at > now) out[digest] = record;
  }
  return out;
}

/**
 * Issue a reset token for a user, revoking any token they already had.
 * Returns the RAW token — the only time it exists in plaintext. Put it in the
 * email and drop it.
 */
export async function createResetToken(userId: string): Promise<string> {
  const now = Date.now();
  const raw = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await digestToken(raw);

  const table = pruneExpired(await readTable(), now);

  // One active token per user: drop any existing rows for them first.
  for (const [existingDigest, record] of Object.entries(table)) {
    if (record.user_id === userId) delete table[existingDigest];
  }

  table[digest] = {
    user_id: userId,
    created_at: now,
    expires_at: now + PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
  };

  await writeTable(table);
  return raw;
}

/**
 * Look up a token without consuming it. Returns the user id, or null when the
 * token is unknown or expired. Use for a "is this link still good?" check
 * before showing the form.
 */
export async function peekResetToken(token: string): Promise<string | null> {
  const now = Date.now();
  const digest = await digestToken(token);
  const table = await readTable();
  const record = table[digest];
  if (!record || record.expires_at <= now) return null;
  return record.user_id;
}

/**
 * Consume a token. Returns the user id on success, null if unknown or
 * expired. The row is deleted before the caller changes the password, so a
 * token cannot be replayed even if two requests race.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  const now = Date.now();
  const digest = await digestToken(token);
  const table = pruneExpired(await readTable(), now);

  const record = table[digest];
  if (!record) {
    // Still persist the prune so expired rows don't accumulate.
    await writeTable(table);
    return null;
  }

  delete table[digest];
  await writeTable(table);

  if (record.expires_at <= now) return null;
  return record.user_id;
}

/** Revoke every outstanding token for a user (e.g. after a password change). */
export async function revokeResetTokensForUser(userId: string): Promise<void> {
  const table = pruneExpired(await readTable(), Date.now());
  let changed = false;
  for (const [digest, record] of Object.entries(table)) {
    if (record.user_id === userId) {
      delete table[digest];
      changed = true;
    }
  }
  if (changed) await writeTable(table);
}
