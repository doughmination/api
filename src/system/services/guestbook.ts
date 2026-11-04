/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Guestbook state. Ported from the standalone `guestbook` Worker (Cloudflare
 * KV) to the SystemState DO blob store. Entries live newest-first in a single
 * JSON blob under `guestbook_entries`; each entry carries a random UID so it
 * can be deleted individually.
 *
 * Per-IP rate limiting is kept, stored as a timestamp under
 * `guestbook_rl:<ip>` (compared against RATE_LIMIT_SECONDS on each POST).
 *
 * Moderation: every new entry is checked against a word blocklist (stored
 * under `guestbook_blocklist`, managed through the admin routes). A hit holds
 * the entry as "pending" until an admin approves or deletes it; only
 * "approved" entries are ever served publicly. Entries from before moderation
 * existed carry no status and count as approved.
 */

import { rt } from "../runtime";

export type GuestbookStatus = "approved" | "pending";

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  website: string;
  ts: number;
  status?: GuestbookStatus;
  /** Blocklist terms that held this entry for review (admin-only). */
  flagged?: string[];
}

/** Fields a caller may submit. */
export interface GuestbookInput {
  name: string;
  message: string;
  website: string;
}

const ENTRIES_KEY = "guestbook_entries";
const BLOCKLIST_KEY = "guestbook_blocklist";
const RL_PREFIX = "guestbook_rl:";
const MAX_BLOCKLIST = 2000;
const MAX_ENTRIES = 1000; // keep the blob bounded (well under the DO 128KB value cap)

export const RATE_LIMIT_SECONDS = 60; // min seconds between posts from one IP

export const LIMITS = {
  name: 40,
  message: 500,
  website: 200,
} as const;

// Collapse whitespace, trim, and strip control chars. We do NOT store HTML;
// consumers render everything as text, so this is just tidy-up.
export function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Accept only http(s) links; otherwise drop it.
export function cleanWebsite(value: unknown): string {
  const v = clean(value, LIMITS.website);
  if (!v) return "";
  let url = v;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString().slice(0, LIMITS.website);
  } catch {
    return "";
  }
}

// ---- Blocklist ---------------------------------------------------------------

// Characters people swap in to dodge a filter, mapped back to the letter.
const LOOKALIKES: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e", "£": "l",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", // Cyrillic
};

/**
 * Reduce text to bare letters so "B.a-d", "b a d", "bаd" (Cyrillic а), "b@d"
 * and "baaad" all become "bad". Applied to both the text and each blocklist
 * term, so they always compare like for like.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents left behind by NFKD
    .toLowerCase()
    .replace(/./gu, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/[^\p{L}]/gu, "")
    .replace(/(.)\1+/gu, "$1");
}

export async function readBlocklist(): Promise<string[]> {
  return rt().store.get<string[]>(BLOCKLIST_KEY, []);
}

/** Replace the whole blocklist. Returns the cleaned, de-duplicated list. */
export async function saveBlocklist(words: unknown): Promise<string[]> {
  const list = Array.isArray(words) ? words : [];
  const cleaned = [
    ...new Set(list.map((w) => clean(w, 100).toLowerCase()).filter((w) => normalize(w))),
  ].slice(0, MAX_BLOCKLIST);
  await rt().store.put(BLOCKLIST_KEY, cleaned);
  return cleaned;
}

/**
 * Blocklist terms found anywhere in the given fields. Matching runs on the
 * normalized, space-free text, so it errs towards holding too much (a term
 * inside an innocent word); that only costs an approval click, while a miss
 * would publish the message.
 */
export async function findBlocked(...fields: string[]): Promise<string[]> {
  const haystack = normalize(fields.join(" "));
  if (!haystack) return [];
  const hits: string[] = [];
  for (const term of await readBlocklist()) {
    const needle = normalize(term);
    if (needle && haystack.includes(needle)) hits.push(term);
  }
  return hits;
}

// ---- Entries -----------------------------------------------------------------

export function isApproved(entry: GuestbookEntry): boolean {
  return (entry.status ?? "approved") === "approved";
}

/** An entry as served publicly: no moderation fields. */
export function publicEntry(entry: GuestbookEntry) {
  const { id, name, message, website, ts } = entry;
  return { id, name, message, website, ts };
}

export async function readEntries(): Promise<GuestbookEntry[]> {
  return rt().store.get<GuestbookEntry[]>(ENTRIES_KEY, []);
}

async function saveEntries(entries: GuestbookEntry[]): Promise<void> {
  await rt().store.put(ENTRIES_KEY, entries);
}

/**
 * Insert a new entry (newest first) with a fresh UID and the current time.
 * Inputs are assumed already cleaned/validated by the caller. Anything that
 * hits the blocklist is held as pending.
 */
export async function addEntry(input: GuestbookInput): Promise<GuestbookEntry> {
  const flagged = await findBlocked(input.name, input.message, input.website);
  const entry: GuestbookEntry = {
    id: crypto.randomUUID(),
    name: input.name,
    message: input.message,
    website: input.website,
    ts: Date.now(),
    status: flagged.length ? "pending" : "approved",
    ...(flagged.length ? { flagged } : {}),
  };

  const entries = await readEntries();
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  await saveEntries(entries);
  return entry;
}

/** Remove an entry by UID. Returns true if it existed and was deleted. */
export async function deleteEntry(id: string): Promise<boolean> {
  const entries = await readEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await saveEntries(entries);
  return true;
}

/**
 * Admin edit: change an entry's status and/or text. Fields are cleaned the
 * same way as a public post. Returns the updated entry, or null if not found.
 */
export async function updateEntry(
  id: string,
  patch: { status?: unknown; name?: unknown; message?: unknown; website?: unknown },
): Promise<GuestbookEntry | null> {
  const entries = await readEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;

  if (patch.status === "approved" || patch.status === "pending") entry.status = patch.status;
  if (patch.status === "approved") delete entry.flagged;
  if (patch.name !== undefined) entry.name = clean(patch.name, LIMITS.name) || entry.name;
  if (patch.message !== undefined) entry.message = clean(patch.message, LIMITS.message) || entry.message;
  if (patch.website !== undefined) entry.website = cleanWebsite(patch.website);

  await saveEntries(entries);
  return entry;
}

/**
 * Per-IP rate limit. Returns true if the caller is allowed to post now (and
 * records this post's time); false if they posted within RATE_LIMIT_SECONDS.
 * A blank IP is never rate-limited.
 */
export async function checkAndRecordRateLimit(ip: string | undefined): Promise<boolean> {
  if (!ip) return true;
  const key = RL_PREFIX + ip;
  const last = await rt().store.get<number>(key, 0);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) return false;
  await rt().store.put(key, now);
  return true;
}
