import { describe, expect, it } from "vitest";
import { buildSalesMapPayload, normalizeStateCode } from "../src/lib/mapData";
import type { SalesTransaction } from "../src/types";

describe("sales map data", () => {
  it("normalizes state names and common punctuation", () => {
    expect(normalizeStateCode("LA.")).toBe("LA");
    expect(normalizeStateCode("Texas")).toBe("TX");
    expect(normalizeStateCode("Puerto Rico")).toBe("PR");
    expect(normalizeStateCode("Unknown")).toBeUndefined();
  });

  it("builds state summaries from normalized transactions", () => {
    const rows = [
      transaction({ documentNumber: "INV-1", quantity: 3, revenue: 300 }),
      transaction({ documentNumber: "INV-1", sku: "EAP-48", quantity: 2, revenue: 200 }),
      transaction({
        documentNumber: "CM-1",
        transactionType: "Credit Memo",
        quantity: 1,
        revenue: -100,
        isCreditMemo: true
      }),
      transaction({ documentNumber: "INV-2", shippingState: "", revenue: 50 })
    ];

    const payload = buildSalesMapPayload(rows, {
      dateBasis: "transaction",
      sourceUpdatedAt: "2026-08-05T12:00:00.000Z",
      generatedAt: "2026-08-05T12:01:00.000Z"
    });

    expect(payload).toMatchObject({
      mappedStateCount: 1,
      mappedLineCount: 3,
      missingStateCount: 1,
      documentCount: 2,
      customerCount: 1,
      quantity: 4,
      revenue: 400,
      dateRange: { start: "2026-08-03", end: "2026-08-03" }
    });
    expect(payload.states[0]).toMatchObject({
      code: "TX",
      name: "Texas",
      quantity: 4,
      revenue: 400,
      lineCount: 3,
      documentCount: 2,
      customerCount: 1
    });
    expect(payload.states[0].products.map((product) => product.sku)).toEqual(["EAP-46", "EAP-48"]);
  });
});

function transaction(overrides: Partial<SalesTransaction> = {}): SalesTransaction {
  return {
    sourceFile: "daily.csv",
    sourceReportType: "Weekly",
    sourceRowNumber: 1,
    customerRaw: "100 Acme Medical Center",
    customerName: "Acme Medical Center",
    transactionType: "Invoice",
    transactionDate: "2026-08-03",
    documentNumber: "INV-1",
    sku: "EAP-46",
    productDescription: "EvoPatch",
    quantity: 1,
    unitPrice: 100,
    revenue: 100,
    shippingState: "TX",
    isCreditMemo: false,
    ...overrides
  };
}
