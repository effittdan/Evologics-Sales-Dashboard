import type { AppSession, AppUser, AppUserRole } from "../types";

const theresaPasswordHash = "3c591eded51fdc8123d621739d6d1d4f252a0e70b6350c09b990d30e352edefb";

export const seedUsers: AppUser[] = [
  {
    id: "usr_theresa_hong",
    name: "Theresa Hong",
    email: "theresa@evologicsamerica.com",
    role: "Admin",
    status: "Active",
    passwordHash: theresaPasswordHash,
    createdAt: "2026-07-09T00:00:00.000Z"
  }
];

export function initializeUsers(storedUsers: AppUser[] | undefined | null) {
  if (!storedUsers?.length) return seedUsers;
  const usersByEmail = new Map(storedUsers.map((user) => [user.email.toLowerCase(), user]));
  seedUsers.forEach((seedUser) => {
    if (!usersByEmail.has(seedUser.email.toLowerCase())) {
      usersByEmail.set(seedUser.email.toLowerCase(), seedUser);
    }
  });
  return [...usersByEmail.values()];
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

export async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
