import { describe, expect, it } from "vitest";
import {
  compareProspectAccounts,
  normalizeFacilityName,
  parseProspectAccountCsv,
  type ProspectAccountRow
} from "../src/lib/accountOverlap";
import type { SalesTransaction } from "../src/types";

function sale(patch: Partial<SalesTransaction> = {}): SalesTransaction {
  return {
    sourceFile: "sales.csv",
    sourceReportType: "YTD",
    sourceRowNumber: 1,
    customerRaw: "CUST100 Example Hospital",
    customerCode: "CUST100",
    customerName: "Example Hospital",
    transactionType: "Invoice",
    transactionDate: "2026-03-10",
    documentNumber: "INV-1",
    sku: "EAP-46B",
    productDescription: "EvoPatch 4x6",
    productClass: "EvoPatch",
    quantity: 2,
    unitPrice: 1000,
    revenue: 2000,
    salesRepVendor: "Current Distributor",
    shippingState: "IN",
    isCreditMemo: false,
    ...patch
  };
}

function prospect(patch: Partial<ProspectAccountRow> = {}): ProspectAccountRow {
  return {
    sourceRowNumbers: [2],
    soldToName: "Example Hospital",
    soldToStreet: "100 Main St",
    soldToCity: "Indianapolis",
    soldToState: "IN",
    soldToZip: "46201",
    shipToCode: "12345",
    shipToName: "Example Hospital",
    shipToStreet: "100 Main St",
    shipToCity: "Indianapolis",
    shipToState: "IN",
    shipToZip: "46201",
    ...patch
  };
}

describe("prospect account list parsing", () => {
  it("parses the Chase-style headers and consolidates exact duplicate rows", () => {
    const csv = [
      "Sold-To Name,Sold-To Street,Sold-To City,Sold-To State,Sold-To Zip,Ship-To,Ship-To Name,Ship-To Street,Ship-To City,Ship-To State,Ship-To Zip",
      "BALL MEMORIAL HOSPITAL,2401 WEST UNIVERSITY AVE.,MUNCIE,IN,47303-3499,185021,BALL MEMORIAL HOSPITAL,2401 WEST UNIVERSITY AVE.,MUNCIE,IN,47303-3499",
      "BALL MEMORIAL HOSPITAL,2401 WEST UNIVERSITY AVE.,MUNCIE,IN,47303-3499,185021,BALL MEMORIAL HOSPITAL,2401 WEST UNIVERSITY AVE.,MUNCIE,IN,47303-3499"
    ].join("\n");

    const parsed = parseProspectAccountCsv("book.csv", csv);

    expect(parsed).toMatchObject({ rawRowCount: 2, duplicateRowCount: 1 });
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        sourceRowNumbers: [2, 3],
        shipToCode: "185021",
        shipToName: "BALL MEMORIAL HOSPITAL"
      })
    ]);
  });

  it("requires identifiable Sold-To and Ship-To name columns", () => {
    expect(() => parseProspectAccountCsv("bad.csv", "Name,State\nExample,IN"))
      .toThrow("No account-list header row was found");
  });
});

describe("prospect account overlap", () => {
  it("classifies an exact facility and state match as a sales overlap", () => {
    const rows = [
      sale(),
      sale({
        sourceRowNumber: 2,
        transactionDate: "2025-11-01",
        documentNumber: "INV-2",
        revenue: 500,
        quantity: 1,
        salesRepVendor: "Prior Rep",
        productClass: "DBM",
        productDescription: "DBM"
      })
    ];

    expect(compareProspectAccounts([prospect()], rows)).toEqual([
      expect.objectContaining({
        status: "sales-overlap",
        matchedCustomerName: "Example Hospital",
        currentYearRevenue: 2000,
        revenue: 2500,
        transactions: 2,
        salesRepVendors: ["Current Distributor", "Prior Rep"],
        productFamilies: ["EvoPatch", "DBM"]
      })
    ]);
  });

  it("matches a facility to the leaf name of a NetSuite customer hierarchy", () => {
    const rows = [sale({ customerName: "Health System : North Campus Hospital" })];
    const review = compareProspectAccounts([
      prospect({ soldToName: "Health System", shipToName: "North Campus Hosp." })
    ], rows);

    expect(review[0]).toMatchObject({
      status: "sales-overlap",
      matchedCustomerName: "Health System : North Campus Hospital"
    });
  });

  it("holds an exact name with a conflicting state for identity review", () => {
    const review = compareProspectAccounts([
      prospect({ soldToState: "OH", shipToState: "OH" })
    ], [sale()]);

    expect(review[0]).toMatchObject({ status: "possible-overlap" });
    expect(review[0].matchReason).toContain("shipping state differs");
  });

  it("does not suggest a generic fuzzy match from another state", () => {
    const review = compareProspectAccounts([
      prospect({
        soldToName: "Carmel Specialty Surgery Center",
        shipToName: "Carmel Specialty Surgery Center"
      })
    ], [sale({
      customerName: "Maryland Specialty Surgery Center, LLC",
      shippingState: "MD"
    })]);

    expect(review[0]).toMatchObject({ status: "no-sales-found" });
  });

  it("keeps a strong fuzzy name in the same state for identity review", () => {
    const review = compareProspectAccounts([
      prospect({ soldToName: "Example Hospital Center", shipToName: "Example Hospital Center" })
    ], [sale()]);

    expect(review[0]).toMatchObject({
      status: "possible-overlap",
      matchedCustomerName: "Example Hospital"
    });
  });

  it("does not call an unmatched prospect new to Evologics", () => {
    const review = compareProspectAccounts([
      prospect({ soldToName: "Unlisted Facility", shipToName: "Unlisted Facility" })
    ], [sale()]);

    expect(review[0]).toMatchObject({
      status: "no-sales-found",
      matchReason: "No matching customer name was found in the loaded sales ledger."
    });
  });

  it("normalizes common healthcare abbreviations without dropping identity words", () => {
    expect(normalizeFacilityName("St. Francis Med. Ctr., LLC"))
      .toBe("SAINT FRANCIS MEDICAL CENTER");
  });
});
