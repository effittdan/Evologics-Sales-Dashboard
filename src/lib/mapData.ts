import type { DateBasis } from "./analytics";
import type { SalesTransaction } from "../types";

export type SalesMapProduct = {
  sku: string;
  description: string;
  quantity: number;
  revenue: number;
};

export type SalesMapCustomer = {
  name: string;
  quantity: number;
  revenue: number;
};

export type SalesMapState = {
  code: string;
  name: string;
  quantity: number;
  revenue: number;
  lineCount: number;
  documentCount: number;
  customerCount: number;
  products: SalesMapProduct[];
  customers: SalesMapCustomer[];
};

export type SalesMapPayload = {
  version: 1;
  generatedAt: string;
  sourceUpdatedAt?: string | null;
  dateBasis: DateBasis;
  dateRange?: { start: string; end: string };
  mappedStateCount: number;
  mappedLineCount: number;
  missingStateCount: number;
  documentCount: number;
  customerCount: number;
  quantity: number;
  revenue: number;
  states: SalesMapState[];
};

type MapPayloadOptions = {
  dateBasis: DateBasis;
  sourceUpdatedAt?: string | null;
  generatedAt?: string;
};

const stateNames: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico"
};

const stateCodesByName = new Map(
  Object.entries(stateNames).map(([code, name]) => [name.toLowerCase(), code])
);

export function buildSalesMapPayload(
  rows: SalesTransaction[],
  options: MapPayloadOptions
): SalesMapPayload {
  const states = new Map<string, StateAccumulator>();
  const documents = new Set<string>();
  const customers = new Set<string>();
  const mappedDates: string[] = [];
  let missingStateCount = 0;

  rows.forEach((row) => {
    const code = normalizeStateCode(row.shippingState);
    if (!code) {
      missingStateCount += 1;
      return;
    }

    const quantity = signedQuantity(row);
    const documentKey = row.documentNumber || `${row.sourceFile}:${row.sourceRowNumber}`;
    const customerName = row.customerName.trim() || "Unknown customer";
    const sku = row.sku.trim() || "Unknown item";
    const date = options.dateBasis === "created" && row.dateCreated
      ? row.dateCreated.slice(0, 10)
      : row.transactionDate;
    const state = states.get(code) ?? createStateAccumulator(code);

    state.quantity += quantity;
    state.revenue += row.revenue;
    state.lineCount += 1;
    state.documents.add(documentKey);
    state.customers.add(customerName);
    addProduct(state.products, sku, row.productDescription, quantity, row.revenue);
    addCustomer(state.customerTotals, customerName, quantity, row.revenue);
    states.set(code, state);
    documents.add(documentKey);
    customers.add(customerName);
    if (date) mappedDates.push(date);
  });

  const stateRows = [...states.values()]
    .map(finalizeState)
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name));

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceUpdatedAt: options.sourceUpdatedAt,
    dateBasis: options.dateBasis,
    dateRange: mappedDates.length
      ? { start: mappedDates.sort()[0], end: mappedDates.sort().at(-1)! }
      : undefined,
    mappedStateCount: stateRows.length,
    mappedLineCount: stateRows.reduce((sum, state) => sum + state.lineCount, 0),
    missingStateCount,
    documentCount: documents.size,
    customerCount: customers.size,
    quantity: stateRows.reduce((sum, state) => sum + state.quantity, 0),
    revenue: stateRows.reduce((sum, state) => sum + state.revenue, 0),
    states: stateRows
  };
}

export function normalizeStateCode(value?: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[.,]+$/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return undefined;
  const upper = normalized.toUpperCase();
  if (stateNames[upper]) return upper;
  return stateCodesByName.get(normalized.toLowerCase());
}

function signedQuantity(row: SalesTransaction) {
  return row.isCreditMemo ? -Math.abs(row.quantity) : row.quantity;
}

type StateAccumulator = {
  code: string;
  name: string;
  quantity: number;
  revenue: number;
  lineCount: number;
  documents: Set<string>;
  customers: Set<string>;
  products: Map<string, SalesMapProduct>;
  customerTotals: Map<string, SalesMapCustomer>;
};

function createStateAccumulator(code: string): StateAccumulator {
  return {
    code,
    name: stateNames[code],
    quantity: 0,
    revenue: 0,
    lineCount: 0,
    documents: new Set(),
    customers: new Set(),
    products: new Map(),
    customerTotals: new Map()
  };
}

function addProduct(
  products: Map<string, SalesMapProduct>,
  sku: string,
  description: string,
  quantity: number,
  revenue: number
) {
  const current = products.get(sku) ?? { sku, description, quantity: 0, revenue: 0 };
  current.quantity += quantity;
  current.revenue += revenue;
  if (!current.description && description) current.description = description;
  products.set(sku, current);
}

function addCustomer(
  customers: Map<string, SalesMapCustomer>,
  name: string,
  quantity: number,
  revenue: number
) {
  const current = customers.get(name) ?? { name, quantity: 0, revenue: 0 };
  current.quantity += quantity;
  current.revenue += revenue;
  customers.set(name, current);
}

function finalizeState(state: StateAccumulator): SalesMapState {
  return {
    code: state.code,
    name: state.name,
    quantity: state.quantity,
    revenue: state.revenue,
    lineCount: state.lineCount,
    documentCount: state.documents.size,
    customerCount: state.customers.size,
    products: [...state.products.values()]
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.sku.localeCompare(b.sku))
      .slice(0, 25),
    customers: [...state.customerTotals.values()]
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name))
      .slice(0, 12)
  };
}
