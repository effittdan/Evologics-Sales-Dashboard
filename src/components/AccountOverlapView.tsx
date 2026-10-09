import { Download, FileSearch, FileUp, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency, formatNumber } from "../lib/analytics";
import {
  compareProspectAccounts,
  parseProspectAccountFile,
  type AccountOverlapMatch,
  type AccountOverlapStatus,
  type ProspectAccountParseResult
} from "../lib/accountOverlap";
import type { SalesTransaction } from "../types";

type StatusFilter = "all" | AccountOverlapStatus;

export function AccountOverlapView({
  rows,
  sourceUpdatedAt
}: {
  rows: SalesTransaction[];
  sourceUpdatedAt?: string | null;
}) {
  const [parsed, setParsed] = useState<ProspectAccountParseResult | null>(null);
  const [fileError, setFileError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => parsed ? compareProspectAccounts(parsed.rows, rows) : [],
    [parsed, rows]
  );
  const filteredMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return matches.filter((match) => {
      if (statusFilter !== "all" && match.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        match.prospect.soldToName,
        match.prospect.shipToName,
        match.prospect.shipToCode,
        match.prospect.shipToCity,
        match.prospect.shipToState,
        match.matchedCustomerName,
        match.matchedCustomerCode,
        match.salesRepVendors.join(" "),
        match.productFamilies.join(" ")
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [matches, query, statusFilter]);

  const overlapCount = matches.filter((match) => match.status === "sales-overlap").length;
  const possibleCount = matches.filter((match) => match.status === "possible-overlap").length;
  const noSalesCount = matches.filter((match) => match.status === "no-sales-found").length;
  const latestYear = rows.reduce(
    (year, row) => Math.max(year, Number(row.transactionDate.slice(0, 4)) || 0),
    0
  );

  async function importProspectFile(file?: File) {
    if (!file) return;
    setReadingFile(true);
    setFileError("");
    try {
      setParsed(await parseProspectAccountFile(file));
      setStatusFilter("all");
      setQuery("");
    } catch (error) {
      setParsed(null);
      setFileError(error instanceof Error ? error.message : "The account list could not be read.");
    } finally {
      setReadingFile(false);
    }
  }

  function resetReview() {
    setParsed(null);
    setFileError("");
    setStatusFilter("all");
    setQuery("");
  }

  function exportResults() {
    const csvRows: Array<Array<string | number>> = [
      [
        "Source Rows",
        "Sold-To Name",
        "Ship-To Code",
        "Ship-To Name",
        "City",
        "State",
        "Review Result",
        "Evologics Customer",
        "Customer Code",
        `${latestYear || "Current Year"} Net Sales`,
        "Loaded Ledger Net Sales",
        "Last Sale",
        "Sales Rep / Vendor",
        "Product Families",
        "Match Basis"
      ],
      ...filteredMatches.map((match) => [
        match.prospect.sourceRowNumbers.join("; "),
        match.prospect.soldToName,
        match.prospect.shipToCode,
        match.prospect.shipToName,
        match.prospect.shipToCity,
        match.prospect.shipToState,
        statusLabel(match.status),
        match.matchedCustomerName ?? "",
        match.matchedCustomerCode ?? "",
        Math.round(match.currentYearRevenue),
        Math.round(match.revenue),
        match.lastSaleDate ?? "",
        match.salesRepVendors.join("; "),
        match.productFamilies.join("; "),
        match.matchReason
      ])
    ];
    downloadCsv(
      `${stripExtension(parsed?.sourceFile || "prospect-account-list")}-overlap-review.csv`,
      csvRows
    );
  }

  if (!parsed) {
    return (
      <section className="view-stack overlap-review">
        <div className="overlap-intro">
          <div>
            <p className="eyebrow">Pre-onboarding account check</p>
            <h2>Prospect Account Review</h2>
            <p className="subtle">
              Compare a prospective rep or distributor&apos;s current accounts with Evologics sales history before onboarding begins.
            </p>
          </div>
          <FileSearch size={40} aria-hidden="true" />
        </div>

        <div className="overlap-upload-panel">
          <div>
            <h3>Upload the prospect&apos;s current account list</h3>
            <p>
              Use an Excel `.xlsx` or `.csv` file with Sold-To and Ship-To names. The file remains in this browser and is not added to the shared sales ledger.
            </p>
          </div>
          <label className="upload-button overlap-upload-button">
            <FileUp size={18} />
            {readingFile ? "Reading file..." : "Choose account list"}
            <input
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              disabled={readingFile}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                void importProspectFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        <div className="overlap-rule-grid">
          <div><strong>Sales overlap</strong><span>Exact normalized facility match with sales in the loaded ledger.</span></div>
          <div><strong>Needs identity review</strong><span>A similar name or state conflict requires a person to confirm the account.</span></div>
          <div><strong>No matching sales</strong><span>No ledger match was found. Confirm the NetSuite customer directory before calling it new.</span></div>
        </div>
        {fileError ? <div className="status-strip error-strip">{fileError}</div> : null}
      </section>
    );
  }

  return (
    <section className="view-stack overlap-review">
      <div className="report-toolbar overlap-toolbar">
        <div className="overlap-source">
          <strong>{parsed.sourceFile}</strong>
          <span>
            {parsed.rawRowCount.toLocaleString()} source rows · {parsed.rows.length.toLocaleString()} review locations
            {sourceUpdatedAt ? ` · sales refreshed ${formatDateTime(sourceUpdatedAt)}` : ""}
          </span>
        </div>
        <button className="ghost-button" type="button" onClick={resetReview}>
          <RotateCcw size={18} />
          New review
        </button>
        <button className="upload-button" type="button" onClick={exportResults} disabled={!filteredMatches.length}>
          <Download size={18} />
          Export results
        </button>
      </div>

      <div className="overlap-intro compact">
        <div>
          <p className="eyebrow">Pre-onboarding account check</p>
          <h2>Prospect Account Review</h2>
          <p className="subtle">
            Results use the complete shared sales ledger and do not change account assignments or onboarding status.
          </p>
        </div>
      </div>

      <div className="overlap-caution">
        <strong>Interpretation</strong>
        <span>
          “No matching sales” means no customer-name match exists in the loaded transaction history. It does not prove that a zero-sales or inactive NetSuite customer record does not exist.
        </span>
      </div>
      {parsed.warnings.map((warning) => <div className="status-strip" key={warning}>{warning}</div>)}

      <div className="kpi-grid compact overlap-kpis">
        <OverlapKpi label="Review locations" value={matches.length} filter="all" active={statusFilter} onClick={setStatusFilter} />
        <OverlapKpi label="Sales overlap" value={overlapCount} filter="sales-overlap" active={statusFilter} onClick={setStatusFilter} />
        <OverlapKpi label="Needs identity review" value={possibleCount} filter="possible-overlap" active={statusFilter} onClick={setStatusFilter} />
        <OverlapKpi label="No matching sales" value={noSalesCount} filter="no-sales-found" active={statusFilter} onClick={setStatusFilter} />
      </div>

      <div className="overlap-controls">
        <label>
          Result
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All results</option>
            <option value="sales-overlap">Sales overlap</option>
            <option value="possible-overlap">Needs identity review</option>
            <option value="no-sales-found">No matching sales</option>
          </select>
        </label>
        <label className="overlap-search">
          Search review
          <span className="search-input-wrap">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Facility, state, rep, product..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>
        <span className="overlap-shown">{filteredMatches.length.toLocaleString()} shown</span>
      </div>

      <div className="table-card overlap-table">
        {!filteredMatches.length ? (
          <div className="soft-empty">No account-list rows match these review controls.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Prospect account</th>
                <th>Result</th>
                <th>Evologics match</th>
                <th>{latestYear || "Current year"} sales</th>
                <th>Last sale</th>
                <th>Sales rep / vendor</th>
                <th>Product family</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map((match) => (
                <OverlapRow key={matchKey(match)} match={match} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function OverlapKpi({
  label,
  value,
  filter,
  active,
  onClick
}: {
  label: string;
  value: number;
  filter: StatusFilter;
  active: StatusFilter;
  onClick: (filter: StatusFilter) => void;
}) {
  return (
    <button
      className={`kpi-card overlap-kpi-button ${filter === active ? "active" : ""}`}
      type="button"
      onClick={() => onClick(filter)}
      aria-pressed={filter === active}
    >
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </button>
  );
}

function OverlapRow({ match }: { match: AccountOverlapMatch }) {
  const prospectName = match.prospect.shipToName || match.prospect.soldToName;
  const soldToIsDifferent = match.prospect.soldToName
    && match.prospect.soldToName.toLowerCase() !== prospectName.toLowerCase();
  return (
    <tr>
      <td className="overlap-account-cell">
        <strong>{prospectName}</strong>
        <small>
          {[match.prospect.shipToCity, match.prospect.shipToState, match.prospect.shipToZip].filter(Boolean).join(", ") || "Location not supplied"}
        </small>
        {soldToIsDifferent ? <small>Sold-To: {match.prospect.soldToName}</small> : null}
        <small>
          {match.prospect.shipToCode ? `Source code ${match.prospect.shipToCode} · ` : ""}
          Row{match.prospect.sourceRowNumbers.length > 1 ? "s" : ""} {match.prospect.sourceRowNumbers.join(", ")}
        </small>
      </td>
      <td>
        <span className={`overlap-badge ${match.status}`}>{statusLabel(match.status)}</span>
        <small className="overlap-reason">{match.matchReason}</small>
      </td>
      <td>
        {match.matchedCustomerName ? <strong>{match.matchedCustomerName}</strong> : <span className="subtle">No ledger match</span>}
        {match.matchedCustomerCode ? <small>{match.matchedCustomerCode}</small> : null}
      </td>
      <td>
        {match.status === "no-sales-found" ? "—" : formatCurrency(match.currentYearRevenue)}
        {match.status !== "no-sales-found" ? <small>{formatCurrency(match.revenue)} loaded total · {formatNumber(match.transactions)} lines</small> : null}
      </td>
      <td>{match.lastSaleDate ? formatIsoDate(match.lastSaleDate) : "—"}</td>
      <td>{match.salesRepVendors.length ? <ValueList values={match.salesRepVendors} /> : "—"}</td>
      <td>{match.productFamilies.length ? <ValueList values={match.productFamilies} /> : "—"}</td>
    </tr>
  );
}

function ValueList({ values }: { values: string[] }) {
  const visible = values.slice(0, 3);
  return (
    <span className="overlap-value-list">
      {visible.join(", ")}
      {values.length > visible.length ? <small>+{values.length - visible.length} more</small> : null}
    </span>
  );
}

function statusLabel(status: AccountOverlapStatus) {
  if (status === "sales-overlap") return "Sales overlap";
  if (status === "possible-overlap") return "Needs identity review";
  return "No matching sales";
}

function matchKey(match: AccountOverlapMatch) {
  return [
    match.prospect.sourceRowNumbers.join("-"),
    match.prospect.soldToName,
    match.prospect.shipToCode,
    match.prospect.shipToName
  ].join("|");
}

function formatIsoDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "");
}

function downloadCsv(fileName: string, rows: Array<Array<string | number>>) {
  const text = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
