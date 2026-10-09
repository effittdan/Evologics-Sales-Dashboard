import Papa from "papaparse";
import { productFamily } from "./analytics";
import type { SalesTransaction } from "../types";

export type ProspectAccountRow = {
  sourceRowNumbers: number[];
  soldToName: string;
  soldToStreet: string;
  soldToCity: string;
  soldToState: string;
  soldToZip: string;
  shipToCode: string;
  shipToName: string;
  shipToStreet: string;
  shipToCity: string;
  shipToState: string;
  shipToZip: string;
};

export type ProspectAccountParseResult = {
  sourceFile: string;
  sourceSheetName: string;
  rows: ProspectAccountRow[];
  rawRowCount: number;
  duplicateRowCount: number;
  warnings: string[];
};

export type AccountOverlapStatus = "sales-overlap" | "possible-overlap" | "no-sales-found";

export type AccountOverlapMatch = {
  prospect: ProspectAccountRow;
  status: AccountOverlapStatus;
  matchReason: string;
  matchedCustomerName?: string;
  matchedCustomerCode?: string;
  revenue: number;
  currentYearRevenue: number;
  quantity: number;
  transactions: number;
  firstSaleDate?: string;
  lastSaleDate?: string;
  salesRepVendors: string[];
  productFamilies: string[];
};

type LedgerAccount = {
  key: string;
  names: string[];
  aliases: Set<string>;
  customerCode?: string;
  states: Set<string>;
  rows: SalesTransaction[];
};

const expectedHeaders = [
  "Sold-To Name",
  "Sold-To Street",
  "Sold-To City",
  "Sold-To State",
  "Sold-To Zip",
  "Ship-To",
  "Ship-To Name",
  "Ship-To Street",
  "Ship-To City",
  "Ship-To State",
  "Ship-To Zip"
] as const;

const headerAliases: Record<(typeof expectedHeaders)[number], string[]> = {
  "Sold-To Name": ["sold to name", "sold-to name", "sold to", "account name", "customer name"],
  "Sold-To Street": ["sold to street", "sold-to street", "sold to address", "customer street"],
  "Sold-To City": ["sold to city", "sold-to city", "customer city"],
  "Sold-To State": ["sold to state", "sold-to state", "customer state"],
  "Sold-To Zip": ["sold to zip", "sold-to zip", "sold to postal code", "customer zip"],
  "Ship-To": ["ship to", "ship-to", "ship to code", "ship-to code", "location id"],
  "Ship-To Name": ["ship to name", "ship-to name", "facility", "facility name", "hospital"],
  "Ship-To Street": ["ship to street", "ship-to street", "ship to address", "facility street"],
  "Ship-To City": ["ship to city", "ship-to city", "facility city"],
  "Ship-To State": ["ship to state", "ship-to state", "facility state", "state"],
  "Ship-To Zip": ["ship to zip", "ship-to zip", "ship to postal code", "facility zip", "zip"]
};

export async function parseProspectAccountFile(file: File): Promise<ProspectAccountParseResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parseProspectAccountCsv(file.name, await file.text());
  }
  if (extension !== "xlsx") {
    throw new Error("Upload an Excel .xlsx workbook or a .csv file.");
  }

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await file.arrayBuffer()) as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook does not contain a worksheet.");

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(
      Array.from({ length: worksheet.actualColumnCount }, (_, index) =>
        row.getCell(index + 1).text.trim()
      )
    );
  });
  return parseProspectAccountRows(file.name, worksheet.name, rows);
}

export function parseProspectAccountCsv(
  sourceFile: string,
  text: string
): ProspectAccountParseResult {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(parsed.errors[0]?.message || "The CSV file could not be read.");
  }
  return parseProspectAccountRows(sourceFile, "CSV", parsed.data);
}

export function compareProspectAccounts(
  prospects: ProspectAccountRow[],
  salesRows: SalesTransaction[]
): AccountOverlapMatch[] {
  const accounts = buildLedgerAccounts(salesRows);
  const latestYear = salesRows.reduce(
    (year, row) => Math.max(year, Number(row.transactionDate.slice(0, 4)) || 0),
    0
  );

  return prospects.map((prospect) => {
    const candidates = prospectAliases(prospect)
      .flatMap((alias) => accounts.map((account) => scoreAccount(alias, prospect, account)))
      .sort((a, b) => b.score - a.score || b.account.rows.length - a.account.rows.length);
    const best = candidates[0];
    const exactName = Boolean(best && best.score >= 0.99);
    const reviewableFuzzyName = Boolean(best && best.score >= 0.72 && best.stateCompatible);
    if (!best || (!exactName && !reviewableFuzzyName)) return emptyMatch(prospect);

    const exact = exactName && best.stateCompatible;
    const status: AccountOverlapStatus = exact ? "sales-overlap" : "possible-overlap";
    const rows = best.account.rows;
    const salesRepVendors = rankValuesByRevenue(rows, (row) => row.salesRepVendor);
    const productFamilies = rankValuesByRevenue(rows, productFamily);
    const dates = rows.map((row) => row.transactionDate).filter(Boolean).sort();
    return {
      prospect,
      status,
      matchReason: exact
        ? best.reason
        : best.stateCompatible
          ? `${best.reason}; confirm the customer identity before treating this as an overlap.`
          : `${best.reason}; the shipping state differs, so this requires review.`,
      matchedCustomerName: representativeName(best.account),
      matchedCustomerCode: best.account.customerCode,
      revenue: sum(rows, (row) => row.revenue),
      currentYearRevenue: sum(
        rows.filter((row) => Number(row.transactionDate.slice(0, 4)) === latestYear),
        (row) => row.revenue
      ),
      quantity: sum(rows, (row) => row.quantity),
      transactions: rows.length,
      firstSaleDate: dates[0],
      lastSaleDate: dates[dates.length - 1],
      salesRepVendors,
      productFamilies
    };
  });
}

function parseProspectAccountRows(
  sourceFile: string,
  sourceSheetName: string,
  rows: string[][]
): ProspectAccountParseResult {
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.some((value) => headerAliases["Sold-To Name"].includes(value))
      && normalized.some((value) => headerAliases["Ship-To Name"].includes(value));
  });
  if (headerIndex < 0) {
    throw new Error("No account-list header row was found. Include Sold-To Name and Ship-To Name columns.");
  }

  const header = rows[headerIndex].map(normalizeHeader);
  const columnIndexes = Object.fromEntries(
    expectedHeaders.map((name) => [
      name,
      header.findIndex((value) => headerAliases[name].includes(value))
    ])
  ) as Record<(typeof expectedHeaders)[number], number>;
  const missingRequired = (["Sold-To Name", "Ship-To Name"] as const)
    .filter((name) => columnIndexes[name] < 0);
  if (missingRequired.length) {
    throw new Error(`Missing required columns: ${missingRequired.join(", ")}.`);
  }

  const parsedRows = rows.slice(headerIndex + 1).flatMap((values, index) => {
    const value = (name: (typeof expectedHeaders)[number]) => {
      const columnIndex = columnIndexes[name];
      return columnIndex < 0 ? "" : String(values[columnIndex] ?? "").trim();
    };
    const soldToName = value("Sold-To Name");
    const shipToName = value("Ship-To Name");
    if (!soldToName && !shipToName) return [];
    return [{
      sourceRowNumbers: [headerIndex + index + 2],
      soldToName,
      soldToStreet: value("Sold-To Street"),
      soldToCity: value("Sold-To City"),
      soldToState: value("Sold-To State"),
      soldToZip: value("Sold-To Zip"),
      shipToCode: normalizeNumericText(value("Ship-To")),
      shipToName,
      shipToStreet: value("Ship-To Street"),
      shipToCity: value("Ship-To City"),
      shipToState: value("Ship-To State"),
      shipToZip: value("Ship-To Zip")
    } satisfies ProspectAccountRow];
  });

  const deduplicated = new Map<string, ProspectAccountRow>();
  parsedRows.forEach((row) => {
    const key = expectedHeaders.map((name) => normalizeText(prospectValue(row, name))).join("|");
    const existing = deduplicated.get(key);
    if (existing) existing.sourceRowNumbers.push(...row.sourceRowNumbers);
    else deduplicated.set(key, row);
  });
  const duplicateRowCount = parsedRows.length - deduplicated.size;
  const warnings: string[] = [];
  if (duplicateRowCount) warnings.push(`${duplicateRowCount} exact duplicate source row${duplicateRowCount === 1 ? " was" : "s were"} consolidated for review.`);
  if (sourceSheetName !== "CSV" && sourceSheetName.toLowerCase() !== "sheet1") {
    warnings.push(`Read the first worksheet, ${sourceSheetName}.`);
  }
  return {
    sourceFile,
    sourceSheetName,
    rows: [...deduplicated.values()],
    rawRowCount: parsedRows.length,
    duplicateRowCount,
    warnings
  };
}

function buildLedgerAccounts(rows: SalesTransaction[]) {
  const accounts = new Map<string, LedgerAccount>();
  rows.forEach((row) => {
    const normalizedName = normalizeFacilityName(row.customerName);
    if (!normalizedName) return;
    const customerCode = row.customerCode?.trim();
    const key = customerCode ? `code:${customerCode.toLowerCase()}` : `name:${normalizedName}`;
    const account = accounts.get(key) ?? {
      key,
      names: [],
      aliases: new Set<string>(),
      customerCode,
      states: new Set<string>(),
      rows: []
    };
    if (!account.names.includes(row.customerName)) account.names.push(row.customerName);
    customerNameAliases(row.customerName).forEach((alias) => account.aliases.add(alias));
    if (row.shippingState?.trim()) account.states.add(row.shippingState.trim().toUpperCase());
    account.rows.push(row);
    accounts.set(key, account);
  });
  return [...accounts.values()];
}

function scoreAccount(alias: string, prospect: ProspectAccountRow, account: LedgerAccount) {
  let score = 0;
  let reason = "Similar account name";
  account.aliases.forEach((candidate) => {
    if (candidate === alias) {
      score = 1;
      reason = "Exact normalized account-name match";
      return;
    }
    const similarity = tokenSimilarity(alias, candidate);
    if (similarity > score) score = similarity;
  });
  const state = (prospect.shipToState || prospect.soldToState).trim().toUpperCase();
  const stateCompatible = !state || !account.states.size || account.states.has(state);
  return { account, score, reason, stateCompatible };
}

function emptyMatch(prospect: ProspectAccountRow): AccountOverlapMatch {
  return {
    prospect,
    status: "no-sales-found",
    matchReason: "No matching customer name was found in the loaded sales ledger.",
    revenue: 0,
    currentYearRevenue: 0,
    quantity: 0,
    transactions: 0,
    salesRepVendors: [],
    productFamilies: []
  };
}

function prospectAliases(row: ProspectAccountRow) {
  return [...new Set([row.shipToName, row.soldToName].map(normalizeFacilityName).filter(Boolean))];
}

function customerNameAliases(name: string) {
  const segments = name.split(":").map(normalizeFacilityName).filter(Boolean);
  return [...new Set([normalizeFacilityName(name), ...segments])];
}

export function normalizeFacilityName(value: string) {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bST\.?\b/g, "SAINT")
    .replace(/\bCTR\.?\b/g, "CENTER")
    .replace(/\bHOSP\.?\b/g, "HOSPITAL")
    .replace(/\bMED\.?\b/g, "MEDICAL")
    .replace(/\bHLTH\.?\b/g, "HEALTH")
    .replace(/\bINCORPORATED\b|\bINC\b|\bLLC\b|\bLTD\b|\bCORPORATION\b|\bCORP\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 1));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = overlap / union;
  const containment = overlap / Math.min(leftTokens.size, rightTokens.size);
  if (overlap < 2 && Math.min(leftTokens.size, rightTokens.size) > 1) return jaccard;
  return Math.max(jaccard, containment * 0.82);
}

function rankValuesByRevenue(
  rows: SalesTransaction[],
  getValue: (row: SalesTransaction) => string | undefined
) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const value = getValue(row)?.trim();
    if (!value) return;
    totals.set(value, (totals.get(value) ?? 0) + row.revenue);
  });
  return [...totals].sort((a, b) => b[1] - a[1]).map(([value]) => value);
}

function representativeName(account: LedgerAccount) {
  return account.names
    .map((name) => ({ name, revenue: sum(account.rows.filter((row) => row.customerName === name), (row) => row.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)[0]?.name ?? account.names[0];
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizeText(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeNumericText(value: string) {
  return value.replace(/\.0$/, "");
}

function prospectValue(row: ProspectAccountRow, name: (typeof expectedHeaders)[number]) {
  const values: Record<(typeof expectedHeaders)[number], string> = {
    "Sold-To Name": row.soldToName,
    "Sold-To Street": row.soldToStreet,
    "Sold-To City": row.soldToCity,
    "Sold-To State": row.soldToState,
    "Sold-To Zip": row.soldToZip,
    "Ship-To": row.shipToCode,
    "Ship-To Name": row.shipToName,
    "Ship-To Street": row.shipToStreet,
    "Ship-To City": row.shipToCity,
    "Ship-To State": row.shipToState,
    "Ship-To Zip": row.shipToZip
  };
  return values[name];
}

function sum<T>(rows: T[], getValue: (row: T) => number) {
  return rows.reduce((total, row) => total + getValue(row), 0);
}
