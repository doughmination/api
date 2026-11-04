/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Manual API-key verification (bot token + battery keys).
 *
 * These keys are now set MANUALLY as secrets/vars — nothing is generated on
 * first run and there is no longer a regenerate flow. Verification is a
 * constant-time comparison against the configured value(s).
 *   - Bot token:  DOUGH_BOT_TOKEN
 *   - Battery:    BATTERY_API_KEYS (comma-separated, one or more)
 */

import { rt } from "../runtime";
import { constantTimeStringEqual } from "../security";

// ---- Bot token ------------------------------------------------------------

export function verifyBotToken(providedToken: string): boolean {
  const configured = rt().env.DOUGH_BOT_TOKEN;
  if (!configured || !providedToken) return false;
  return constantTimeStringEqual(configured, providedToken);
}

// ---- Battery keys ---------------------------------------------------------

function batteryKeys(): string[] {
  return (rt().env.BATTERY_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export function verifyBatteryKey(providedKey: string): boolean {
  if (!providedKey) return false;
  let valid = false;
  // Loop over all keys (no early return) to keep timing independent of position.
  for (const key of batteryKeys()) {
    if (constantTimeStringEqual(key, providedKey)) valid = true;
  }
  return valid;
}

// ---- Guestbook moderation keys ----------------------------------------------

export function verifyGuestbookKey(providedKey: string): boolean {
  if (!providedKey) return false;
  let valid = false;
  for (const key of (rt().env.GUESTBOOK_ADMIN_KEYS ?? "").split(",").map((k) => k.trim())) {
    if (key && constantTimeStringEqual(key, providedKey)) valid = true;
  }
  return valid;
}
