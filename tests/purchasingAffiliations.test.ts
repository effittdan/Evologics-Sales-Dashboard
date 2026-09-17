import { describe, expect, it, vi } from "vitest";
import type { PurchasingMapping } from "../src/lib/purchasingAffiliations";
const mapping: PurchasingMapping = {
  checked: "2026-09-17", coverage: "Synthetic test accounts", sources: {},
  rows: [
    { customerName: "Example System", states: ["NY"], nationalGpo: ["Vizient", "Premier"], regionalPurchasingGroup: ["Example regional group"], verificationStatus: "Multiple / facility needed", system: "", notes: "", sourceIds: [], checked: "2026-09-17" },
    { customerName: "Example Hospital", states: ["AL"], nationalGpo: ["Vizient"], regionalPurchasingGroup: [], verificationStatus: "Direct public evidence", system: "", notes: "", sourceIds: [], checked: "2026-09-17" },
    { customerName: "Example Oncology Center", states: ["NY"], nationalGpo: [], regionalPurchasingGroup: [], verificationStatus: "Category only", system: "", notes: "", sourceIds: [], checked: "2026-09-17" },
    { customerName: "Example Distributor", states: ["FL"], nationalGpo: [], regionalPurchasingGroup: [], verificationStatus: "Outside hospital review", system: "", notes: "", sourceIds: [], checked: "2026-09-17" }
  ]
};
const blobGet = vi.hoisted(() => vi.fn());
vi.mock("@netlify/blobs", () => ({ getStore: () => ({ get: blobGet }) }));
import { affiliationValues, enrichPurchasingAffiliations } from "../src/lib/purchasingAffiliations";
import { applyFilters, emptyFilters, salesTransactionKey } from "../src/lib/analytics";
import type { SalesTransaction } from "../src/types";
vi.mock("@netlify/identity", () => ({ getUser: vi.fn() }));
import { getUser } from "@netlify/identity";
import handler from "../netlify/functions/purchasing-affiliations.mts";

function sale(customerName: string, shippingState?: string): SalesTransaction {
  return { customerName, shippingState, customerRaw: customerName, sourceFile: "test.csv", sourceReportType: "YTD", sourceRowNumber: 1, transactionType: "Invoice", transactionDate: "2026-08-01", documentNumber: "INV-1", sku: "SKU", productDescription: "Product", quantity: 1, unitPrice: 100, revenue: 100, isCreditMemo: false };
}

describe("purchasing affiliation filters", () => {
  it("matches normalized exact names, rejects wrong states and does not guess fuzzy identities", () => {
    const rows = enrichPurchasingAffiliations([
      sale(" CUST001   EXAMPLE   SYSTEM ", "ny"), sale("Example System", "TX"), sale("Example System"), sale("Example", "NY")
    ], mapping);
    expect(rows[0].purchasingAffiliation?.nationalGpo).toEqual(["Vizient", "Premier"]);
    expect(rows.slice(1).every((row) => !row.purchasingAffiliation)).toBe(true);
  });
  it("supports OR within a filter and AND across filters without double counting", () => {
    const input = [sale("Example System", "NY"), sale("Example Hospital", "AL"), sale("New hospital", "TX")];
    const rows = enrichPurchasingAffiliations(input, mapping);
    expect(applyFilters(rows, emptyFilters).reduce((total, row) => total + row.revenue, 0)).toBe(300);
    const selected = applyFilters(rows, { ...emptyFilters, nationalGpo: ["Vizient", "Premier"], regionalPurchasingGroup: ["Example regional group"], verificationStatus: ["Multiple / facility needed"] });
    expect(selected).toHaveLength(1);
    expect(selected[0].revenue).toBe(100);
    expect(salesTransactionKey(selected[0])).toBe(salesTransactionKey(input[0]));
    expect(applyFilters(rows, { ...emptyFilters, nationalGpo: ["Premier"], verificationStatus: ["Direct public evidence"] })).toEqual([]);
    expect(applyFilters(rows, { ...emptyFilters, nationalGpo: ["Vizient"], shippingState: ["AL"] })).toHaveLength(1);
  });
  it("keeps unknowns and scope-limited evidence honest", () => {
    const rows = enrichPurchasingAffiliations([sale("New hospital", "TX"), sale("Example Oncology Center", "NY"), sale("Example Distributor", "FL")], mapping);
    expect(affiliationValues(rows[0], "verificationStatus")).toEqual(["Not researched"]);
    expect(affiliationValues(rows[1], "nationalGpo")).toEqual(["Unknown"]);
    expect(affiliationValues(rows[1], "verificationStatus")).toEqual(["Category only"]);
    expect(affiliationValues(rows[2], "verificationStatus")).toEqual(["Outside hospital review"]);
    expect(applyFilters(rows, { ...emptyFilters, nationalGpo: ["Unknown"] })).toHaveLength(3);
  });
  it("backfills an existing imported sale without changing its identity or amount", () => {
    const original = sale("New hospital", "TX");
    const updated = { ...mapping, rows: [...mapping.rows, { ...mapping.rows[0], customerName: "New hospital", states: ["TX"], nationalGpo: ["Premier"], verificationStatus: "Direct public evidence" }] };
    const [row] = enrichPurchasingAffiliations([original], updated);
    expect(applyFilters([row], { ...emptyFilters, nationalGpo: ["Premier"] })).toHaveLength(1);
    expect(salesTransactionKey(row)).toBe(salesTransactionKey(original));
    expect(row.revenue).toBe(original.revenue);
    expect(original.purchasingAffiliation).toBeUndefined();
  });
  it("rejects duplicate ambiguous mapping entries", () => {
    const duplicate = { ...mapping, rows: [mapping.rows[0], mapping.rows[0]] };
    expect(enrichPurchasingAffiliations([sale(mapping.rows[0].customerName, mapping.rows[0].states[0])], duplicate)[0].purchasingAffiliation).toBeUndefined();
  });
  it("keeps all research records and source references consistent", () => {
    expect(mapping.rows).toHaveLength(4);
    expect(new Set(mapping.rows.map((row) => row.customerName.toLowerCase())).size).toBe(mapping.rows.length);
    for (const row of mapping.rows) {
      for (const id of row.sourceIds) expect(mapping.sources).toHaveProperty(id);
      const enriched = enrichPurchasingAffiliations([sale(row.customerName, row.states[0])], mapping)[0];
      expect(enriched.purchasingAffiliation).toEqual(row);
    }
  });
});

describe("purchasing research endpoint", () => {
  it("returns an explicit unavailable response when private storage is missing or fails", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "dan@effitt.com" } as Awaited<ReturnType<typeof getUser>>);
    blobGet.mockResolvedValue(null);
    expect((await handler(new Request("https://example.com/api/purchasing-affiliations"))).status).toBe(503);
    blobGet.mockRejectedValue(new Error("storage unavailable"));
    expect((await handler(new Request("https://example.com/api/purchasing-affiliations"))).status).toBe(503);
  });
  it("requires an approved authenticated account and prevents writes", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    expect((await handler(new Request("https://example.com/api/purchasing-affiliations"))).status).toBe(401);
    vi.mocked(getUser).mockResolvedValue({ email: "unapproved@example.com" } as Awaited<ReturnType<typeof getUser>>);
    expect((await handler(new Request("https://example.com/api/purchasing-affiliations"))).status).toBe(401);
    vi.mocked(getUser).mockResolvedValue({ email: "dan@effitt.com" } as Awaited<ReturnType<typeof getUser>>);
    blobGet.mockResolvedValue(mapping);
    const response = await handler(new Request("https://example.com/api/purchasing-affiliations"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).rows).toHaveLength(4);
    expect((await handler(new Request("https://example.com/api/purchasing-affiliations", { method: "PUT" }))).status).toBe(405);
  });
});
