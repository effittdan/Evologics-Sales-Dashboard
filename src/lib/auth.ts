import type { AppSession, AppUser, AppUserRole } from "../types";

const sharedSeedPasswordHash = "3c591eded51fdc8123d621739d6d1d4f252a0e70b6350c09b990d30e352edefb";

export const seedUsers: AppUser[] = [
  {
    id: "usr_theresa_hong",
    name: "Theresa Hong",
    email: "theresa@evologicsamerica.com",
    role: "administrator",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  },
  {
    id: "usr_dan_hong",
    name: "Dan Hong",
    email: "dan@effitt.com",
    role: "administrator",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  },
  {
    id: "usr_wendy_reyes",
    name: "Wendy Reyes",
    email: "wendy@evologicsamerica.com",
    role: "administrator",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  },
  {
    id: "usr_mike_crescenzo",
    name: "Mike Crescenzo",
    email: "mike@evologicsamerica.com",
    role: "user",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  },
  {
    id: "usr_ryan_gray",
    name: "Ryan Gray",
    email: "ryan@evologicsamerica.com",
    role: "user",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  },
  {
    id: "usr_jim_courville",
    name: "Jim Courville",
    email: "jim@evologicsamerica.com",
    role: "user",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  },
  {
    id: "usr_sam_williamson",
    name: "Sam Williamson",
    email: "sam@evologicsamerica.com",
    role: "user",
    status: "Active",
    passwordHash: sharedSeedPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  }
];

export function initializeUsers(storedUsers: AppUser[] | undefined | null) {
  if (!storedUsers?.length) return seedUsers;
  const usersByEmail = new Map(
    storedUsers.map((user) => [user.email.toLowerCase(), normalizeStoredUser(user)])
  );
  seedUsers.forEach((seedUser) => {
    const storedUser = usersByEmail.get(seedUser.email.toLowerCase());
    usersByEmail.set(seedUser.email.toLowerCase(), {
      ...storedUser,
      ...seedUser,
      lastLoginAt: storedUser?.lastLoginAt
    });
  });
  return [...usersByEmail.values()];
}

function normalizeStoredUser(user: AppUser): AppUser {
  return {
    ...user,
    role: user.role === "administrator" || user.role === "user" ? user.role : "user"
  };
}

export async function authenticateUser(users: AppUser[], email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find((item) => item.email.toLowerCase() === normalizedEmail);
  if (!user || user.status !== "Active") return undefined;
  const passwordHash = await hashPassword(password);
  return passwordHash === user.passwordHash ? user : undefined;
}

export async function createUserRecord(input: {
  name: string;
  email: string;
  role: AppUserRole;
  password: string;
}): Promise<AppUser> {
  return {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    status: "Active",
    passwordHash: await hashPassword(input.password),
    createdAt: new Date().toISOString()
  };
}

export function activeSessionUser(users: AppUser[], session?: AppSession | null) {
  if (!session) return undefined;
  return users.find((user) => user.id === session.userId && user.status === "Active");
}

export function approvedUserForEmail(users: AppUser[], email?: string | null) {
  if (!email) return undefined;
  return users.find((user) => user.email.toLowerCase() === email.trim().toLowerCase());
}

export async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
