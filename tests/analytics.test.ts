import { describe, expect, it } from "vitest";
import {
  applyFilters,
  createEmptyImportLedger,
  emptyFilters,
  entityMomentum,
  partitionNewTransactions,
  productFamily,
  productFamilyOptions,
  rankMomentumRows,
  salesTransactionKey,
  skuOptionsForProductFamilies,
  timeSeries,
  withoutShippingStateFilter
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

  it("compares the latest four completed weeks with the prior four weeks", () => {
    const rows = [
      makeTransaction({ customerName: "Growing Hospital", transactionDate: "2026-06-15", revenue: 100 }),
      makeTransaction({ customerName: "Growing Hospital", transactionDate: "2026-07-20", revenue: 500 }),
      makeTransaction({ customerName: "Declining Hospital", transactionDate: "2026-06-22", revenue: 900 }),
      makeTransaction({ customerName: "Declining Hospital", transactionDate: "2026-07-27", revenue: 100 }),
      makeTransaction({ customerName: "Partial Week", transactionDate: "2026-08-05", revenue: 9999 })
    ];

    const analysis = entityMomentum(rows, "hospital");

    expect(analysis?.currentRange).toEqual({ start: "2026-07-06", end: "2026-08-02" });
    expect(analysis?.previousRange).toEqual({ start: "2026-06-08", end: "2026-07-05" });
    expect(analysis?.rows.find((row) => row.name === "Partial Week")).toBeUndefined();
    expect(rankMomentumRows(analysis?.rows ?? [], "change", "top", 1)[0].name).toBe("Growing Hospital");
    expect(rankMomentumRows(analysis?.rows ?? [], "change", "bottom", 1)[0].name).toBe("Declining Hospital");
  });

  it("separates distributor customers from hospitals using sales category", () => {
    const distributor = makeTransaction({
      customerName: "Regional Distributor",
      salesCategory: "Distributor",
      transactionDate: "2026-07-20"
    });
    const hospital = makeTransaction({
      customerName: "Regional Hospital",
      salesCategory: "Direct Retail",
      transactionDate: "2026-07-20"
    });
    const anchor = makeTransaction({ transactionDate: "2026-08-05", revenue: 0 });

    expect(entityMomentum([distributor, hospital, anchor], "distributor")?.rows.map((row) => row.name))
      .toEqual(["Regional Distributor"]);
    expect(entityMomentum([distributor, hospital, anchor], "hospital")?.rows.map((row) => row.name).sort())
      .toEqual(["Regional Hospital"]);
  });
});

describe("dashboard filters", () => {
  it("filters sales by sales category", () => {
    const retail = makeTransaction({ documentNumber: "EV-1", salesCategory: "Direct Retail" });
    const wholesale = makeTransaction({ documentNumber: "EV-2", salesCategory: "Wholesale" });

    expect(
      applyFilters([retail, wholesale], {
        ...emptyFilters,
        salesCategory: ["Wholesale"]
      })
    ).toEqual([wholesale]);
  });

  it("filters manager quick links against common sales-rep name variants", () => {
    const sam = makeTransaction({ salesRepVendor: "Samuel Williamson" });
    const other = makeTransaction({ documentNumber: "EV-2", salesRepVendor: "Other Rep" });

    expect(applyFilters([sam, other], { ...emptyFilters, managers: ["Sam Williamson"] }))
      .toEqual([sam]);
  });

  it("filters managers by their assigned reps and distributors", () => {
    const rachel = makeTransaction({ salesRepVendor: "Rachel Gray" });
    const star = makeTransaction({
      documentNumber: "EV-2",
      salesRepVendor: "Star Surgical Consultants LLC"
    });
    const pascucci = makeTransaction({
      documentNumber: "EV-3",
      salesRepVendor: "Pascucci Enterprises"
    });

    expect(applyFilters([rachel, star, pascucci], { ...emptyFilters, managers: ["Ryan Gray"] }))
      .toEqual([rachel, star]);
    expect(applyFilters([rachel, star, pascucci], { ...emptyFilters, managers: ["Jerry Pascucci"] }))
      .toEqual([pascucci]);
  });

  it("consolidates detailed item classes into business product families", () => {
    const evoPatch = makeTransaction();
    const dbm = makeTransaction({
      documentNumber: "EV-2",
      sku: "EV50205",
      productDescription: "DBM Strip 50x20x5mm",
      productClass: "Demineralized Bone Matrix : Strip"
    });
    const fascia = makeTransaction({
      documentNumber: "EV-3",
      sku: "FL-1",
      productDescription: "Fascia Lata",
      productClass: "Soft Tissue Allografts : Fascia Lata"
    });

    expect(productFamily(evoPatch)).toBe("EvoPatch");
    expect(productFamily(dbm)).toBe("DBM");
    expect(productFamily(fascia)).toBe("Fascia Lata & Pericardium");
    expect(productFamilyOptions([evoPatch, dbm, fascia])).toEqual([
      "DBM",
      "EvoPatch",
      "Fascia Lata & Pericardium"
    ]);
    expect(applyFilters([evoPatch, dbm, fascia], { ...emptyFilters, productClass: ["DBM"] }))
      .toEqual([dbm]);
    expect(skuOptionsForProductFamilies([evoPatch, dbm, fascia], ["DBM"]))
      .toEqual(["EV50205"]);
    expect(skuOptionsForProductFamilies([evoPatch, dbm, fascia], [])).toEqual([
      "EAP-48",
      "EV50205",
      "FL-1"
    ]);
  });

  it("can remove only the shipping-state filter for cross-state account reports", () => {
    const filters = {
      ...emptyFilters,
      shippingState: ["TX"],
      sku: ["EAP-48"]
    };

    expect(withoutShippingStateFilter(filters)).toMatchObject({
      shippingState: [],
      sku: ["EAP-48"]
    });
    expect(filters.shippingState).toEqual(["TX"]);
  });

  it("can report backdated transactions by their created date", () => {
    const backdated = makeTransaction({
      transactionDate: "2026-07-31",
      dateCreated: "2026-08-03T07:02:00.000Z",
      revenue: 65576.88
    });
    const sameDay = makeTransaction({
      documentNumber: "EV-2",
      transactionDate: "2026-08-03",
      dateCreated: "2026-08-03T13:00:00.000Z",
      revenue: 12234.24
    });
    const createdDateFilters = {
      ...emptyFilters,
      dateBasis: "created" as const,
      datePreset: "custom" as const,
      customStart: "2026-08-03",
      customEnd: "2026-08-03"
    };

    expect(applyFilters([backdated, sameDay], createdDateFilters)).toHaveLength(2);
    const createdDaily = timeSeries([backdated, sameDay], "day", "created");
    expect(createdDaily).toHaveLength(1);
    expect(createdDaily[0]).toMatchObject({ period: "2026-08-03", transactions: 2 });
    expect(createdDaily[0].revenue).toBeCloseTo(77811.12, 2);
    expect(
      applyFilters([backdated, sameDay], {
        ...createdDateFilters,
        dateBasis: "transaction"
      })
    ).toEqual([sameDay]);
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
    salesCategory: "Direct Retail",
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
