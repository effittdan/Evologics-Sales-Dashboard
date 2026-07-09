import { XMLParser } from "fast-xml-parser";
import Papa from "papaparse";
import type {
  ParsedSalesRows,
  RawSalesRow,
  SalesRepMapping,
  SalesTransaction,
  SkuEnrichment,
  SourceReportType
} from "../types";

const monthGroupPattern =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}$/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

export function isSpreadsheetMLExport(text: string) {
  const start = text.slice(0, 500).toLowerCase();
  return start.includes("<workbook") && start.includes("spreadsheet");
}

export function parseNetSuiteSpreadsheetMLReport(
  sourceFile: string,
  text: string
): ParsedSalesRows {
  if (!isSpreadsheetMLExport(text)) {
    return emptyParsed(sourceFile, "Unknown", ["File is not a SpreadsheetML/XML workbook."]);
  }

  const parseErrors: string[] = [];
  const workbook = parser.parse(text);
  const worksheet = first(asArray(workbook?.Workbook?.Worksheet));
  const sourceSheetName = attr(worksheet, "Name");
  const rawRows = asArray(worksheet?.Table?.Row);
  const tableRows = rawRows.map(readSpreadsheetRow);
  const headerIndex = tableRows.findIndex((row) => detectReportType(row) !== "Unknown");

  if (headerIndex < 0) {
    return emptyParsed(sourceFile, "Unknown", ["No supported NetSuite report header row found."]);
  }

  const headers = tableRows[headerIndex].map((value) => value.trim());
  const sourceReportType = detectReportType(headers);
  const sourceDateRange = detectSourceDateRange(tableRows.slice(0, headerIndex));
  let excludedTotalRows = 0;
  let excludedGroupRows = 0;
  let activeAccountingPeriod = "";
  const rows: RawSalesRow[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < tableRows.length; rowIndex += 1) {
    const cells = tableRows[rowIndex].map((value) => value.trim());
    const firstNonEmpty = cells.find(Boolean) ?? "";

    if (!firstNonEmpty) {
      continue;
    }

    if (/^total\b/i.test(firstNonEmpty)) {
      excludedTotalRows += 1;
      continue;
    }

    if (sourceReportType === "YTD" && monthGroupPattern.test(firstNonEmpty)) {
      activeAccountingPeriod = firstNonEmpty;
      excludedGroupRows += 1;
      continue;
    }

    const fields: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      fields[header] = cells[columnIndex] ?? "";
    });

    if (
      sourceReportType === "YTD" &&
      !fields["Accounting Period: Name"] &&
      activeAccountingPeriod
    ) {
      fields["Accounting Period: Name"] = activeAccountingPeriod;
    }

    if (!Object.values(fields).some(Boolean)) {
      continue;
    }

    rows.push({
      sourceFile,
      sourceReportType,
      sourceSheetName,
      sourceRowNumber: rowIndex + 1,
      fields
    });
  }

  return {
    sourceFile,
    sourceReportType,
    sourceSheetName,
    sourceDateRange,
    rows,
    excludedTotalRows,
    excludedGroupRows,
    parseErrors
  };
}

export function parseNetSuiteSavedSearchCSV(
  sourceFile: string,
  text: string
): ParsedSalesRows {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => String(value ?? "").trim()
  });
  const sourceReportType = detectReportType(parsed.meta.fields ?? []);

  return {
    sourceFile,
    sourceReportType,
    rows: (parsed.data ?? []).map((fields, index) => ({
      sourceFile,
      sourceReportType,
      sourceRowNumber: index + 2,
      fields
    })),
    excludedTotalRows: 0,
    excludedGroupRows: 0,
    parseErrors: parsed.errors.map((error) => error.message)
  };
}

export function parseNetSuiteSavedSearchXML(
  sourceFile: string,
  text: string
): ParsedSalesRows {
  try {
    const doc = parser.parse(text);
    const possibleRows =
      findArrayAtKeys(doc, ["row", "rows", "record", "records", "transaction", "transactions"]) ??
      [];
    const rows = possibleRows.map((entry, index) => {
      const fields = flattenRecord(entry);
      const sourceReportType = detectReportType(Object.keys(fields));
      return {
        sourceFile,
        sourceReportType,
        sourceRowNumber: index + 1,
        fields
      };
    });

    return {
      sourceFile,
      sourceReportType: detectReportType(Object.keys(rows[0]?.fields ?? {})),
      rows,
      excludedTotalRows: 0,
      excludedGroupRows: 0,
      parseErrors: rows.length ? [] : ["No row-like records found in XML export."]
    };
  } catch (error) {
    return emptyParsed(sourceFile, "Unknown", [
      error instanceof Error ? error.message : "Unable to parse XML export."
    ]);
  }
}

export function normalizeSalesTransactionRows(
  rows: RawSalesRow[],
  salesRepMappings: SalesRepMapping[] = [],
  skuEnrichments: SkuEnrichment[] = []
): SalesTransaction[] {
  const repMap = new Map(salesRepMappings.map((mapping) => [mapping.salesRepVendor, mapping]));
  const skuMap = new Map(skuEnrichments.map((mapping) => [mapping.sku, mapping]));

  return rows
    .map((row) => normalizeRow(row, repMap, skuMap))
    .filter((transaction): transaction is SalesTransaction => Boolean(transaction))
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
}

function normalizeRow(
  row: RawSalesRow,
  repMap: Map<string, SalesRepMapping>,
  skuMap: Map<string, SkuEnrichment>
): SalesTransaction | null {
  const fields = row.fields;
  const sourceType = row.sourceReportType;
  const get = (...names: string[]) => firstPresent(fields, names);

  const customerRaw =
    sourceType === "Weekly" ? get("Name", "customer") : get("Customer", "Name", "customer");
  const parsedCustomer = parseCustomer(customerRaw);
  const transactionDate = toIsoDate(get("Date", "Transaction Date", "transactionDate"));
  const documentNumber = get("Document Number", "Document No.", "documentNumber");
  const sku = get("Item", "SKU", "Item Internal ID", "item", "sku");
  const salesRepVendor = get("Sales Rep - Vendor", "Sales Rep", "Vendor", "salesRepVendor");
  const repMapping = salesRepVendor ? repMap.get(salesRepVendor) : undefined;
  const skuEnrichment = sku ? skuMap.get(sku) : undefined;
  const transactionType = get("Transaction Type", "Type", "transactionType");
  const productClass =
    get("Class", "Product Class", "Item Class", "productClass") ||
    skuEnrichment?.productClass ||
    skuEnrichment?.category;

  if (!transactionDate || !documentNumber || !sku) {
    return null;
  }

  return {
    sourceFile: row.sourceFile,
    sourceReportType: sourceType,
    sourceSheetName: row.sourceSheetName,
    sourceRowNumber: row.sourceRowNumber,
    customerRaw,
    customerCode: parsedCustomer.customerCode,
    customerName: parsedCustomer.customerName || customerRaw || "Unknown customer",
    transactionType,
    transactionDate,
    accountingPeriod: get("Accounting Period: Name", "Accounting Period", "accountingPeriod"),
    documentNumber,
    poNumber: get("PO Number", "PO/Check Number", "PO", "poNumber"),
    physicianId: get("Physician ID", "physicianId"),
    patient: get("Patient", "patient"),
    sku,
    productDescription: get("Item: Description (Sales)", "Description", "productDescription"),
    productClass,
    quantity: toNumber(get("Quantity", "quantity")),
    unitPrice: toNumber(get("Unit Price", "Item Rate", "unitPrice")),
    revenue: toNumber(get("Total Revenue", "Amount", "revenue")),
    salesRepVendor,
    salesEntityType: repMapping?.salesEntityType ?? "Unknown",
    salesGroup: repMapping?.salesGroup,
    shippingState: get(
      "Address: Shipping Address State",
      "Shipping State/Province",
      "Shipping State",
      "shippingState"
    ),
    dateCreated: toIsoDateTime(get("Date Created", "dateCreated")),
    isCreditMemo: /credit memo/i.test(transactionType)
  };
}

function readSpreadsheetRow(row: unknown) {
  const cells = asArray((row as { Cell?: unknown })?.Cell);
  const values: string[] = [];
  let cursor = 0;

  for (const cell of cells) {
    const explicitIndex = Number(attr(cell, "Index"));
    if (Number.isFinite(explicitIndex) && explicitIndex > 0) {
      cursor = explicitIndex - 1;
    }
    values[cursor] = cellText(cell);
    cursor += 1;
  }

  return values;
}

function detectReportType(headers: string[]): SourceReportType {
  const normalized = new Set(headers.map((header) => header.trim()));
  if (normalized.has("Accounting Period: Name") && normalized.has("Total Revenue")) {
    return "YTD";
  }
  if (normalized.has("PO/Check Number") && normalized.has("Amount")) {
    return "Weekly";
  }
  if (
    normalized.has("transactionDate") ||
    normalized.has("Transaction Date") ||
    normalized.has("Item Internal ID")
  ) {
    return "Unknown";
  }
  return "Unknown";
}

function emptyParsed(
  sourceFile: string,
  sourceReportType: SourceReportType,
  parseErrors: string[]
): ParsedSalesRows {
  return {
    sourceFile,
    sourceReportType,
    rows: [],
    excludedTotalRows: 0,
    excludedGroupRows: 0,
    parseErrors
  };
}

function cellText(cell: unknown) {
  const data = (cell as { Data?: unknown })?.Data;
  if (data === undefined || data === null) return "";
  if (typeof data === "string" || typeof data === "number") return String(data).trim();
  const text = (data as Record<string, unknown>)["#text"];
  return text === undefined || text === null ? "" : String(text).trim();
}

function attr(value: unknown, name: string) {
  const record = value as Record<string, unknown> | undefined;
  return String(record?.[`@_${name}`] ?? record?.[`@_ss:${name}`] ?? "");
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function first<T>(items: T[]) {
  return items[0];
}

function firstPresent(fields: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function parseCustomer(customerRaw: string) {
  const match = customerRaw.match(/^(CUST\d+)\s+(.+)$/i);
  return {
    customerCode: match?.[1],
    customerName: (match?.[2] ?? customerRaw).trim()
  };
}

function toNumber(value: string) {
  if (!value) return 0;
  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed);
  const numeric = Number(trimmed.replace(/[,$()\s]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return negative ? -numeric : numeric;
}

function toIsoDate(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function detectSourceDateRange(rows: string[][]) {
  for (const row of rows) {
    const text = row.join(" ").trim();
    const match = text.match(/([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})/);
    if (!match) continue;
    const start = toIsoDate(match[1]);
    const end = toIsoDate(match[2]);
    if (start && end) return { start, end };
  }
  return undefined;
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const normalized =
    /^\d{4}-\d{2}-\d{2}T/.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
      ? `${value}Z`
      : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function flattenRecord(record: unknown, prefix = ""): Record<string, string> {
  if (record === null || record === undefined) return {};
  if (typeof record !== "object") return { [prefix || "value"]: String(record) };
  const output: Record<string, string> = {};

  Object.entries(record as Record<string, unknown>).forEach(([key, value]) => {
    if (key.startsWith("@_")) return;
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(output, flattenRecord(value, nextKey));
    } else {
      output[nextKey] = Array.isArray(value) ? value.join(", ") : String(value ?? "").trim();
    }
  });

  return output;
}

function findArrayAtKeys(value: unknown, keys: string[]): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(key.toLowerCase())) {
      const rows = asArray(entry);
      if (rows.length) return rows;
    }
    const child = findArrayAtKeys(entry, keys);
    if (child?.length) return child;
  }
  return undefined;
}
