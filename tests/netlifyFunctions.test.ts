import { describe, expect, it } from "vitest";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identitySignupHandler } from "../netlify/functions/identity-signup.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identityValidateHandler } from "../netlify/functions/identity-validate.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as salesLedgerHandler } from "../netlify/functions/sales-ledger.js";
import { config as nightlySalesEmailConfig } from "../netlify/functions/nightly-sales-email.mts";
import { config as salesImportHistoryConfig } from "../netlify/functions/sales-import-history.mts";

type NetlifyResponse = {
  statusCode: number;
  body: string;
};

describe("Netlify functions", () => {
  it("schedules the nightly mailbox poll around both Central time UTC offsets", () => {
    expect(nightlySalesEmailConfig.schedule).toBe("15 7-10 * * *");
  });

  it("exposes automated import history through the authenticated API route", () => {
    expect(salesImportHistoryConfig.path).toBe("/api/sales-import-history");
  });

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
