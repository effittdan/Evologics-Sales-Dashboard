import { describe, expect, it } from "vitest";
import {
  applyFilters,
  createEmptyImportLedger,
  emptyFilters,
  entityMomentum,
  entityPeriodComparison,
  formatCurrency,
  partitionNewTransactions,
  periodComparison,
  productClassSkuUnits,
  productFamily,
  productFamilyOptions,
  rankEntityPeriodRows,
  rankEntityPeriodRowsByVolume,
  rankMomentumRows,
  rankMomentumRowsByVolume,
  resolveDateRange,
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

describe("currency formatting", () => {
  it("displays monetary values as whole dollars", () => {
    expect(formatCurrency(12234.24)).toBe("$12,234");
    expect(formatCurrency(3995.99)).toBe("$3,996");
    expect(formatCurrency(0)).toBe("$0");
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
    expect(rankMomentumRowsByVolume(analysis?.rows ?? [], 2).map((row) => row.name)).toEqual([
      "Declining Hospital",
      "Growing Hospital"
    ]);
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

describe("product class SKU unit analysis", () => {
  const rows = [
    makeTransaction({ transactionDate: "2025-03-05", quantity: 4 }),
    makeTransaction({ documentNumber: "EV-2", transactionDate: "2026-02-10", quantity: 3 }),
    makeTransaction({ documentNumber: "EV-3", transactionDate: "2026-03-05", quantity: 8 }),
    makeTransaction({
      documentNumber: "EV-4",
      transactionDate: "2026-02-18",
      sku: "EAP-24",
      productDescription: "EvoPatch Dual Layer Amnion 2x4cm",
      quantity: 5
    }),
    makeTransaction({
      documentNumber: "EV-5",
      transactionDate: "2026-03-07",
      sku: "DBM-1",
      productDescription: "DBM Putty",
      productClass: "Demineralized Bone Matrix",
      quantity: 99
    })
  ];

  it("compares a selected month with the previous month and keeps every class SKU", () => {
    const analysis = productClassSkuUnits(rows, "EvoPatch", "mom", "transaction", "2026-03");

    expect(analysis).toMatchObject({ currentLabel: "Mar 2026", comparisonLabel: "Feb 2026" });
    expect(analysis.rows).toEqual([
      expect.objectContaining({ sku: "EAP-48", currentUnits: 8, comparisonUnits: 3, changeUnits: 5 }),
      expect.objectContaining({ sku: "EAP-24", currentUnits: 0, comparisonUnits: 5, changeUnits: -5 })
    ]);
  });

  it("compares current YTD units with the same date in the prior year", () => {
    const analysis = productClassSkuUnits(rows, "EvoPatch", "yoy");
    const evoPatch = analysis.rows.find((row) => row.sku === "EAP-48");

    expect(analysis).toMatchObject({ currentLabel: "2026 YTD", comparisonLabel: "2025 YTD" });
    expect(evoPatch).toMatchObject({ currentUnits: 11, comparisonUnits: 4, changeUnits: 7 });
    expect(evoPatch?.changePct).toBeCloseTo(1.75);
  });
});

describe("period comparisons", () => {
  const comparisonRows = [
    makeTransaction({ transactionDate: "2025-01-10", revenue: 100, quantity: 2 }),
    makeTransaction({ documentNumber: "EV-2", transactionDate: "2025-02-10", revenue: 200, quantity: 4 }),
    makeTransaction({ documentNumber: "EV-3", transactionDate: "2026-01-10", revenue: 150, quantity: 3 }),
    makeTransaction({ documentNumber: "EV-4", transactionDate: "2026-02-10", revenue: 300, quantity: 6 }),
    makeTransaction({ documentNumber: "EV-5", transactionDate: "2026-03-05", revenue: 50, quantity: 1 })
  ];

  it("compares year to date with the same prior-year cutoff", () => {
    const analysis = periodComparison(comparisonRows, "yoy", "transaction", "2026-02-10");

    expect(analysis).toMatchObject({
      currentLabel: "2026 YTD",
      previousLabel: "2025 YTD",
      currentRange: { start: "2026-01-01", end: "2026-02-10" },
      previousRange: { start: "2025-01-01", end: "2025-02-10" },
      currentRevenue: 450,
      previousRevenue: 300,
      currentQuantity: 9,
      previousQuantity: 6
    });
    expect(analysis?.revenueChangePct).toBeCloseTo(0.5);
    expect(analysis?.series).toHaveLength(2);
    expect(analysis?.series.at(-1)).toMatchObject({ currentRevenue: 450, previousRevenue: 300 });
  });

  it("uses equal elapsed days for month and quarter comparisons", () => {
    const month = periodComparison(comparisonRows, "mom", "transaction", "2026-02-10");
    const quarter = periodComparison(comparisonRows, "qoq", "transaction", "2026-02-10");

    expect(month?.currentRange).toEqual({ start: "2026-02-01", end: "2026-02-10" });
    expect(month?.previousRange).toEqual({ start: "2026-01-01", end: "2026-01-10" });
    expect(month?.currentRevenue).toBe(300);
    expect(month?.previousRevenue).toBe(150);
    expect(quarter?.currentRange).toEqual({ start: "2026-01-01", end: "2026-02-10" });
    expect(quarter?.previousRange).toEqual({ start: "2025-10-01", end: "2025-11-10" });
  });

  it("compares month and quarter with the same prior-year periods when selected", () => {
    const month = periodComparison(comparisonRows, "mom", "transaction", "2026-02-10", "previous-year");
    const quarter = periodComparison(comparisonRows, "qoq", "transaction", "2026-02-10", "previous-year");

    expect(month).toMatchObject({
      basis: "previous-year",
      previousLabel: "Feb 2025 comparable",
      previousRange: { start: "2025-02-01", end: "2025-02-10" },
      previousRevenue: 200
    });
    expect(quarter).toMatchObject({
      basis: "previous-year",
      previousLabel: "Q1 2025 comparable",
      previousRange: { start: "2025-01-01", end: "2025-02-10" },
      previousRevenue: 300
    });
  });

  it("ranks distributor performance across matched periods by revenue or units", () => {
    const rows = [
      makeTransaction({
        customerName: "Growing Distributor",
        salesCategory: "Distributor",
        transactionDate: "2025-02-05",
        revenue: 100,
        quantity: 2
      }),
      makeTransaction({
        documentNumber: "EV-D2",
        customerName: "Growing Distributor",
        salesCategory: "Distributor",
        transactionDate: "2026-02-05",
        revenue: 400,
        quantity: 8
      }),
      makeTransaction({
        documentNumber: "EV-D3",
        customerName: "Declining Distributor",
        salesCategory: "Distributor",
        transactionDate: "2025-02-08",
        revenue: 500,
        quantity: 10
      }),
      makeTransaction({
        documentNumber: "EV-D4",
        customerName: "Declining Distributor",
        salesCategory: "Distributor",
        transactionDate: "2026-02-08",
        revenue: 50,
        quantity: 1
      }),
      makeTransaction({
        documentNumber: "EV-ANCHOR",
        customerName: "Date Anchor",
        salesCategory: "Wholesale",
        transactionDate: "2026-02-10",
        revenue: 0,
        quantity: 0
      })
    ];
    const analysis = entityPeriodComparison(
      rows,
      "distributor",
      "mom",
      "transaction",
      "2026-02-10",
      "previous-year"
    );

    expect(analysis).toMatchObject({
      currentLabel: "Feb 2026 MTD",
      previousLabel: "Feb 2025 comparable",
      currentRange: { start: "2026-02-01", end: "2026-02-10" },
      previousRange: { start: "2025-02-01", end: "2025-02-10" }
    });
    expect(rankEntityPeriodRows(analysis?.rows ?? [], "revenue", "change", "top", 1)[0])
      .toMatchObject({ name: "Growing Distributor", changeRevenue: 300 });
    expect(rankEntityPeriodRows(analysis?.rows ?? [], "quantity", "change", "bottom", 1)[0])
      .toMatchObject({ name: "Declining Distributor", changeQuantity: -9 });
    expect(rankEntityPeriodRowsByVolume(analysis?.rows ?? [], "revenue", 1)[0].name)
      .toBe("Declining Distributor");
    expect(analysis?.rows[0].trend.at(-1)).toMatchObject({
      currentRevenue: 400,
      previousRevenue: 100
    });
  });
});

describe("dashboard filters", () => {
  it("selects the complete prior calendar year", () => {
    const rows = [
      makeTransaction({ transactionDate: "2025-01-03" }),
      makeTransaction({ documentNumber: "EV-2", transactionDate: "2026-08-12" })
    ];

    expect(resolveDateRange(rows, { ...emptyFilters, datePreset: "previousYear" })).toEqual({
      start: "2025-01-01",
      end: "2025-12-31"
    });
    expect(applyFilters(rows, { ...emptyFilters, datePreset: "previousYear" })).toEqual([rows[0]]);
  });

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
    const jerryDistributors = [
      "Pascucci Enterprises",
      "LAAB Medical",
      "Gulf Coast Med Co",
      "Kennedy Medical Inc",
      "Ortho Haus Inc",
      "Paul Sutherland",
      "Andrew Leachman",
      "Redmed"
    ];
    const jerryRows = jerryDistributors.map((salesRepVendor, index) =>
      makeTransaction({ documentNumber: `EV-JERRY-${index + 1}`, salesRepVendor })
    );
    const unrelated = makeTransaction({
      documentNumber: "EV-OTHER",
      salesRepVendor: "Unrelated Distributor"
    });

    expect(applyFilters([rachel, star, ...jerryRows], { ...emptyFilters, managers: ["Ryan Gray"] }))
      .toEqual([rachel, star]);
    expect(
      applyFilters([rachel, star, ...jerryRows, unrelated], {
        ...emptyFilters,
        managers: ["Jerry Pascucci"]
      })
    ).toEqual(jerryRows);
  });

  it("groups Garrett Hebert's distributor territory under one manager filter", () => {
    const assignedDistributors = [
      "M2 Intuitive Solutions LLC",
      "AEL Marketing Enterprises LLC",
      "Caliber Medical Products, LLC",
      "HealthTech Distributors LLC",
      "Hunter Surgical LLC",
      "JBD3 Holdings, LLC",
      "Jor-Mar Medical, Inc.",
      "Patriot Medical Distributions, LLC",
      "Semple Health Consultants, LLC",
      "Slopeside Medical Supplies Inc.",
      "SurgiSolutions, LLC",
      "Team Cross Medical, LLC",
      "Adella Inc"
    ];
    const assignedRows = assignedDistributors.map((salesRepVendor, index) =>
      makeTransaction({ documentNumber: `EV-${index + 1}`, salesRepVendor })
    );
    const unrelated = makeTransaction({
      documentNumber: "EV-OTHER",
      salesRepVendor: "Unrelated Distributor"
    });

    expect(
      applyFilters([...assignedRows, unrelated], {
        ...emptyFilters,
        managers: ["Garrett Hebert"]
      })
    ).toEqual(assignedRows);
  });

  it("consolidates detailed item classes into business product families", () => {
    const evoPatch = makeTransaction();
    const aMatrx = makeTransaction({
      documentNumber: "EV-AM",
      sku: "AM-001",
      productDescription: "A-MATRX",
      productClass: "Acellular Dermal Matrix"
    });
    const netSuiteAMatrx = makeTransaction({
      documentNumber: "EV-AM-NETSUITE",
      sku: "EAF-40",
      productDescription: "A-MATRX micrograft, 40MG",
      productClass: "Amniotic Tissue : EvoPatch"
    });
    const aMatrxSkuRows = ["EAF-40", "EAF-80", "EAF-160", "EAF-250"].map((sku, index) =>
      makeTransaction({
        documentNumber: `EV-EAF-${index + 1}`,
        sku,
        productDescription: "Processed allograft",
        productClass: "Other"
      })
    );
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
    expect(productFamily(aMatrx)).toBe("A-MATRX");
    expect(productFamily(netSuiteAMatrx)).toBe("A-MATRX");
    expect(aMatrxSkuRows.map(productFamily)).toEqual([
      "A-MATRX",
      "A-MATRX",
      "A-MATRX",
      "A-MATRX"
    ]);
    expect(productFamily(dbm)).toBe("DBM");
    expect(productFamily(fascia)).toBe("Fascia Lata & Pericardium");
    expect(productFamilyOptions([evoPatch, dbm, fascia])).toEqual([
      "A-MATRX",
      "DBM",
      "EvoPatch",
      "Fascia Lata & Pericardium"
    ]);
    expect(productFamilyOptions([])).toEqual(["A-MATRX"]);
    expect(skuOptionsForProductFamilies([], ["A-MATRX"]))
      .toEqual(["EAF-40", "EAF-80", "EAF-160", "EAF-250"]);
    expect(applyFilters(aMatrxSkuRows, { ...emptyFilters, productClass: ["A-MATRX"] }))
      .toEqual(aMatrxSkuRows);
    expect(skuOptionsForProductFamilies(aMatrxSkuRows, ["A-MATRX"]))
      .toEqual(["EAF-40", "EAF-80", "EAF-160", "EAF-250"]);
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
