/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * User management service.
 *
 * Authentication is PocketID (OIDC) only — there are no passwords here. Each
 * account is linked to a PocketID subject (`pocket_id`); on first login we
 * match an existing account by username and backfill the link, or provision a
 * new non-admin account. Roles (admin/owner/pet), avatars and the owner
 * protections are unchanged. Storage is the DO blob store (key "users").
 */

import type { User, UserCreate, UserUpdate } from "../models";
import { adminUsername, adminDisplayName, adminEmail } from "../config";
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
      // ADMIN_EMAIL so contact metadata is present; an address already set by
      // hand always wins.
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

export async function getUserBySub(sub: string): Promise<User | null> {
  if (!sub) return null;
  const users = await getUsers();
  return users.find((u) => u.pocket_id && u.pocket_id === sub) ?? null;
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

/** Throw if `email` is already used by a different account. */
async function assertEmailAvailable(email: string, exceptUserId?: string): Promise<void> {
  const target = normalizeEmail(email);
  const users = await getUsers();
  const clash = users.find(
    (u) => u.id !== exceptUserId && u.email && normalizeEmail(u.email) === target,
  );
  if (clash) throw new Error("Email address is already in use");
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
    pocket_id: userCreate.pocket_id ?? null,
    display_name: userCreate.display_name ?? null,
    email,
    created_at: new Date().toISOString(),
    is_admin: isAdmin,
    is_owner: isOwner,
    is_pet: isPet,
    avatar_url: null,
  };

  users.push(newUser);
  await saveUsers(users);
  return newUser;
}

/**
 * Resolve a PocketID login to a local account.
 *
 * Match order: by the stable `pocket_id` subject first, then by username
 * (case-insensitive) so a pre-existing/owner account adopts its PocketID link
 * on first login. Unknown users are auto-provisioned as non-admins.
 */
export async function findOrCreateFromPocketId(claims: {
  sub: string;
  username: string;
  email?: string | null;
  displayName?: string | null;
}): Promise<User> {
  const users = await getUsers();

  const bySub = users.find((u) => u.pocket_id && u.pocket_id === claims.sub);
  const byName = users.find((u) => u.username.toLowerCase() === claims.username.toLowerCase());
  const existing = bySub ?? byName;

  if (existing) {
    const index = users.findIndex((u) => u.id === existing.id);
    let changed = false;

    if (existing.pocket_id !== claims.sub) {
      existing.pocket_id = claims.sub;
      changed = true;
    }
    // Backfill contact/profile metadata from the provider if we don't have it.
    if (!existing.email && claims.email) {
      existing.email = normalizeEmail(claims.email);
      changed = true;
    }
    if (!existing.display_name && claims.displayName) {
      existing.display_name = claims.displayName;
      changed = true;
    }

    if (changed) {
      users[index] = existing;
      await saveUsers(users);
    }
    return existing;
  }

  // First-time login for an unknown PocketID user → provision a plain account.
  return createUser({
    username: claims.username,
    pocket_id: claims.sub,
    email: claims.email ?? null,
    display_name: claims.displayName ?? null,
    is_admin: false,
    is_pet: false,
  });
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

  // ---- Email (contact metadata only) ------------------------------------
  // Editable by the account's own user or by an admin/owner. Identity is
  // proven by PocketID, so there is no confirmation step.
  let email = user.email ?? null;
  if (userUpdate.email !== undefined) {
    const requestedEmail = userUpdate.email ? normalizeEmail(userUpdate.email) : null;
    const isSelf = requestingUser?.id === user.id;
    const isAdminActing = !!requestingUser?.is_admin;

    if (requestedEmail !== email) {
      if (!isSelf && !isAdminActing) {
        throw new Error("You can only change your own email address");
      }
      if (requestedEmail) await assertEmailAvailable(requestedEmail, user.id);
      email = requestedEmail;
    }
  }

  const newIsOwner = isOwnerUsername(user.username);
  const newIsAdmin = newIsOwner ? true : userUpdate.is_admin ?? user.is_admin;
  const newIsPet = userUpdate.is_pet ?? user.is_pet;

  const updatedUser: User = {
    id: user.id,
    username: user.username,
    pocket_id: user.pocket_id ?? null,
    // `undefined` = field omitted, keep current value; explicit `null` clears it.
    display_name: userUpdate.display_name !== undefined ? userUpdate.display_name : user.display_name,
    email,
    created_at: user.created_at ?? null,
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
 * Seed the owner account from ADMIN_* env vars if no users exist yet.
 *
 * The account has no password — it becomes usable the first time the owner
 * signs in through PocketID with a matching `preferred_username`, at which
 * point its `pocket_id` link is filled in automatically (see
 * findOrCreateFromPocketId). Runs lazily on first request.
 */
export async function initializeAdminUser(): Promise<void> {
  const users = await getUsers();
  if (users.length > 0) return;

  const username = adminUsername();
  const displayName = adminDisplayName();

  try {
    const newUser: User = {
      id: crypto.randomUUID(),
      username,
      pocket_id: null,
      display_name: displayName,
      email: adminEmail() ?? null,
      created_at: new Date().toISOString(),
      is_admin: true,
      is_owner: true,
      is_pet: false,
      avatar_url: null,
    };
    await saveUsers([newUser]);
    console.info(`Seeded owner user: ${username}`);
  } catch (err) {
    console.error(`Error creating owner user: ${String(err)}`);
  }
}
