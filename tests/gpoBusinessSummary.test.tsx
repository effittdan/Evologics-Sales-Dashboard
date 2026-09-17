import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GpoBusinessSummary } from "../src/components/GpoBusinessSummary";
import { applyFilters, emptyFilters } from "../src/lib/analytics";
import type { SalesTransaction } from "../src/types";

function sale(name: string, revenue: number, groups = ["Vizient", "Premier"]): SalesTransaction {
  return { customerName: name, customerRaw: name, sourceFile: "synthetic.csv", sourceReportType: "YTD", sourceRowNumber: 1, transactionType: revenue < 0 ? "Credit Memo" : "Invoice", transactionDate: "2026-08-01", documentNumber: name, sku: "TEST", productDescription: "Test", quantity: revenue < 0 ? -1 : 1, unitPrice: Math.abs(revenue), revenue, isCreditMemo: revenue < 0, purchasingAffiliation: { customerName: name, states: [], nationalGpo: groups, regionalPurchasingGroup: ["Example regional group"], verificationStatus: "System inference", system: "", notes: "", sourceIds: [], checked: "2026-09-17" } };
}
const filters = { ...emptyFilters, nationalGpo: ["Vizient", "Premier"] };

describe("combined GPO business summary", () => {
  it("totals all matched accounts, credits, and overlapping memberships exactly once", () => {
    const rows = applyFilters([sale("Alpha", 100), sale("Beta", 200), sale("Alpha", -25), sale("Excluded", 999, ["HealthTrust"])], filters);
    const html = renderToStaticMarkup(<GpoBusinessSummary rows={rows} filters={filters} ready />);
    expect(html).toContain("Combined net sales</span><strong>$275");
    expect(html).toContain("Net units</span><strong>1");
    expect(html).toContain("Accounts with business</span><strong>2");
    expect(html).toContain("Sales lines</span><strong>3");
    expect(html).toContain("Alpha</td><td>$75");
    expect(html).not.toContain("Excluded");
  });
  it("includes every account beyond the normal top-20 customer chart", () => {
    const rows = Array.from({ length: 25 }, (_, index) => sale(`Account ${index}`, 10));
    const html = renderToStaticMarkup(<GpoBusinessSummary rows={rows} filters={filters} ready />);
    expect(html).toContain("View all 25 account contributions");
    expect(html).toContain("Combined net sales</span><strong>$250");
    expect(html.match(/<tr>/g)).toHaveLength(27);
  });
  it("works for regional selection and respects dates, national intersection, and verification", () => {
    const selected = { ...emptyFilters, regionalPurchasingGroup: ["Example regional group"], nationalGpo: ["Premier"], verificationStatus: ["System inference"], datePreset: "custom" as const, customStart: "2026-08-01", customEnd: "2026-08-31" };
    const rows = applyFilters([sale("Alpha", 100), { ...sale("Old", 500), transactionDate: "2025-08-01" }, sale("Other", 900, ["HealthTrust"])], selected);
    const html = renderToStaticMarkup(<GpoBusinessSummary rows={rows} filters={selected} ready />);
    expect(html).toContain("Combined net sales</span><strong>$100");
    expect(html).toContain("must match both");
    expect(renderToStaticMarkup(<GpoBusinessSummary rows={rows} filters={{ ...emptyFilters, regionalPurchasingGroup: ["Example regional group"] }} ready />)).toContain("Combined GPO business");
  });
  it("shows zero matches honestly and never displays false totals while research is unavailable", () => {
    expect(renderToStaticMarkup(<GpoBusinessSummary rows={[]} filters={filters} ready />)).toContain("No business matches");
    const loading = renderToStaticMarkup(<GpoBusinessSummary rows={[]} filters={filters} ready={false} />);
    expect(loading).toContain("unavailable until purchasing research loads");
    expect(loading).not.toContain("$0");
    expect(renderToStaticMarkup(<GpoBusinessSummary rows={[]} filters={emptyFilters} ready />)).toBe("");
  });
});
