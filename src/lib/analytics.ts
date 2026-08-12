import type {
  ImportLedger,
  ImportQualitySummary,
  ParsedSalesRows,
  SalesTransaction,
  SalesRepMapping,
  SkuEnrichment
} from "../types";

export type DatePreset =
  | "all"
  | "ytd"
  | "quarter"
  | "month"
  | "previousMonth"
  | "previousYear"
  | "custom";
export type DateBasis = "transaction" | "created";

export type DashboardFilters = {
  datePreset: DatePreset;
  dateBasis: DateBasis;
  customStart?: string;
  customEnd?: string;
  salesRepVendor: string[];
  salesGroup: string[];
  managers: string[];
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
  managers: [],
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
    if (!matchesManager(row.salesRepVendor, filters.managers)) return false;
    if (!matches(row.salesCategory, filters.salesCategory)) return false;
    if (!matches(productFamily(row), filters.productClass)) return false;
    if (!matches(row.sku, filters.sku)) return false;
    if (!matches(row.customerName, filters.customerName)) return false;
    if (!matches(row.shippingState, filters.shippingState)) return false;
    if (!matches(row.transactionType, filters.transactionType)) return false;
    return true;
  });
}

export const managerOptions = [
  "Jim Courville",
  "Ryan Gray",
  "Sam Williamson",
  "Garrett Hebert",
  "Jerry Pascucci"
] as const;

const managerAliases: Record<(typeof managerOptions)[number], string[]> = {
  "Jim Courville": ["Jim Courville"],
  "Ryan Gray": ["Ryan Gray", "Rachel Gray", "Star Surgical Consultants LLC"],
  "Sam Williamson": ["Sam Williamson", "Samuel Williamson"],
  "Garrett Hebert": [
    "Garret Hebert",
    "Garrett Hebert",
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
  ],
  "Jerry Pascucci": ["Jerry Pascucci", "Pascucci Enterprises"]
};

function matchesManager(value: string | undefined, selected: string[]) {
  if (!selected.length) return true;
  if (!value) return false;
  const normalizedValue = value.trim().toLowerCase();
  return selected.some((manager) =>
    (managerAliases[manager as keyof typeof managerAliases] ?? [manager]).some(
      (alias) => alias.toLowerCase() === normalizedValue
    )
  );
}

export function productFamily(row: SalesTransaction) {
  const source = `${row.productClass ?? ""} ${row.productDescription} ${row.sku}`.toLowerCase();
  if (source.includes("evo patch") || source.includes("evopatch")) return "EvoPatch";
  if (source.includes("a-matrx") || source.includes("amatrx") || source.includes("evoflakes")) return "A-MATRX";
  if (source.includes("demineralized bone matrix") || /\bdbm\b/.test(source)) return "DBM";
  if (source.includes("cancellous")) return "Cancellous";
  if (source.includes("fascia lata") || source.includes("pericardium")) return "Fascia Lata & Pericardium";
  if (source.includes("soft tissue allograft") || source.includes("tendon")) return "Sports Medicine";
  if (source.includes("cortical bone") || source.includes("traditional bone allograft")) return "Allograft Bone";
  if (source.includes("acellular dermal") || source.includes("evoderm")) return "Acellular Dermal Matrix";
  if (source.includes("bone marrow")) return "Bone Marrow";
  if (/\bprp\b/.test(source)) return "PRP";
  if (source.includes("hardware")) return "Hardware";
  if (source.includes("synthetic")) return "Synthetics";
  if (source.includes("private label")) return "Private Label";
  return row.productClass?.trim() || "Other";
}

export function productFamilyOptions(rows: SalesTransaction[]) {
  return Array.from(new Set(rows.map(productFamily).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function skuOptionsForProductFamilies(rows: SalesTransaction[], families: string[]) {
  return Array.from(
    new Set(
      rows
        .filter((row) => !families.length || families.includes(productFamily(row)))
        .map((row) => row.sku)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
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
  if (filters.datePreset === "previousYear") {
    const previousYear = anchor.getUTCFullYear() - 1;
    return { start: `${previousYear}-01-01`, end: `${previousYear}-12-31` };
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
export type ProductClassUnitsMode = "ytd" | "month" | "mom" | "yoy";
export type PeriodComparisonMode = "yoy" | "qoq" | "mom";
export type PeriodComparisonBasis = "previous-period" | "previous-year";

export type PeriodComparisonPoint = {
  period: string;
  currentRevenue: number;
  previousRevenue: number;
  currentQuantity: number;
  previousQuantity: number;
};

export type PeriodComparisonAnalysis = {
  mode: PeriodComparisonMode;
  basis: PeriodComparisonBasis;
  currentLabel: string;
  previousLabel: string;
  currentRange: { start: string; end: string };
  previousRange: { start: string; end: string };
  currentRevenue: number;
  previousRevenue: number;
  revenueChangePct: number | null;
  currentQuantity: number;
  previousQuantity: number;
  quantityChangePct: number | null;
  series: PeriodComparisonPoint[];
};

export type ProductClassSkuUnitsRow = {
  sku: string;
  description: string;
  currentUnits: number;
  comparisonUnits: number;
  changeUnits: number;
  changePct: number | null;
};

export type ProductClassSkuUnitsAnalysis = {
  currentLabel: string;
  comparisonLabel?: string;
  anchorDate?: string;
  rows: ProductClassSkuUnitsRow[];
};

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

export function productClassSkuUnits(
  rows: SalesTransaction[],
  productClass: string,
  mode: ProductClassUnitsMode,
  dateBasis: DateBasis = "transaction",
  selectedMonth?: string
): ProductClassSkuUnitsAnalysis {
  const classRows = rows.filter((row) => productFamily(row) === productClass);
  const classRange = dateRange(classRows, dateBasis);
  if (!classRange) return { currentLabel: "No data", rows: [] };

  const anchorDate = classRange.end;
  const anchorMonth = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)
    ? selectedMonth
    : anchorDate.slice(0, 7);
  const anchorYear = anchorDate.slice(0, 4);
  let currentStart = `${anchorYear}-01-01`;
  let currentEnd = anchorDate;
  let currentLabel = `${anchorYear} YTD`;
  let comparisonStart: string | undefined;
  let comparisonEnd: string | undefined;
  let comparisonLabel: string | undefined;

  if (mode === "month" || mode === "mom") {
    currentStart = `${anchorMonth}-01`;
    currentEnd = monthEnd(anchorMonth);
    currentLabel = formatMonthLabel(anchorMonth);
  }

  if (mode === "mom") {
    const previousMonth = shiftMonth(anchorMonth, -1);
    comparisonStart = `${previousMonth}-01`;
    comparisonEnd = monthEnd(previousMonth);
    comparisonLabel = formatMonthLabel(previousMonth);
  }

  if (mode === "yoy") {
    comparisonStart = `${Number(anchorYear) - 1}-01-01`;
    comparisonEnd = shiftYearClamped(anchorDate, -1);
    comparisonLabel = `${Number(anchorYear) - 1} YTD`;
  }

  const grouped = groupBy(classRows, (row) => row.sku || "Unassigned");
  const analysisRows = Object.entries(grouped)
    .map(([sku, skuRows]) => {
      const currentUnits = sum(
        skuRows.filter((row) => withinRange(salesDate(row, dateBasis), currentStart, currentEnd)),
        "quantity"
      );
      const comparisonUnits = comparisonStart && comparisonEnd
        ? sum(
            skuRows.filter((row) =>
              withinRange(salesDate(row, dateBasis), comparisonStart, comparisonEnd)
            ),
            "quantity"
          )
        : 0;
      return {
        sku,
        description: skuRows.find((row) => row.productDescription)?.productDescription ?? "",
        currentUnits,
        comparisonUnits,
        changeUnits: currentUnits - comparisonUnits,
        changePct: comparisonUnits ? currentUnits / comparisonUnits - 1 : null
      };
    })
    .sort((a, b) => b.currentUnits - a.currentUnits || b.comparisonUnits - a.comparisonUnits || a.sku.localeCompare(b.sku));

  return { currentLabel, comparisonLabel, anchorDate, rows: analysisRows };
}

export function periodComparison(
  rows: SalesTransaction[],
  mode: PeriodComparisonMode,
  dateBasis: DateBasis = "transaction",
  anchorDate?: string,
  basis: PeriodComparisonBasis = "previous-period"
): PeriodComparisonAnalysis | undefined {
  const availableRange = dateRange(rows, dateBasis);
  if (!availableRange) return undefined;
  const anchorValue = anchorDate && anchorDate <= availableRange.end ? anchorDate : availableRange.end;
  const anchor = parseDate(anchorValue);
  let currentStart: Date;
  let previousStart: Date;
  let previousEnd: Date;
  let currentLabel: string;
  let previousLabel: string;

  if (mode === "yoy") {
    currentStart = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    previousStart = new Date(Date.UTC(anchor.getUTCFullYear() - 1, 0, 1));
    previousEnd = parseDate(shiftYearClamped(anchorValue, -1));
    currentLabel = `${anchor.getUTCFullYear()} YTD`;
    previousLabel = `${anchor.getUTCFullYear() - 1} YTD`;
  } else if (mode === "qoq") {
    const quarterStartMonth = anchor.getUTCMonth() - (anchor.getUTCMonth() % 3);
    currentStart = new Date(Date.UTC(anchor.getUTCFullYear(), quarterStartMonth, 1));
    previousStart = basis === "previous-year"
      ? new Date(Date.UTC(anchor.getUTCFullYear() - 1, quarterStartMonth, 1))
      : new Date(Date.UTC(anchor.getUTCFullYear(), quarterStartMonth - 3, 1));
    previousEnd = clampPeriodEnd(
      addDays(previousStart, daysBetween(currentStart, anchor)),
      new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth() + 3, 0))
    );
    currentLabel = `Q${Math.floor(quarterStartMonth / 3) + 1} ${anchor.getUTCFullYear()} QTD`;
    previousLabel = `Q${Math.floor(previousStart.getUTCMonth() / 3) + 1} ${previousStart.getUTCFullYear()} comparable`;
  } else {
    currentStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    previousStart = basis === "previous-year"
      ? new Date(Date.UTC(anchor.getUTCFullYear() - 1, anchor.getUTCMonth(), 1))
      : new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
    previousEnd = clampPeriodEnd(
      addDays(previousStart, daysBetween(currentStart, anchor)),
      new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth() + 1, 0))
    );
    currentLabel = `${formatMonthLabel(anchorValue.slice(0, 7))} MTD`;
    previousLabel = `${formatMonthLabel(isoDate(previousStart).slice(0, 7))} comparable`;
  }

  const currentRange = { start: isoDate(currentStart), end: anchorValue };
  const previousRange = { start: isoDate(previousStart), end: isoDate(previousEnd) };
  const currentRows = rows.filter((row) =>
    withinRange(salesDate(row, dateBasis), currentRange.start, currentRange.end)
  );
  const previousRows = rows.filter((row) =>
    withinRange(salesDate(row, dateBasis), previousRange.start, previousRange.end)
  );
  const currentRevenue = sum(currentRows, "revenue");
  const previousRevenue = sum(previousRows, "revenue");
  const currentQuantity = sum(currentRows, "quantity");
  const previousQuantity = sum(previousRows, "quantity");

  return {
    mode,
    basis: mode === "yoy" ? "previous-year" : basis,
    currentLabel,
    previousLabel,
    currentRange,
    previousRange,
    currentRevenue,
    previousRevenue,
    revenueChangePct: previousRevenue ? currentRevenue / previousRevenue - 1 : null,
    currentQuantity,
    previousQuantity,
    quantityChangePct: previousQuantity ? currentQuantity / previousQuantity - 1 : null,
    series: buildComparisonSeries(
      currentRows,
      previousRows,
      mode,
      currentStart,
      anchor,
      previousStart,
      dateBasis
    )
  };
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

export function rankMomentumRowsByVolume(rows: MomentumRow[], limit = 50) {
  return [...rows]
    .sort(
      (a, b) =>
        b.currentRevenue + b.previousRevenue - (a.currentRevenue + a.previousRevenue)
    )
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

function withinRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function daysBetween(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function clampPeriodEnd(value: Date, maximum: Date) {
  return value <= maximum ? value : maximum;
}

function buildComparisonSeries(
  currentRows: SalesTransaction[],
  previousRows: SalesTransaction[],
  mode: PeriodComparisonMode,
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  dateBasis: DateBasis
) {
  const stepCount = mode === "yoy"
    ? currentEnd.getUTCMonth() + 1
    : mode === "qoq"
      ? Math.floor(daysBetween(currentStart, currentEnd) / 7) + 1
      : currentEnd.getUTCDate();
  let currentRevenue = 0;
  let previousRevenue = 0;
  let currentQuantity = 0;
  let previousQuantity = 0;

  return Array.from({ length: stepCount }, (_, index) => {
    const currentStepRows = currentRows.filter((row) =>
      comparisonStep(salesDate(row, dateBasis), mode, currentStart) === index
    );
    const previousStepRows = previousRows.filter((row) =>
      comparisonStep(salesDate(row, dateBasis), mode, previousStart) === index
    );
    currentRevenue += sum(currentStepRows, "revenue");
    previousRevenue += sum(previousStepRows, "revenue");
    currentQuantity += sum(currentStepRows, "quantity");
    previousQuantity += sum(previousStepRows, "quantity");
    return {
      period: comparisonStepLabel(index, mode, currentStart),
      currentRevenue,
      previousRevenue,
      currentQuantity,
      previousQuantity
    };
  });
}

function comparisonStep(dateValue: string, mode: PeriodComparisonMode, periodStart: Date) {
  const date = parseDate(dateValue);
  if (mode === "yoy") return date.getUTCMonth();
  const elapsedDays = daysBetween(periodStart, date);
  return mode === "qoq" ? Math.floor(elapsedDays / 7) : elapsedDays;
}

function comparisonStepLabel(index: number, mode: PeriodComparisonMode, periodStart: Date) {
  if (mode === "yoy") {
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(periodStart.getUTCFullYear(), index, 1)));
  }
  return mode === "qoq" ? `Week ${index + 1}` : String(index + 1);
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthEnd(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return isoDate(new Date(Date.UTC(year, monthNumber, 0)));
}

function shiftYearClamped(dateValue: string, amount: number) {
  const date = parseDate(dateValue);
  const year = date.getUTCFullYear() + amount;
  const month = date.getUTCMonth();
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return isoDate(new Date(Date.UTC(year, month, day)));
}

function formatMonthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(parseDate(`${month}-01`));
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
