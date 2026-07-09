import { describe, expect, it } from "vitest";
import {
  activeSessionUser,
  authenticateUser,
  createUserRecord,
  initializeUsers,
  seedUsers
} from "../src/lib/auth";

describe("local auth", () => {
  it("seeds the requested Evologics users without plaintext passwords", () => {
    const users = initializeUsers([]);
    const expectedUsers = [
      ["Theresa Hong", "theresa@evologicsamerica.com", "administrator"],
      ["Dan Hong", "dan@effitt.com", "administrator"],
      ["Mike Crescenzo", "mike@evologicsamerica.com", "user"],
      ["Ryan Gray", "ryan@evologicsamerica.com", "user"],
      ["Jim Courville", "jim@evologicsamerica.com", "user"],
      ["Sam Williamson", "sam@evologicsamerica.com", "user"]
    ];

    expectedUsers.forEach(([name, email, role]) => {
      expect(users.find((user) => user.email === email)).toMatchObject({
        name,
        role,
        status: "Active"
      });
    });
    expect(users).toHaveLength(6);
    expect(users.every((user) => /^[a-f0-9]{64}$/.test(user.passwordHash))).toBe(true);
    expect(users.every((user) => !user.passwordHash.includes("evo"))).toBe(true);
  });

  it("migrates existing stored seed users to the corrected role set", () => {
    const users = initializeUsers([
      {
        ...seedUsers[0],
        role: "user",
        lastLoginAt: "2026-07-09T14:20:00.000Z"
      }
    ]);
    const theresa = users.find((user) => user.email === "theresa@evologicsamerica.com");

    expect(theresa?.role).toBe("administrator");
    expect(theresa?.lastLoginAt).toBe("2026-07-09T14:20:00.000Z");
  });

  it("authenticates active local users by password hash", async () => {
    const user = await createUserRecord({
      name: "Sample User",
      email: "sample@evologicsamerica.com",
      role: "user",
      password: "sample-password"
    });

    await expect(authenticateUser([user], user.email, "wrong-password")).resolves.toBeUndefined();
    await expect(authenticateUser([user], user.email, "sample-password")).resolves.toMatchObject({
      id: user.id
    });
  });

  it("finds the active session user", () => {
    const user = seedUsers[0];
    expect(activeSessionUser([user], { userId: user.id, signedInAt: new Date().toISOString() }))
      .toMatchObject({ email: user.email });
  });
});
