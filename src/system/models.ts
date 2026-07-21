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
  password_hash: z.string(),
  display_name: z.string().nullable().optional(),
  /** Optional on the schema so pre-existing accounts (created before emails
   *  were required) still load. New signups always set it. */
  email: z.string().nullable().optional(),
  /**
   * Whether `email` has been proven to belong to this user.
   *
   * MIGRATION SAFETY: accounts created before verification existed have this
   * field absent. Absent is read as TRUE (see services/users.ts) so that
   * legacy accounts are grandfathered — they can still log in, and the
   * unverified-account sweep will never delete them. Only rows that explicitly
   * say `false` are treated as unverified.
   */
  email_verified: z.boolean().optional(),
  email_verified_at: z.string().nullable().optional(),
  /** ISO timestamp. Absent on legacy accounts; the cleanup sweep requires it,
   *  which is a second guard against deleting pre-migration users. */
  created_at: z.string().nullable().optional(),
  /** A new address awaiting verification. `email` is not replaced until the
   *  user proves they control this one, so a typo can't lock them out. */
  pending_email: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_owner: z.boolean().default(false),
  is_pet: z.boolean().default(false),
  avatar_url: z.string().nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const UserCreateSchema = z.object({
  username: z.string(),
  password: z.string(),
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
  email_verified: z.boolean().optional(),
  pending_email: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_owner: z.boolean().default(false),
  is_pet: z.boolean().default(false),
  avatar_url: z.string().nullable().optional(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const UserUpdateSchema = z.object({
  display_name: z.string().nullable().optional(),
  current_password: z.string().nullable().optional(),
  new_password: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  /**
   * Changeable by the account's own user or by the owner — never by a plain
   * admin acting on someone else. A user changing their OWN address must also
   * send `current_password`, and the new address lands in `pending_email`
   * until verified. The owner sets addresses outright. See services/users.ts.
   */
  email: EmailSchema.nullable().optional(),
  is_admin: z.boolean().nullable().optional(),
  is_pet: z.boolean().nullable().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  turnstile_token: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Password reset is keyed on USERNAME — the link goes to whatever address is
 *  on file for that account. Users who've forgotten their username use
 *  ForgotUsernameRequest below to get it emailed to them first. */
export const ForgotPasswordRequestSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  turnstile_token: z.string().min(1, "Security verification is required"),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ForgotUsernameRequestSchema = z.object({
  email: EmailSchema,
  turnstile_token: z.string().min(1, "Security verification is required"),
});
export type ForgotUsernameRequest = z.infer<typeof ForgotUsernameRequestSchema>;

export const VerifyEmailRequestSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

/** Resend a verification email. Either a correction token (held by the tab
 *  that just signed up) or username+password identifies the account. */
export const ResendVerificationRequestSchema = z.object({
  correction_token: z.string().optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  turnstile_token: z.string().min(1, "Security verification is required"),
});
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

/**
 * Fix a mistyped address before verification, without a password.
 *
 * The correction token is what makes this safe: it is issued only to the
 * client that created the account, is short-lived, and only works while the
 * account is still unverified. Without it, this endpoint would let anyone
 * repoint an unverified account at their own inbox and claim it.
 */
export const CorrectEmailRequestSchema = z.object({
  correction_token: z.string().min(1, "Correction token is required"),
  email: EmailSchema,
  turnstile_token: z.string().min(1, "Security verification is required"),
});
export type CorrectEmailRequest = z.infer<typeof CorrectEmailRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  new_password: z.string().min(10, "Password must be at least 10 characters long"),
  turnstile_token: z.string().min(1, "Security verification is required"),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/** Strip the password hash for public-facing responses. */
export function toUserResponse(user: User): UserResponse {
  const { password_hash: _drop, ...rest } = user;
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
