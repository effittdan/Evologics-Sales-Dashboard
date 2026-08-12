import { describe, expect, it } from "vitest";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identitySignupHandler } from "../netlify/functions/identity-signup.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identityValidateHandler } from "../netlify/functions/identity-validate.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as salesLedgerHandler } from "../netlify/functions/sales-ledger.js";
import {
  config as nightlySalesEmailConfig,
  listRecentMessages
} from "../netlify/functions/nightly-sales-email.mts";
import { config as salesImportHistoryConfig } from "../netlify/functions/sales-import-history.mts";
import {
  compressJsonToBase64,
  decompressJsonFromBase64
} from "../src/lib/sharedLedger";

type NetlifyResponse = {
  statusCode: number;
  body: string;
};

describe("Netlify functions", () => {
  it("schedules the nightly mailbox poll around both Central time UTC offsets", () => {
    expect(nightlySalesEmailConfig.schedule).toBe("15 7-10 * * *");
  });

  it("requests newest messages first and follows Microsoft Graph pagination", async () => {
    const requestedUrls: string[] = [];
    const fetchImplementation = async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      return Response.json(
        requestedUrls.length === 1
          ? {
              value: [{ id: "newest-message" }],
              "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page"
            }
          : { value: [{ id: "older-message" }] }
      );
    };

    const messages = await listRecentMessages(
      "theresa@evologicsamerica.com",
      "test-token",
      new Date("2026-08-12T12:00:00.000Z"),
      fetchImplementation as typeof fetch
    );

    expect(messages.map((message) => message.id)).toEqual(["newest-message", "older-message"]);
    expect(requestedUrls).toHaveLength(2);
    const firstRequest = new URL(requestedUrls[0]);
    expect(firstRequest.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(firstRequest.searchParams.get("$top")).toBe("100");
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

  it("round-trips a large shared ledger through the compressed transport", async () => {
    const ledger = {
      version: 1,
      transactions: Array.from({ length: 500 }, (_, index) => ({
        transactionDate: "2025-12-31",
        documentNumber: `EV-${index}`,
        sku: "EAP-48",
        revenue: 2250
      })),
      quality: [],
      importedFileFingerprints: [],
      importedTransactionKeys: []
    };

    const compressed = await compressJsonToBase64(ledger);
    const restored = await decompressJsonFromBase64(compressed);

    expect(restored).toEqual(ledger);
    expect(compressed.length).toBeLessThan(JSON.stringify(ledger).length);
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

  it("accepts Ryan's live Identity email in both signup hooks", async () => {
    const event = {
      body: JSON.stringify({ user: { email: "rgray@evologicsamerica.com" } })
    };
    const signupResponse = (await identitySignupHandler(event)) as NetlifyResponse;
    const validationResponse = (await identityValidateHandler(event)) as NetlifyResponse;

    expect(validationResponse.statusCode).toBe(200);
    expect(JSON.parse(signupResponse.body)).toMatchObject({
      user_metadata: { full_name: "Ryan Gray" },
      app_metadata: { roles: ["user"] }
    });
    expect(signupResponse.statusCode).toBe(200);
  });
});
