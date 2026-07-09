import { describe, expect, it } from "vitest";
import {
  createEmptyImportLedger,
  partitionNewTransactions,
  salesTransactionKey,
  timeSeries
} from "../src/lib/analytics";
import type { SalesTransaction } from "../src/types";

describe("import ledger duplicate prevention", () => {
  it("creates an empty durable import ledger", () => {
    expect(createEmptyImportLedger()).toEqual({
      version: 1,
      transactions: [],
      quality: [],
      importedFileFingerprints: [],
      importedTransactionKeys: []
    });
  });

  it("keeps duplicate-looking lines inside a new file", () => {
    const row = makeTransaction({ sourceRowNumber: 2 });
    const duplicateLookingRow = makeTransaction({ sourceRowNumber: 3 });
    const partition = partitionNewTransactions([row, duplicateLookingRow], new Set());

    expect(partition.accepted).toHaveLength(2);
    expect(partition.skippedDuplicateRows).toBe(0);
  });

  it("skips rows that already exist in the import ledger", () => {
    const existing = makeTransaction({ documentNumber: "EV-1" });
    const alreadyImported = makeTransaction({ documentNumber: "EV-1", sourceFile: "weekly.xls" });
    const newRow = makeTransaction({ documentNumber: "EV-2", sourceFile: "weekly.xls" });
    const partition = partitionNewTransactions(
      [alreadyImported, newRow],
      new Set([salesTransactionKey(existing)])
    );

    expect(partition.accepted).toEqual([newRow]);
    expect(partition.skippedDuplicateRows).toBe(1);
  });
});

describe("weekly reporting", () => {
  it("groups sales into Monday-starting weeks", () => {
    const sunday = makeTransaction({ transactionDate: "2026-07-05", revenue: 100 });
    const monday = makeTransaction({ transactionDate: "2026-07-06", revenue: 250 });
    const friday = makeTransaction({ transactionDate: "2026-07-10", revenue: 400 });

    expect(timeSeries([sunday, monday, friday], "week")).toMatchObject([
      { period: "2026-06-29", revenue: 100 },
      { period: "2026-07-06", revenue: 650 }
    ]);
  });
});

function makeTransaction(patch: Partial<SalesTransaction> = {}): SalesTransaction {
  return {
    sourceFile: "ytd.xls",
    sourceReportType: "YTD",
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    customerRaw: "CUST00001 Alpha Hospital",
    customerCode: "CUST00001",
    customerName: "Alpha Hospital",
    transactionType: "Invoice",
    transactionDate: "2026-06-29",
    accountingPeriod: "Jun 2026",
    documentNumber: "EV-1",
    poNumber: "PO-1",
    physicianId: "Dr. Sample",
    patient: "Patient A",
    sku: "EAP-48",
    productDescription: "EvoPatch Dual Layer Amnion 4x8cm",
    productClass: "Amniotic Tissue : EvoPatch",
    quantity: 1,
    unitPrice: 2250,
    revenue: 2250,
    salesRepVendor: "Sample Distributor LLC",
    salesEntityType: "Unknown",
    shippingState: "TX",
    isCreditMemo: false,
    ...patch
  };
}
