import { describe, expect, it } from "vitest";
import {
  activeSessionUser,
  authenticateUser,
  createUserRecord,
  initializeUsers,
  seedUsers
} from "../src/lib/auth";

describe("local auth", () => {
  it("seeds Theresa Hong as an active admin without a plaintext password", () => {
    const users = initializeUsers([]);
    const theresa = users.find((user) => user.email === "theresa@evologicsamerica.com");

    expect(theresa).toMatchObject({
      name: "Theresa Hong",
      role: "Admin",
      status: "Active"
    });
    expect(theresa?.passwordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(theresa?.passwordHash).not.toContain("evo");
  });

  it("authenticates active local users by password hash", async () => {
    const user = await createUserRecord({
      name: "Sample User",
      email: "sample@evologicsamerica.com",
      role: "Sales Rep",
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
