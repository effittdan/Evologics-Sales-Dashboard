import { describe, expect, it } from "vitest";
import {
  activeSessionUser,
  approvedUserForEmail,
  authenticateUser,
  createUserRecord,
  initializeUsers,
  seedUsers
} from "../src/lib/auth";
import { netlifyIdentityErrorMessage, shouldUseNetlifyIdentity } from "../src/lib/netlifyAuth";

describe("local auth", () => {
  it("seeds the requested Evologics users without plaintext passwords", () => {
    const users = initializeUsers([]);
    const expectedUsers = [
      ["Theresa Hong", "theresa@evologicsamerica.com", "administrator"],
      ["Dan Hong", "dan@effitt.com", "administrator"],
      ["Wendy Reyes", "wendy@evologicsamerica.com", "administrator"],
      ["Eda Brown", "eda@evologicsamerica.com", "user"],
      ["Mike Crescenzo", "mike@evologicsamerica.com", "user"],
      ["Ryan Gray", "rgray@evologicsamerica.com", "user"],
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
    expect(users).toHaveLength(8);
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

  it("migrates Ryan's legacy approved email to the live Netlify Identity email", () => {
    const ryan = seedUsers.find((user) => user.id === "usr_ryan_gray");
    const users = initializeUsers([
      {
        ...ryan!,
        email: "ryan@evologicsamerica.com",
        lastLoginAt: "2026-08-05T14:20:00.000Z"
      }
    ]);

    expect(users.filter((user) => user.id === "usr_ryan_gray")).toHaveLength(1);
    expect(users.find((user) => user.id === "usr_ryan_gray")).toMatchObject({
      email: "rgray@evologicsamerica.com",
      lastLoginAt: "2026-08-05T14:20:00.000Z"
    });
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
    expect(activeSessionUser([user], { userId: user.id, signedInAt: new Date().toISOString(), provider: "local" }))
      .toMatchObject({ email: user.email });
  });

  it("looks up approved users by email for Netlify Identity sessions", () => {
    expect(approvedUserForEmail(seedUsers, "DAN@EFFITT.COM")).toMatchObject({
      name: "Dan Hong",
      role: "administrator"
    });
  });

  it("uses local fallback auth only on localhost", () => {
    expect(shouldUseNetlifyIdentity()).toBe(false);
  });

  it("explains that unconfirmed new users must accept their invitation before password reset", () => {
    expect(netlifyIdentityErrorMessage(new Error("invalid_grant: Email not confirmed"))).toBe(
      "This new account has not accepted its Netlify invitation yet. Ask an administrator to resend the invitation, then use the Accept invitation link to create a password before using password reset."
    );
  });
});
