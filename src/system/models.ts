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
  /** Owner-only. Rejected with 403 for anyone else — see services/users.ts. */
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

export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema,
  turnstile_token: z.string().min(1, "Security verification is required"),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

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
