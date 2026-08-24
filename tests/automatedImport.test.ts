import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  isNightlySalesMessage,
  isSupportedSalesAttachment,
  prepareAutomatedSalesImport
} from "../src/lib/automatedImport";

describe("automated nightly sales imports", () => {
  it("matches the NetSuite relay sender and the exact nightly subject", () => {
    expect(
      isNightlySalesMessage({
        id: "message-1",
        subject: "Evologics Sales Transactions Created Yesterday",
        hasAttachments: true,
        from: {
          emailAddress: {
            address: "system@sent-via.netsuite.com",
            name: "004 (wendy@evologicsamerica.com)"
          }
        }
      })
    ).toBe(true);
    expect(
      isSupportedSalesAttachment({
        id: "attachment-xlsx",
        name: "searchresults.xlsx",
        isInline: false,
        "@odata.type": "#microsoft.graph.fileAttachment"
      })
    ).toBe(true);

    expect(
      isNightlySalesMessage({
        id: "message-2",
        subject: "Unrelated report",
        hasAttachments: true,
        from: { emailAddress: { address: "system@sent-via.netsuite.com" } }
      })
    ).toBe(false);
  });

  it("converts and normalizes modern XLSX NetSuite reports", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Friday Sales");
    sheet.addRows([
      ["Category", "Name", "Type", "Date", "Document Number", "PO/Check Number", "Item", "Amount"],
      ["Direct Retail", "Test Customer", "Invoice", "8/19/2026", "EV-74259", "PO-1", "EAP-48", 2446.88],
      ["Total", "", "", "", "", "", "", 2446.88]
    ]);
    const buffer = await workbook.xlsx.writeBuffer();
    const prepared = await prepareAutomatedSalesImport(
      "searchresults.xlsx",
      new Uint8Array(buffer),
      "2026-08-21T07:15:00.000Z",
      "xlsx-test"
    );

    expect(prepared.reviewReasons).toEqual([]);
    expect(prepared.transactions).toHaveLength(1);
    expect(prepared.transactions[0]).toMatchObject({
      transactionDate: "2026-08-19",
      documentNumber: "EV-74259",
      sku: "EAP-48",
      revenue: 2446.88
    });
    expect(prepared.parsed.sourceSheetName).toBe("Friday Sales");
    expect(prepared.parsed.excludedTotalRows).toBe(1);
  });

  it("accepts supported file attachments and rejects inline content", () => {
    expect(
      isSupportedSalesAttachment({
        id: "attachment-1",
        name: "searchresults.xls",
        isInline: false,
        "@odata.type": "#microsoft.graph.fileAttachment"
      })
    ).toBe(true);
    expect(
      isSupportedSalesAttachment({ id: "attachment-2", name: "logo.png", isInline: true })
    ).toBe(false);
  });

  it("normalizes a valid daily CSV and marks it as an automated clean import", async () => {
    const prepared = await prepareAutomatedSalesImport(
      "searchresults.csv",
      dailyCsv,
      "2026-08-05T07:15:00.000Z",
      "graph-message-1"
    );

    expect(prepared.reviewReasons).toEqual([]);
    expect(prepared.transactions).toHaveLength(1);
    expect(prepared.transactions[0]).toMatchObject({
      documentNumber: "EV-95001",
      salesRepVendor: "House Account",
      salesCategory: "Short Term Contract",
      revenue: 1675
    });
    expect(prepared.quality).toMatchObject({
      importSource: "Automated",
      acceptedTransactionCount: 1,
      totalRevenue: 1675
    });
    expect(prepared.fileFingerprint).toMatch(/^searchresults\.csv::[a-f0-9]{64}$/);
  });

  it("quarantines rows that cannot become canonical transactions", async () => {
    const prepared = await prepareAutomatedSalesImport(
      "broken.csv",
      "Name,Type,Date,Document Number,PO/Check Number,Item,Amount\nFacility,Invoice,2026-08-04,EV-1,PO-1,,100",
      "2026-08-05T07:15:00.000Z",
      "graph-message-2"
    );

    expect(prepared.transactions).toHaveLength(0);
    expect(prepared.reviewReasons.join(" ")).toContain("missing a date, document number, or SKU");
  });
});

const dailyCsv = [
  "Category,Name,Type,Date,Document Number,PO/Check Number,Item,Description,Quantity,Item Rate,Amount,Sales Rep - Vendor,Customer Rep Type,Date Created",
  "ShortTermCon,Acme Surgery Center,Invoice,2026-08-04,EV-95001,PO-1,EAP-46,EvoPatch Dual Layer Amnion 4x6cm,1,1675,1675,,House Account,2026-08-04T07:47:00"
].join("\n");
