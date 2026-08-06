import type {
  ImportLedger,
  ImportQualitySummary,
  ParsedSalesRows,
  SalesTransaction,
  SalesRepMapping,
  SkuEnrichment
} from "../types";

export type DatePreset = "all" | "ytd" | "quarter" | "month" | "previousMonth" | "custom";
export type DateBasis = "transaction" | "created";

export type DashboardFilters = {
  datePreset: DatePreset;
  dateBasis: DateBasis;
  customStart?: string;
  customEnd?: string;
  salesRepVendor: string[];
  salesGroup: string[];
  salesEntityType: string[];
  salesCategory: string[];
  productClass: string[];
  sku: string[];
  customerName: string[];
  shippingState: string[];
  transactionType: string[];
};

export const emptyFilters: DashboardFilters = {
  datePreset: "all",
  dateBasis: "transaction",
  salesRepVendor: [],
  salesGroup: [],
  salesEntityType: [],
  salesCategory: [],
  productClass: [],
  sku: [],
  customerName: [],
  shippingState: [],
  transactionType: []
};

export function buildImportQualitySummary(
  parsed: ParsedSalesRows,
  transactions: SalesTransaction[],
  options: {
    batchId: string;
    importedAt: string;
    fileFingerprint: string;
    importSource?: "Manual" | "Automated";
    acceptedTransactionCount?: number;
    skippedDuplicateRows?: number;
    skippedDuplicateFile?: boolean;
  }
): ImportQualitySummary {
  const transactionRange = dateRange(transactions);
  const duplicateRowCount = countDuplicateRows(transactions);

  return {
    batchId: options.batchId,
    importSource: options.importSource ?? "Manual",
    sourceFile: parsed.sourceFile,
    sourceReportType: parsed.sourceReportType,
    sourceSheetName: parsed.sourceSheetName,
    importedAt: options.importedAt,
    fileFingerprint: options.fileFingerprint,
    parsedRowCount: parsed.rows.length,
    transactionCount: transactions.length,
    acceptedTransactionCount: options.acceptedTransactionCount ?? transactions.length,
    skippedDuplicateRows: options.skippedDuplicateRows ?? 0,
    skippedDuplicateFile: options.skippedDuplicateFile ?? false,
    excludedTotalRows: parsed.excludedTotalRows,
    excludedGroupRows: parsed.excludedGroupRows,
    parseErrors: parsed.parseErrors,
    dateRange: parsed.sourceDateRange ?? transactionRange,
    totalRevenue: sum(transactions, "revenue"),
    duplicateRowCount,
    missingSalesRepVendorCount: transactions.filter((row) => !row.salesRepVendor).length,
    missingProductClassCount: transactions.filter((row) => !row.productClass).length,
    missingSalesCategoryCount: transactions.filter((row) => !row.salesCategory).length,
    missingStateCount: transactions.filter((row) => !row.shippingState).length
  };
}

export function createEmptyImportLedger(): ImportLedger {
  return {
    version: 1,
    transactions: [],
    quality: [],
    importedFileFingerprints: [],
    importedTransactionKeys: []
  };
}

export function salesTransactionKey(row: SalesTransaction) {
  return [
    row.transactionDate,
    row.documentNumber,
    row.poNumber ?? "",
    row.customerName,
    row.sku,
    row.productDescription,
    row.quantity,
    row.unitPrice,
    row.revenue,
    row.transactionType,
    row.physicianId ?? "",
    row.patient ?? "",
    row.salesRepVendor ?? "",
    row.shippingState ?? ""
  ]
    .map((value) => String(value).trim().toLowerCase())
    .join("|");
}

export function partitionNewTransactions(
  rows: SalesTransaction[],
  existingKeys: Set<string>
) {
  const accepted = rows.filter((row) => !existingKeys.has(salesTransactionKey(row)));
  return {
    accepted,
    skippedDuplicateRows: rows.length - accepted.length
  };
}

export function applyEnrichments(
  rows: SalesTransaction[],
  repMappings: SalesRepMapping[],
  skuEnrichments: SkuEnrichment[]
) {
  const repMap = new Map(repMappings.map((mapping) => [mapping.salesRepVendor, mapping]));
  const skuMap = new Map(skuEnrichments.map((mapping) => [mapping.sku, mapping]));

  return rows.map((row) => {
    const rep = row.salesRepVendor ? repMap.get(row.salesRepVendor) : undefined;
    const sku = row.sku ? skuMap.get(row.sku) : undefined;
    return {
      ...row,
      salesEntityType: rep?.salesEntityType ?? row.salesEntityType ?? "Unknown",
      salesGroup: rep?.salesGroup,
      productClass: row.productClass || sku?.productClass || sku?.category
    };
  });
}

export function applyFilters(rows: SalesTransaction[], filters: DashboardFilters) {
  const range = resolveDateRange(rows, filters);
  return rows.filter((row) => {
    const rowDate = salesDate(row, filters.dateBasis);
    if (range.start && rowDate < range.start) return false;
    if (range.end && rowDate > range.end) return false;
    if (!matches(row.salesRepVendor, filters.salesRepVendor)) return false;
    if (!matches(row.salesGroup, filters.salesGroup)) return false;
    if (!matches(row.salesEntityType, filters.salesEntityType)) return false;
    if (!matches(row.salesCategory, filters.salesCategory)) return false;
    if (!matches(row.productClass, filters.productClass)) return false;
    if (!matches(row.sku, filters.sku)) return false;
    if (!matches(row.customerName, filters.customerName)) return false;
    if (!matches(row.shippingState, filters.shippingState)) return false;
    if (!matches(row.transactionType, filters.transactionType)) return false;
    return true;
  });
}

export function withoutShippingStateFilter(filters: DashboardFilters): DashboardFilters {
  return { ...filters, shippingState: [] };
}

export function resolveDateRange(rows: SalesTransaction[], filters: DashboardFilters) {
  const range = dateRange(rows, filters.dateBasis);
  if (!range) return {};
  const anchor = parseDate(range.end);
  if (filters.datePreset === "all") return {};
  if (filters.datePreset === "custom") {
    return { start: filters.customStart, end: filters.customEnd };
  }
  if (filters.datePreset === "ytd") {
    return { start: `${anchor.getUTCFullYear()}-01-01`, end: range.end };
  }
  if (filters.datePreset === "quarter") {
    const month = anchor.getUTCMonth();
    const quarterStartMonth = month - (month % 3);
    return {
      start: isoDate(new Date(Date.UTC(anchor.getUTCFullYear(), quarterStartMonth, 1))),
      end: range.end
    };
  }
  if (filters.datePreset === "month") {
    return {
      start: isoDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))),
      end: range.end
    };
  }
  const previousMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
  return {
    start: isoDate(previousMonth),
    end: isoDate(new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 0)))
  };
}

export function kpis(rows: SalesTransaction[]) {
  const revenue = sum(rows, "revenue");
  const quantity = sum(rows, "quantity");
  return {
    revenue,
    quantity,
    transactionCount: rows.length,
    uniqueCustomers: unique(rows.map((row) => row.customerName)).length,
    uniqueSkus: unique(rows.map((row) => row.sku)).length,
    averageRevenuePerLine: rows.length ? revenue / rows.length : 0,
    averageUnitPrice: quantity ? revenue / quantity : 0
  };
}

export type TimeSeriesGrain = "day" | "week" | "month" | "quarter" | "year";
export type MomentumEntity = "distributor" | "state" | "hospital";
export type MomentumMetric = "change" | "revenue";

export type MomentumRow = {
  name: string;
  currentRevenue: number;
  previousRevenue: number;
  changeRevenue: number;
  changePct: number | null;
  trend: { period: string; revenue: number }[];
};

export type MomentumAnalysis = {
  currentRange: { start: string; end: string };
  previousRange: { start: string; end: string };
  rows: MomentumRow[];
};

export function timeSeries(
  rows: SalesTransaction[],
  grain: TimeSeriesGrain,
  dateBasis: DateBasis = "transaction"
) {
  const grouped = groupBy(rows, (row) => periodKey(salesDate(row, dateBasis), grain));
  return Object.entries(grouped)
    .map(([period, periodRows]) => ({
      period,
      revenue: sum(periodRows, "revenue"),
      quantity: sum(periodRows, "quantity"),
      transactions: periodRows.length
    }))
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((row, index, all) => ({
      ...row,
      changePct: index > 0 && all[index - 1].revenue ? row.revenue / all[index - 1].revenue - 1 : null
    }));
}

export function entityMomentum(
  rows: SalesTransaction[],
  entity: MomentumEntity,
  dateBasis: DateBasis = "transaction"
): MomentumAnalysis | undefined {
  const range = dateRange(rows, dateBasis);
  if (!range) return undefined;

  const latestDate = parseDate(range.end);
  const completedWeekEnd = latestDate.getUTCDay() === 0
    ? latestDate
    : addDays(startOfWeek(latestDate), -1);
  const currentStart = addDays(completedWeekEnd, -27);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -27);
  const weekStarts = Array.from({ length: 8 }, (_, index) => addDays(previousStart, index * 7));
  const grouped = new Map<string, SalesTransaction[]>();

  rows.forEach((row) => {
    const date = parseDate(salesDate(row, dateBasis));
    if (date < previousStart || date > completedWeekEnd) return;
    const name = momentumEntityName(row, entity);
    if (!name) return;
    grouped.set(name, [...(grouped.get(name) ?? []), row]);
  });

  const analysisRows = [...grouped.entries()].map(([name, entityRows]) => {
    const currentRows = entityRows.filter((row) => parseDate(salesDate(row, dateBasis)) >= currentStart);
    const previousRows = entityRows.filter((row) => parseDate(salesDate(row, dateBasis)) <= previousEnd);
    const currentRevenue = sum(currentRows, "revenue");
    const previousRevenue = sum(previousRows, "revenue");
    return {
      name,
      currentRevenue,
      previousRevenue,
      changeRevenue: currentRevenue - previousRevenue,
      changePct: previousRevenue ? currentRevenue / previousRevenue - 1 : null,
      trend: weekStarts.map((weekStart) => {
        const weekEnd = addDays(weekStart, 6);
        return {
          period: isoDate(weekStart),
          revenue: sum(
            entityRows.filter((row) => {
              const date = parseDate(salesDate(row, dateBasis));
              return date >= weekStart && date <= weekEnd;
            }),
            "revenue"
          )
        };
      })
    };
  });

  return {
    currentRange: { start: isoDate(currentStart), end: isoDate(completedWeekEnd) },
    previousRange: { start: isoDate(previousStart), end: isoDate(previousEnd) },
    rows: analysisRows
  };
}

export function rankMomentumRows(
  rows: MomentumRow[],
  metric: MomentumMetric,
  direction: "top" | "bottom",
  limit = 20
) {
  const value = (row: MomentumRow) => metric === "change" ? row.changeRevenue : row.currentRevenue;
  return [...rows]
    .sort((a, b) => direction === "top" ? value(b) - value(a) : value(a) - value(b))
    .slice(0, limit);
}

export function topByRevenue(
  rows: SalesTransaction[],
  key: keyof SalesTransaction,
  limit = 10
) {
  return Object.entries(groupBy(rows, (row) => String(row[key] || "Unassigned")))
    .map(([name, groupRows]) => ({
      name,
      revenue: sum(groupRows, "revenue"),
      quantity: sum(groupRows, "quantity"),
      transactions: groupRows.length
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export function repPerformance(rows: SalesTransaction[], dateBasis: DateBasis = "transaction") {
  return Object.entries(groupBy(rows, (row) => row.salesRepVendor || "Unassigned"))
    .map(([name, groupRows]) => ({
      name,
      revenue: sum(groupRows, "revenue"),
      quantity: sum(groupRows, "quantity"),
      transactions: groupRows.length,
      customerCount: unique(groupRows.map((row) => row.customerName)).length,
      topProduct: topByRevenue(groupRows, "sku", 1)[0]?.name ?? "None",
      momChange: periodChange(groupRows, "month", dateBasis),
      qoqChange: periodChange(groupRows, "quarter", dateBasis)
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function productPerformance(rows: SalesTransaction[]) {
  return Object.entries(groupBy(rows, (row) => row.sku || "Unassigned"))
    .map(([sku, groupRows]) => {
      const revenue = sum(groupRows, "revenue");
      const quantity = sum(groupRows, "quantity");
      return {
        sku,
        description: groupRows[0]?.productDescription ?? "",
        productClass: groupRows.find((row) => row.productClass)?.productClass ?? "",
        revenue,
        quantity,
        averageUnitPrice: quantity ? revenue / quantity : 0,
        transactions: groupRows.length,
        topCustomers: topByRevenue(groupRows, "customerName", 3).map((row) => row.name).join(", "),
        topReps: topByRevenue(groupRows, "salesRepVendor", 3).map((row) => row.name).join(", ")
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function customerPerformance(rows: SalesTransaction[]) {
  return topByRevenue(rows, "customerName", 20);
}

export function optionValues(rows: SalesTransaction[], key: keyof SalesTransaction) {
  return unique(rows.map((row) => String(row[key] ?? "").trim()).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b)
  );
}

export function dateRange(rows: SalesTransaction[], dateBasis: DateBasis = "transaction") {
  if (!rows.length) return undefined;
  const dates = rows.map((row) => salesDate(row, dateBasis)).filter(Boolean).sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : undefined;
}

export function salesDate(row: SalesTransaction, dateBasis: DateBasis = "transaction") {
  return dateBasis === "created" && row.dateCreated
    ? row.dateCreated.slice(0, 10)
    : row.transactionDate;
}

export function countDuplicateRows(rows: SalesTransaction[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const key = [
      row.customerRaw,
      row.transactionType,
      row.transactionDate,
      row.documentNumber,
      row.poNumber,
      row.physicianId,
      row.patient,
      row.sku,
      row.quantity,
      row.unitPrice,
      row.revenue,
      row.salesRepVendor,
      row.shippingState
    ].join("|");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.values()].reduce((total, count) => total + (count > 1 ? count : 0), 0);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100000 ? 0 : 2
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(value);
}

function sum(rows: SalesTransaction[], key: "revenue" | "quantity") {
  return rows.reduce((total, row) => total + row[key], 0);
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item);
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function matches(value: string | undefined, allowed: string[]) {
  return allowed.length === 0 || allowed.includes(value || "");
}

function periodKey(dateValue: string, grain: TimeSeriesGrain) {
  const date = parseDate(dateValue);
  const year = date.getUTCFullYear();
  if (grain === "day") return isoDate(date);
  if (grain === "week") return isoDate(startOfWeek(date));
  if (grain === "year") return String(year);
  if (grain === "quarter") return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodChange(
  rows: SalesTransaction[],
  grain: "month" | "quarter",
  dateBasis: DateBasis
) {
  const series = timeSeries(rows, grain, dateBasis);
  return series.at(-1)?.changePct ?? null;
}

function parseDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date) {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + mondayOffset));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function momentumEntityName(row: SalesTransaction, entity: MomentumEntity) {
  if (entity === "state") return row.shippingState?.trim() || undefined;
  const category = row.salesCategory?.replace(/\s+/g, "").toLowerCase();
  if (entity === "distributor") {
    return category === "distributor" ? row.customerName.trim() : undefined;
  }
  if (category === "distributor" || category === "wholesale") return undefined;
  return row.customerName.trim() || undefined;
}
