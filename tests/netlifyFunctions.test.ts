import { describe, expect, it } from "vitest";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identitySignupHandler } from "../netlify/functions/identity-signup.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as identityValidateHandler } from "../netlify/functions/identity-validate.js";
// @ts-expect-error Netlify functions are plain JavaScript deployment modules.
import { handler as salesLedgerHandler } from "../netlify/functions/sales-ledger.js";
import {
  config as nightlySalesEmailConfig,
  listRecentMessages,
  resolveSupportedSalesAttachments
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
      if (url.includes("/mailFolders/deleteditems/")) {
        return Response.json({ value: [{ id: "deleted-message" }] });
      }
      return Response.json(
        url.includes("/mailFolders/inbox/")
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

    expect(messages.map((message) => message.id)).toEqual([
      "newest-message",
      "older-message",
      "deleted-message"
    ]);
    expect(requestedUrls).toHaveLength(3);
    const firstRequest = new URL(requestedUrls[0]);
    const deletedItemsRequest = new URL(requestedUrls[2]);
    expect(firstRequest.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(firstRequest.searchParams.get("$top")).toBe("100");
    expect(firstRequest.searchParams.get("$filter")).toBe(
      "receivedDateTime ge 2026-08-05T12:00:00.000Z"
    );
    expect(deletedItemsRequest.pathname).toContain("/mailFolders/deleteditems/messages");
  });

  it("extracts supported reports from attached Outlook messages", async () => {
    const requestedUrls: string[] = [];
    const report = "Transaction Date,Document Number,SKU,Revenue\n8/19/2026,EV-1,EAP-48,2250";
    const fetchImplementation = async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({
        id: "forwarded-email",
        "@odata.type": "#microsoft.graph.itemAttachment",
        item: {
          attachments: [
            {
              id: "nested-report",
              name: "Wednesday.csv",
              size: report.length,
              isInline: false,
              contentBytes: btoa(report),
              "@odata.type": "#microsoft.graph.fileAttachment"
            },
            {
              id: "nested-logo",
              name: "logo.png",
              isInline: true,
              "@odata.type": "#microsoft.graph.fileAttachment"
            }
          ]
        }
      });
    };

    const attachments = await resolveSupportedSalesAttachments(
      "theresa@evologicsamerica.com",
      "deleted-message",
      [
        {
          id: "forwarded-email",
          name: "FW: sales report",
          isInline: false,
          "@odata.type": "#microsoft.graph.itemAttachment"
        }
      ],
      "test-token",
      fetchImplementation as typeof fetch
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0].attachment.name).toBe("Wednesday.csv");
    expect(attachments[0].contentBytes).toBe(btoa(report));
    expect(requestedUrls[0]).toContain("$expand=microsoft.graph.itemattachment/item");
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
