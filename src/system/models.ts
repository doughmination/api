/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * zod models + types. Field names stay snake_case to match the existing
 * data blobs and the frontend wire format. Consolidated from the old
 * models/user.ts + models/index.ts.
 */

import { z } from "zod";

// ============================================================================
// USER MODELS
// ============================================================================

/** Emails are stored lowercased and trimmed so uniqueness checks are stable. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Must be a valid email address")
  .max(254, "Email address is too long");

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  /**
   * The OIDC subject (`sub`) this account is linked to. The field keeps its
   * original name so stored records load unchanged: accounts linked before the
   * move to the Doughmination SSO hold a PocketID subject here.
   * Optional so the owner seed and pre-link accounts still load.
   */
  pocket_id: z.string().nullable().optional(),
  /**
   * Issuer that `pocket_id` belongs to. Null/absent = linked before the SSO
   * move (or never linked), which is what lets the first SSO sign-in adopt the
   * account by username exactly once.
   */
  sso_issuer: z.string().nullable().optional(),
  /**
   * Legacy PBKDF2 hash from the retired password login. Kept optional purely
   * so old stored records still parse; it is never read or written any more.
   */
  password_hash: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  /** Email address, populated from the SSO `email` claim when available. */
  email: z.string().nullable().optional(),
  /** ISO timestamp of account creation. Absent on legacy accounts. */
  created_at: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_owner: z.boolean().default(false),
  is_pet: z.boolean().default(false),
  avatar_url: z.string().nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const UserCreateSchema = z.object({
  username: z.string(),
  /** Set when an admin pre-provisions an account before its first SSO login
   *  (the SSO subject id); normally the link is established automatically. */
  pocket_id: z.string().nullable().optional(),
  email: EmailSchema.nullable().optional(),
  display_name: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_pet: z.boolean().default(false),
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

export const UserResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_owner: z.boolean().default(false),
  is_pet: z.boolean().default(false),
  avatar_url: z.string().nullable().optional(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const UserUpdateSchema = z.object({
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  /**
   * Profile email. Changeable by the account's own user or by an admin/owner.
   * There is no confirmation step any more — identity is proven by the SSO,
   * so this field is purely informational/contact metadata.
   */
  email: EmailSchema.nullable().optional(),
  is_admin: z.boolean().nullable().optional(),
  is_pet: z.boolean().nullable().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

/** Strip internal-only fields for public-facing responses. */
export function toUserResponse(user: User): UserResponse {
  const { password_hash: _pw, pocket_id: _sub, sso_issuer: _iss, ...rest } = user;
  return rest;
}

// ============================================================================
// SYSTEM / MENTAL STATE
// ============================================================================

export const MentalStateSchema = z.object({
  level: z.string(),
  updated_at: z.coerce.date().default(() => new Date()),
  notes: z.string().nullable().optional(),
});
export type MentalState = z.infer<typeof MentalStateSchema>;

// ============================================================================
// BOT MODELS
// ============================================================================

export const MultiSwitchRequestSchema = z.object({
  member_ids: z.array(z.string()),
});
export type MultiSwitchRequest = z.infer<typeof MultiSwitchRequestSchema>;
