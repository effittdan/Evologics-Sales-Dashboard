import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Database,
  FileUp,
  PackageSearch,
  RefreshCcw,
  SlidersHorizontal,
  UsersRound
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  applyEnrichments,
  applyFilters,
  buildImportQualitySummary,
  countDuplicateRows,
  customerPerformance,
  dateRange,
  emptyFilters,
  formatCurrency,
  formatNumber,
  formatPercent,
  kpis,
  optionValues,
  productPerformance,
  repPerformance,
  resolveDateRange,
  timeSeries,
  topByRevenue,
  type DashboardFilters
} from "./lib/analytics";
import {
  isSpreadsheetMLExport,
  normalizeSalesTransactionRows,
  parseNetSuiteSavedSearchCSV,
  parseNetSuiteSavedSearchXML,
  parseNetSuiteSpreadsheetMLReport
} from "./lib/importers";
import type {
  ImportQualitySummary,
  SalesEntityType,
  SalesRepMapping,
  SalesTransaction,
  SkuEnrichment
} from "./types";

const chartColors = ["#1F4F45", "#4F7D6D", "#C9B27E", "#7B9C8D", "#AAB7BA"];
const storageKeys = {
  reps: "evologics-sales-rep-mappings",
  skus: "evologics-sku-enrichments"
};

export function App() {
  const [transactions, setTransactions] = useState<SalesTransaction[]>([]);
  const [quality, setQuality] = useState<ImportQualitySummary[]>([]);
  const [filters, setFilters] = useState<DashboardFilters>(emptyFilters);
  const [activeView, setActiveView] = useState("overview");
  const [trendGrain, setTrendGrain] = useState<"month" | "quarter" | "year">("month");
  const [repMappings, setRepMappings] = useState<SalesRepMapping[]>(() =>
    loadStored(storageKeys.reps, [])
  );
  const [skuEnrichments, setSkuEnrichments] = useState<SkuEnrichment[]>(() =>
    loadStored(storageKeys.skus, [])
  );
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    localStorage.setItem(storageKeys.reps, JSON.stringify(repMappings));
  }, [repMappings]);

  useEffect(() => {
    localStorage.setItem(storageKeys.skus, JSON.stringify(skuEnrichments));
  }, [skuEnrichments]);

  const enriched = useMemo(
    () => applyEnrichments(transactions, repMappings, skuEnrichments),
    [transactions, repMappings, skuEnrichments]
  );
  const filtered = useMemo(() => applyFilters(enriched, filters), [enriched, filters]);
  const metrics = useMemo(() => kpis(filtered), [filtered]);
  const sourceRange = dateRange(enriched);
  const importedSourceRange = useMemo(() => combineQualityRanges(quality), [quality]);
  const filteredRange = dateRange(filtered);
  const selectedRange = resolveDateRange(enriched, filters);
  const yearsLoaded = new Set(enriched.map((row) => row.transactionDate.slice(0, 4))).size;

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextTransactions: SalesTransaction[] = [];
    const nextQuality: ImportQualitySummary[] = [];
    const messages: string[] = [];

    for (const file of Array.from(files)) {
      const text = await file.text();
      const lowerName = file.name.toLowerCase();
      const parsed = isSpreadsheetMLExport(text)
        ? parseNetSuiteSpreadsheetMLReport(file.name, text)
        : lowerName.endsWith(".csv")
          ? parseNetSuiteSavedSearchCSV(file.name, text)
          : parseNetSuiteSavedSearchXML(file.name, text);
      const normalized = normalizeSalesTransactionRows(parsed.rows);
      nextTransactions.push(...normalized);
      nextQuality.push(buildImportQualitySummary(parsed, normalized));
      messages.push(`${file.name}: ${normalized.length.toLocaleString()} transaction lines`);
    }

    setTransactions((current) => [...current, ...nextTransactions]);
    setQuality((current) => [...current, ...nextQuality]);
    setImportMessage(messages.join(" | "));
  }

  function clearAllData() {
    setTransactions([]);
    setQuality([]);
    setImportMessage("");
    setFilters(emptyFilters);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <img src="/evologics-logo-wide.png" alt="Evologics" />
          <span>Sales Analytics</span>
        </div>
        <nav className="nav-list">
          <NavButton icon={<BarChart3 />} id="overview" active={activeView} onClick={setActiveView}>
            Overview
          </NavButton>
          <NavButton icon={<RefreshCcw />} id="trend" active={activeView} onClick={setActiveView}>
            Sales Trend
          </NavButton>
          <NavButton icon={<UsersRound />} id="reps" active={activeView} onClick={setActiveView}>
            Reps & Distributors
          </NavButton>
          <NavButton icon={<PackageSearch />} id="products" active={activeView} onClick={setActiveView}>
            Products
          </NavButton>
          <NavButton icon={<Database />} id="customers" active={activeView} onClick={setActiveView}>
            Customers & States
          </NavButton>
          <NavButton icon={<AlertTriangle />} id="quality" active={activeView} onClick={setActiveView}>
            Import Quality
          </NavButton>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">NetSuite source-agnostic import MVP</p>
            <h1>Evologics Sales Analytics</h1>
            <p className="subtle">
              {filtered.length.toLocaleString()} of {enriched.length.toLocaleString()} normalized line
              items
              {filteredRange ? ` | active transactions ${filteredRange.start} to ${filteredRange.end}` : ""}
            </p>
          </div>
          <div className="import-actions">
            <label className="upload-button">
              <FileUp size={18} />
              Import files
              <input
                type="file"
                multiple
                accept=".xls,.xml,.csv,text/xml,text/csv"
                onChange={(event) => void importFiles(event.currentTarget.files)}
              />
            </label>
            <button className="ghost-button" onClick={clearAllData} disabled={!enriched.length}>
              Clear
            </button>
          </div>
        </header>

        {importMessage ? <div className="status-strip">{importMessage}</div> : null}

        <FilterPanel
          rows={enriched}
          filters={filters}
          setFilters={setFilters}
          selectedRange={selectedRange}
        />

        {!enriched.length ? (
          <EmptyState />
        ) : (
          <>
            {activeView === "overview" && <Overview rows={filtered} metrics={metrics} />}
            {activeView === "trend" && (
              <TrendView
                rows={filtered}
                grain={trendGrain}
                setGrain={setTrendGrain}
                yearsLoaded={yearsLoaded}
              />
            )}
            {activeView === "reps" && (
              <RepView rows={filtered} allRows={enriched} mappings={repMappings} setMappings={setRepMappings} />
            )}
            {activeView === "products" && (
              <ProductView
                rows={filtered}
                allRows={enriched}
                enrichments={skuEnrichments}
                setEnrichments={setSkuEnrichments}
              />
            )}
            {activeView === "customers" && <CustomerGeoView rows={filtered} />}
            {activeView === "quality" && (
              <QualityView rows={enriched} quality={quality} sourceRange={importedSourceRange ?? sourceRange} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <FileUp size={34} />
      <h2>Import NetSuite sales exports to begin.</h2>
      <p>
        The MVP accepts current SpreadsheetML/XML `.xls` exports plus future CSV/XML saved-search
        exports, then normalizes each line into the same transaction model.
      </p>
    </section>
  );
}

function FilterPanel({
  rows,
  filters,
  setFilters,
  selectedRange
}: {
  rows: SalesTransaction[];
  filters: DashboardFilters;
  setFilters: (filters: DashboardFilters) => void;
  selectedRange: { start?: string; end?: string };
}) {
  const set = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) =>
    setFilters({ ...filters, [key]: value });

  return (
    <section className="filter-panel">
      <div className="filter-title">
        <SlidersHorizontal size={18} />
        <span>Global filters</span>
        <button className="link-button" onClick={() => setFilters(emptyFilters)}>
          Clear all
        </button>
      </div>
      <div className="filter-grid">
        <label>
          Date range
          <select value={filters.datePreset} onChange={(event) => set("datePreset", event.target.value as never)}>
            <option value="all">All data</option>
            <option value="ytd">YTD</option>
            <option value="quarter">Current quarter</option>
            <option value="month">Current month</option>
            <option value="previousMonth">Previous month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {filters.datePreset === "custom" ? (
          <>
            <label>
              Start
              <input
                type="date"
                value={filters.customStart ?? ""}
                onChange={(event) => set("customStart", event.target.value)}
              />
            </label>
            <label>
              End
              <input
                type="date"
                value={filters.customEnd ?? ""}
                onChange={(event) => set("customEnd", event.target.value)}
              />
            </label>
          </>
        ) : (
          <div className="range-readout">
            {selectedRange.start && selectedRange.end
              ? `${selectedRange.start} to ${selectedRange.end}`
              : "Using full imported range"}
          </div>
        )}
        <MultiSelect
          label="Sales rep / vendor"
          values={filters.salesRepVendor}
          options={optionValues(rows, "salesRepVendor")}
          onChange={(values) => set("salesRepVendor", values)}
        />
        <MultiSelect
          label="Sales group"
          values={filters.salesGroup}
          options={optionValues(rows, "salesGroup")}
          onChange={(values) => set("salesGroup", values)}
        />
        <MultiSelect
          label="Entity type"
          values={filters.salesEntityType}
          options={["Salesperson", "Distributor", "Vendor", "Unknown"]}
          onChange={(values) => set("salesEntityType", values)}
        />
        <MultiSelect
          label="Product class"
          values={filters.productClass}
          options={optionValues(rows, "productClass")}
          onChange={(values) => set("productClass", values)}
        />
        <MultiSelect
          label="SKU"
          values={filters.sku}
          options={optionValues(rows, "sku")}
          onChange={(values) => set("sku", values)}
        />
        <MultiSelect
          label="Customer"
          values={filters.customerName}
          options={optionValues(rows, "customerName")}
          onChange={(values) => set("customerName", values)}
        />
        <MultiSelect
          label="State"
          values={filters.shippingState}
          options={optionValues(rows, "shippingState")}
          onChange={(values) => set("shippingState", values)}
        />
        <MultiSelect
          label="Transaction type"
          values={filters.transactionType}
          options={optionValues(rows, "transactionType")}
          onChange={(values) => set("transactionType", values)}
        />
      </div>
    </section>
  );
}

function Overview({ rows, metrics }: { rows: SalesTransaction[]; metrics: ReturnType<typeof kpis> }) {
  const monthly = timeSeries(rows, "month");
  const quarterly = timeSeries(rows, "quarter");
  const topReps = topByRevenue(rows, "salesRepVendor", 10);
  const topProducts = topByRevenue(rows, "sku", 10);
  const productClass = topByRevenue(rows, "productClass", 10);

  return (
    <section className="view-stack">
      <div className="kpi-grid">
        <Kpi label="Total revenue" value={formatCurrency(metrics.revenue)} />
        <Kpi label="Total quantity" value={formatNumber(metrics.quantity)} />
        <Kpi label="Line items" value={metrics.transactionCount.toLocaleString()} />
        <Kpi label="Customers" value={metrics.uniqueCustomers.toLocaleString()} />
        <Kpi label="Unique SKUs" value={metrics.uniqueSkus.toLocaleString()} />
        <Kpi label="Avg revenue / line" value={formatCurrency(metrics.averageRevenuePerLine)} />
      </div>
      <div className="dashboard-grid">
        <ChartCard title="Revenue by Month">
          <RevenueArea data={monthly} />
        </ChartCard>
        <ChartCard title="Revenue by Quarter">
          <RevenueBar data={quarterly} />
        </ChartCard>
        <ChartCard title="Top Sales Reps / Vendors">
          <RevenueBar data={topReps} nameKey="name" />
        </ChartCard>
        <ChartCard title="Top Products / SKUs">
          <RevenueBar data={topProducts} nameKey="name" />
        </ChartCard>
        <ChartCard title="Sales by Product Class">
          {productClass.length ? <RevenueBar data={productClass} nameKey="name" /> : <SoftEmpty text="Upload a report with Class data or enrich SKUs to enable product-class reporting." />}
        </ChartCard>
      </div>
    </section>
  );
}

function TrendView({
  rows,
  grain,
  setGrain,
  yearsLoaded
}: {
  rows: SalesTransaction[];
  grain: "month" | "quarter" | "year";
  setGrain: (grain: "month" | "quarter" | "year") => void;
  yearsLoaded: number;
}) {
  const data = timeSeries(rows, grain);

  return (
    <section className="view-stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Movement</p>
          <h2>Sales trend</h2>
        </div>
        <div className="segmented">
          {(["month", "quarter", "year"] as const).map((item) => (
            <button key={item} className={grain === item ? "active" : ""} onClick={() => setGrain(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <ChartCard title={`${grainLabel(grain)} Revenue and Change`}>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#DDE7E1" vertical={false} />
            <XAxis dataKey="period" tick={{ fill: "#6F7775", fontSize: 12 }} />
            <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fill: "#6F7775", fontSize: 12 }} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            <Line type="monotone" dataKey="revenue" stroke="#1F4F45" strokeWidth={3} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Revenue</th>
              <th>Quantity</th>
              <th>Line items</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.period}>
                <td>{row.period}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{row.transactions.toLocaleString()}</td>
                <td className={row.changePct && row.changePct < 0 ? "negative" : "positive"}>
                  {formatPercent(row.changePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {yearsLoaded < 2 ? (
        <SoftEmpty text="Upload prior-year NetSuite reports to enable year-over-year comparison." />
      ) : null}
    </section>
  );
}

function RepView({
  rows,
  allRows,
  mappings,
  setMappings
}: {
  rows: SalesTransaction[];
  allRows: SalesTransaction[];
  mappings: SalesRepMapping[];
  setMappings: (mappings: SalesRepMapping[]) => void;
}) {
  const data = repPerformance(rows);
  const reps = optionValues(allRows, "salesRepVendor");

  return (
    <section className="view-stack">
      <ChartCard title="Revenue Trend for Current Rep / Vendor Filter">
        <RevenueArea data={timeSeries(rows, "month")} />
      </ChartCard>
      <div className="table-card">
        <h2>Sales Rep / Distributor Performance</h2>
        <table>
          <thead>
            <tr>
              <th>Rep / vendor</th>
              <th>Revenue</th>
              <th>Qty</th>
              <th>Lines</th>
              <th>Customers</th>
              <th>Top product</th>
              <th>MoM</th>
              <th>QoQ</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{row.transactions.toLocaleString()}</td>
                <td>{row.customerCount.toLocaleString()}</td>
                <td>{row.topProduct}</td>
                <td>{formatPercent(row.momChange)}</td>
                <td>{formatPercent(row.qoqChange)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MappingEditor reps={reps} mappings={mappings} setMappings={setMappings} />
    </section>
  );
}

function ProductView({
  rows,
  allRows,
  enrichments,
  setEnrichments
}: {
  rows: SalesTransaction[];
  allRows: SalesTransaction[];
  enrichments: SkuEnrichment[];
  setEnrichments: (enrichments: SkuEnrichment[]) => void;
}) {
  const data = productPerformance(rows);
  const topSkus = data.slice(0, 12);

  return (
    <section className="view-stack">
      <ChartCard title="Revenue by SKU Over Time">
        <RevenueArea data={timeSeries(rows, "month")} />
      </ChartCard>
      <div className="table-card">
        <h2>Product Performance</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Description</th>
              <th>Class</th>
              <th>Revenue</th>
              <th>Qty</th>
              <th>Avg unit price</th>
              <th>Lines</th>
              <th>Top customers</th>
              <th>Top reps</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.description}</td>
                <td>{row.productClass || "Unassigned"}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{formatCurrency(row.averageUnitPrice)}</td>
                <td>{row.transactions.toLocaleString()}</td>
                <td>{row.topCustomers}</td>
                <td>{row.topReps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SkuEditor
        skus={topSkus.map((row) => row.sku)}
        allRows={allRows}
        enrichments={enrichments}
        setEnrichments={setEnrichments}
      />
    </section>
  );
}

function CustomerGeoView({ rows }: { rows: SalesTransaction[] }) {
  return (
    <section className="view-stack">
      <div className="dashboard-grid">
        <ChartCard title="Revenue by State">
          <RevenueBar data={topByRevenue(rows, "shippingState", 15)} nameKey="name" />
        </ChartCard>
        <ChartCard title="Customer Trend">
          <RevenueArea data={timeSeries(rows, "month")} />
        </ChartCard>
      </div>
      <div className="table-card">
        <h2>Top Customers</h2>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Revenue</th>
              <th>Quantity</th>
              <th>Line items</th>
            </tr>
          </thead>
          <tbody>
            {customerPerformance(rows).map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatNumber(row.quantity)}</td>
                <td>{row.transactions.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QualityView({
  rows,
  quality,
  sourceRange
}: {
  rows: SalesTransaction[];
  quality: ImportQualitySummary[];
  sourceRange?: { start: string; end: string };
}) {
  const duplicateCount = countDuplicateRows(rows);
  const missingReps = rows.filter((row) => !row.salesRepVendor).length;
  const missingClasses = rows.filter((row) => !row.productClass).length;
  const missingStates = rows.filter((row) => !row.shippingState).length;

  return (
    <section className="view-stack">
      <div className="kpi-grid compact">
        <Kpi label="Imported files" value={quality.length.toLocaleString()} />
        <Kpi label="Source coverage" value={sourceRange ? `${sourceRange.start} to ${sourceRange.end}` : "n/a"} />
        <Kpi label="Possible duplicates" value={duplicateCount.toLocaleString()} />
        <Kpi label="Missing rep/vendor" value={missingReps.toLocaleString()} />
        <Kpi label="Missing class" value={missingClasses.toLocaleString()} />
        <Kpi label="Missing state" value={missingStates.toLocaleString()} />
      </div>
      <div className="table-card">
        <h2>Import Quality</h2>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Sheet</th>
              <th>Parsed rows</th>
              <th>Transactions</th>
              <th>Excluded totals</th>
              <th>Excluded groups</th>
              <th>Date coverage</th>
              <th>Revenue</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>
            {quality.map((item) => (
              <tr key={`${item.sourceFile}-${item.transactionCount}`}>
                <td>{item.sourceFile}</td>
                <td>{item.sourceReportType}</td>
                <td>{item.sourceSheetName ?? "n/a"}</td>
                <td>{item.parsedRowCount.toLocaleString()}</td>
                <td>{item.transactionCount.toLocaleString()}</td>
                <td>{item.excludedTotalRows.toLocaleString()}</td>
                <td>{item.excludedGroupRows.toLocaleString()}</td>
                <td>{item.dateRange ? `${item.dateRange.start} to ${item.dateRange.end}` : "n/a"}</td>
                <td>{formatCurrency(item.totalRevenue)}</td>
                <td>
                  {[
                    item.duplicateRowCount ? `${item.duplicateRowCount} duplicate-looking rows` : "",
                    item.missingSalesRepVendorCount ? `${item.missingSalesRepVendorCount} missing rep` : "",
                    item.missingProductClassCount ? `${item.missingProductClassCount} missing class` : "",
                    item.missingStateCount ? `${item.missingStateCount} missing state` : "",
                    ...item.parseErrors
                  ]
                    .filter(Boolean)
                    .join("; ") || "Clean"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MappingEditor({
  reps,
  mappings,
  setMappings
}: {
  reps: string[];
  mappings: SalesRepMapping[];
  setMappings: (mappings: SalesRepMapping[]) => void;
}) {
  function update(rep: string, patch: Partial<SalesRepMapping>) {
    const existing = mappings.find((mapping) => mapping.salesRepVendor === rep);
    const created: SalesRepMapping = { salesRepVendor: rep, salesEntityType: "Unknown", ...patch };
    const next = existing
      ? mappings.map((mapping) =>
          mapping.salesRepVendor === rep ? { ...mapping, ...patch } : mapping
        )
      : [...mappings, created];
    setMappings(next);
  }

  return (
    <div className="table-card">
      <h2>Rep / Vendor Mapping</h2>
      <table>
        <thead>
          <tr>
            <th>Rep / vendor</th>
            <th>Entity type</th>
            <th>Sales group</th>
            <th>Territory</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {reps.slice(0, 40).map((rep) => {
            const mapping = mappings.find((item) => item.salesRepVendor === rep);
            return (
              <tr key={rep}>
                <td>{rep}</td>
                <td>
                  <select
                    value={mapping?.salesEntityType ?? "Unknown"}
                    onChange={(event) =>
                      update(rep, { salesEntityType: event.target.value as SalesEntityType })
                    }
                  >
                    <option>Unknown</option>
                    <option>Salesperson</option>
                    <option>Distributor</option>
                    <option>Vendor</option>
                  </select>
                </td>
                <td>
                  <input value={mapping?.salesGroup ?? ""} onChange={(event) => update(rep, { salesGroup: event.target.value })} />
                </td>
                <td>
                  <input value={mapping?.territory ?? ""} onChange={(event) => update(rep, { territory: event.target.value })} />
                </td>
                <td>
                  <input value={mapping?.notes ?? ""} onChange={(event) => update(rep, { notes: event.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkuEditor({
  skus,
  allRows,
  enrichments,
  setEnrichments
}: {
  skus: string[];
  allRows: SalesTransaction[];
  enrichments: SkuEnrichment[];
  setEnrichments: (enrichments: SkuEnrichment[]) => void;
}) {
  function update(sku: string, patch: Partial<SkuEnrichment>) {
    const existing = enrichments.find((item) => item.sku === sku);
    const next = existing
      ? enrichments.map((item) => (item.sku === sku ? { ...item, ...patch } : item))
      : [...enrichments, { sku, ...patch }];
    setEnrichments(next);
  }

  return (
    <div className="table-card">
      <h2>SKU / Category Enrichment</h2>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Current description</th>
            <th>Product class / category</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {skus.map((sku) => {
            const enrichment = enrichments.find((item) => item.sku === sku);
            const description = allRows.find((row) => row.sku === sku)?.productDescription ?? "";
            return (
              <tr key={sku}>
                <td>{sku}</td>
                <td>{description}</td>
                <td>
                  <input
                    value={enrichment?.productClass ?? ""}
                    onChange={(event) => update(sku, { productClass: event.target.value })}
                  />
                </td>
                <td>
                  <input value={enrichment?.notes ?? ""} onChange={(event) => update(sku, { notes: event.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function RevenueArea({ data }: { data: { period: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F7D6D" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#4F7D6D" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#DDE7E1" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: "#6F7775", fontSize: 12 }} />
        <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fill: "#6F7775", fontSize: 12 }} />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Area dataKey="revenue" stroke="#1F4F45" strokeWidth={3} fill="url(#revenueFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RevenueBar({
  data,
  nameKey = "period"
}: {
  data: { revenue: number; [key: string]: string | number | null }[];
  nameKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#DDE7E1" vertical={false} />
        <XAxis dataKey={nameKey} tick={{ fill: "#6F7775", fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={68} />
        <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} tick={{ fill: "#6F7775", fontSize: 12 }} />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill={chartColors[index % chartColors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function MultiSelect({
  label,
  values,
  options,
  onChange
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label>
      {label}
      <select
        multiple
        value={values}
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
        }
      >
        {options.slice(0, 300).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NavButton({
  icon,
  id,
  active,
  onClick,
  children
}: {
  icon: React.ReactNode;
  id: string;
  active: string;
  onClick: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button className={active === id ? "active" : ""} onClick={() => onClick(id)}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function SoftEmpty({ text }: { text: string }) {
  return <div className="soft-empty">{text}</div>;
}

function grainLabel(grain: "month" | "quarter" | "year") {
  return grain === "month" ? "Month-over-month" : grain === "quarter" ? "Quarter-over-quarter" : "Year-over-year";
}

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function combineQualityRanges(quality: ImportQualitySummary[]) {
  const dates = quality.flatMap((item) =>
    item.dateRange ? [item.dateRange.start, item.dateRange.end] : []
  );
  if (!dates.length) return undefined;
  const sorted = dates.sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}
