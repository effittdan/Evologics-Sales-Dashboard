import { describe, expect, it } from "vitest";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identitySignupHandler } from "../netlify/functions/identity-signup.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identityValidateHandler } from "../netlify/functions/identity-validate.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as salesLedgerHandler } from "../netlify/functions/sales-ledger.js";

type NetlifyResponse = {
  statusCode: number;
  body: string;
};

describe("Netlify functions", () => {
  it("loads the shared ledger function as an ES module", async () => {
    expect(salesLedgerHandler).toBeTypeOf("function");
    const response = (await salesLedgerHandler({ httpMethod: "GET" }, {})) as NetlifyResponse;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      message: "Sign in with an approved Evologics dashboard account."
    });
  });

  it("loads the Identity signup hook as an ES module", async () => {
    expect(identitySignupHandler).toBeTypeOf("function");
    const response = (await identitySignupHandler({
      body: JSON.stringify({ user: { email: "theresa@evologicsamerica.com" } })
    })) as NetlifyResponse;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      app_metadata: { roles: ["administrator"] }
    });
  });

  it("loads the Identity validation hook as an ES module", async () => {
    expect(identityValidateHandler).toBeTypeOf("function");
    const response = (await identityValidateHandler({
      body: JSON.stringify({ user: { email: "mike@evologicsamerica.com" } })
    })) as NetlifyResponse;

    expect(response.statusCode).toBe(200);
  });
});
