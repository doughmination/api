/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * User management service. Same semantics/owner-protection as the old
 * backend; storage is the DO blob store (key "users") instead of users.json,
 * and hashing is PBKDF2 via ../security.
 */

import type { User, UserCreate, UserUpdate } from "../models";
import { adminUsername, adminPassword, adminDisplayName, adminEmail } from "../config";
import { hashPassword, verifyPassword, isSupportedHash } from "../security";
import { rt } from "../runtime";

const USERS_KEY = "users";

export function getOwnerUsername(): string {
  return adminUsername();
}

export function isOwnerUsername(username: string): boolean {
  return username.toLowerCase() === getOwnerUsername().toLowerCase();
}

export async function getUsers(): Promise<User[]> {
  const usersData = await rt().store.get<Array<Record<string, unknown>>>(USERS_KEY, []);

  return usersData.map((userDict) => {
    if (!("is_owner" in userDict)) userDict.is_owner = false;
    if (!("is_pet" in userDict)) userDict.is_pet = false;

    if (isOwnerUsername(String(userDict.username ?? ""))) {
      userDict.is_owner = true;
      userDict.is_admin = true;
      userDict.is_pet = true;
      // The owner account predates the email field. Backfill it from
      // ADMIN_EMAIL so password recovery works without a manual edit; an
      // address already set by hand always wins.
      if (!userDict.email) {
        const seeded = adminEmail();
        if (seeded) userDict.email = seeded;
      }
    }
    return userDict as unknown as User;
  });
}

export async function saveUsers(users: User[]): Promise<void> {
  for (const user of users) {
    if (isOwnerUsername(user.username)) {
      user.is_owner = true;
      user.is_admin = true;
      user.is_pet = true;
      // Persist the ADMIN_EMAIL backfill so it survives the env var going away.
      if (!user.email) {
        const seeded = adminEmail();
        if (seeded) user.email = seeded;
      }
    }
  }
  await rt().store.put(USERS_KEY, users);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.id === userId) ?? null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const target = normalizeEmail(email);
  if (!target) return null;
  const users = await getUsers();
  return users.find((u) => u.email && normalizeEmail(u.email) === target) ?? null;
}

/** Throw if `email` belongs to a different account. */
async function assertEmailAvailable(email: string, exceptUserId?: string): Promise<void> {
  const existing = await getUserByEmail(email);
  if (existing && existing.id !== exceptUserId) {
    throw new Error("Email address is already in use");
  }
}

export async function createUser(
  userCreate: UserCreate,
  requestingUser?: User | null,
): Promise<User> {
  const users = await getUsers();

  if (await getUserByUsername(userCreate.username)) {
    throw new Error(`Username '${userCreate.username}' already exists`);
  }

  if (isOwnerUsername(userCreate.username) && requestingUser != null) {
    throw new Error(
      "Cannot create user with owner username. Owner account must be created via initial setup.",
    );
  }

  let isOwner: boolean;
  let isAdmin: boolean;
  let isPet: boolean;

  if (isOwnerUsername(userCreate.username)) {
    isOwner = true;
    isAdmin = true;
    isPet = false;
  } else {
    isOwner = false;
    isAdmin = userCreate.is_admin;
    isPet = userCreate.is_pet;
  }

  const email = userCreate.email ? normalizeEmail(userCreate.email) : null;
  if (email) await assertEmailAvailable(email);

  const newUser: User = {
    id: crypto.randomUUID(),
    username: userCreate.username,
    password_hash: await hashPassword(userCreate.password),
    display_name: userCreate.display_name ?? null,
    email,
    is_admin: isAdmin,
    is_owner: isOwner,
    is_pet: isPet,
    avatar_url: null,
  };

  users.push(newUser);
  await saveUsers(users);
  return newUser;
}

export async function updateUser(
  userId: string,
  userUpdate: UserUpdate,
  requestingUser?: User | null,
): Promise<User | null> {
  const users = await getUsers();

  const index = users.findIndex((u) => u.id === userId);
  if (index === -1) return null;

  const user = users[index];

  if (user.is_owner && userUpdate.is_admin === false) {
    throw new Error("Cannot remove admin privileges from owner");
  }

  if (requestingUser && user.is_admin && requestingUser.id !== user.id) {
    if (!requestingUser.is_owner) {
      throw new Error("Only the owner can modify admin accounts");
    }
  }

  // Role assignment (admin/pet) is the owner's job — plain admins can edit
  // profiles but not grant or revoke roles.
  const wantsAdminChange = userUpdate.is_admin != null && userUpdate.is_admin !== user.is_admin;
  const wantsPetChange = userUpdate.is_pet != null && userUpdate.is_pet !== user.is_pet;
  if ((wantsAdminChange || wantsPetChange) && !requestingUser?.is_owner) {
    throw new Error("Only the owner can change user roles");
  }

  // Email is owner-managed only. Users cannot change their own address, and
  // plain admins cannot change anyone's — that's deliberate, because email is
  // the account-recovery factor.
  let email = user.email ?? null;
  if (userUpdate.email !== undefined) {
    const requestedEmail = userUpdate.email ? normalizeEmail(userUpdate.email) : null;
    const isChange = requestedEmail !== email;
    if (isChange) {
      if (!requestingUser?.is_owner) {
        throw new Error("Only the owner can change email addresses");
      }
      if (requestedEmail) await assertEmailAvailable(requestedEmail, user.id);
      email = requestedEmail;
    }
  }

  let passwordHash = user.password_hash;
  if (userUpdate.current_password && userUpdate.new_password) {
    if (!(await verifyPassword(userUpdate.current_password, user.password_hash))) {
      throw new Error("Current password is incorrect");
    }
    passwordHash = await hashPassword(userUpdate.new_password);
  }

  const newIsOwner = isOwnerUsername(user.username);
  const newIsAdmin = newIsOwner ? true : userUpdate.is_admin ?? user.is_admin;
  const newIsPet = userUpdate.is_pet ?? user.is_pet;

  const updatedUser: User = {
    id: user.id,
    username: user.username,
    password_hash: passwordHash,
    // `undefined` = field omitted, keep current value; explicit `null` clears it.
    display_name: userUpdate.display_name !== undefined ? userUpdate.display_name : user.display_name,
    email,
    is_admin: newIsAdmin,
    is_owner: newIsOwner,
    is_pet: newIsPet,
    avatar_url: userUpdate.avatar_url !== undefined ? userUpdate.avatar_url : user.avatar_url ?? null,
  };

  users[index] = updatedUser;
  await saveUsers(users);
  return updatedUser;
}

export async function deleteUser(userId: string, requestingUser?: User | null): Promise<boolean> {
  const users = await getUsers();

  const userToDelete = users.find((u) => u.id === userId);
  if (!userToDelete) return false;

  if (userToDelete.is_owner) {
    throw new Error("Cannot delete the owner account");
  }

  if (requestingUser && userToDelete.is_admin && !requestingUser.is_owner) {
    throw new Error("Only the owner can delete admin accounts");
  }

  const remaining = users.filter((u) => u.id !== userId);
  if (remaining.length < users.length) {
    await saveUsers(remaining);
    return true;
  }
  return false;
}

/**
 * Overwrite a user's password without knowing the current one.
 *
 * Only for flows that have already proven ownership another way — the
 * password-reset token path. Do NOT expose this to a plain authenticated
 * request; that's what updateUser's current_password check is for.
 */
export async function setPassword(userId: string, newPassword: string): Promise<boolean> {
  const users = await getUsers();
  const index = users.findIndex((u) => u.id === userId);
  if (index === -1) return false;

  users[index] = { ...users[index], password_hash: await hashPassword(newPassword) };
  await saveUsers(users);
  return true;
}

export async function verifyUser(username: string, password: string): Promise<User | null> {
  const user = await getUserByUsername(username);
  if (user && (await verifyPassword(password, user.password_hash))) {
    return user;
  }
  return null;
}

/**
 * Seed the owner account from ADMIN_* env vars if no users exist yet.
 * Runs lazily on first request (there is no startup phase on a Worker).
 * ADMIN_PASSWORD may be a plaintext password or a pre-computed pbkdf2 hash.
 */
export async function initializeAdminUser(): Promise<void> {
  const users = await getUsers();
  if (users.length > 0) return;

  const username = adminUsername();
  let passwordOrHash = adminPassword();
  const displayName = adminDisplayName();

  if (!passwordOrHash) {
    console.warn("No ADMIN_PASSWORD set. Using default password 'admin'.");
    passwordOrHash = "admin";
  }

  try {
    if (isSupportedHash(passwordOrHash)) {
      const newUser: User = {
        id: crypto.randomUUID(),
        username,
        password_hash: passwordOrHash,
        display_name: displayName,
        email: adminEmail() ?? null,
        is_admin: true,
        is_owner: true,
        is_pet: false,
        avatar_url: null,
      };
      await saveUsers([...users, newUser]);
    } else {
      await createUser({
        username,
        password: passwordOrHash,
        email: adminEmail() ?? null,
        display_name: displayName,
        is_admin: true,
        is_pet: false,
      });
    }
    console.info(`Seeded owner user: ${username}`);
  } catch (err) {
    console.error(`Error creating owner user: ${String(err)}`);
  }
}
