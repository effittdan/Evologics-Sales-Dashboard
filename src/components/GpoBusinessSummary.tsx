import { formatCurrency, formatNumber, kpis, topByRevenue, type DashboardFilters } from "../lib/analytics";
import type { SalesTransaction } from "../types";

export function GpoBusinessSummary({ rows, filters, ready }: {
  rows: SalesTransaction[];
  filters: DashboardFilters;
  ready: boolean;
}) {
  if (!filters.nationalGpo.length && !filters.regionalPurchasingGroup.length) return null;
  if (!ready) return <section className="gpo-business-summary" role="status">Combined GPO business totals are unavailable until purchasing research loads.</section>;
  const totals = kpis(rows);
  const accounts = topByRevenue(rows, "customerName", Infinity);
  const metrics = [
    ["Combined net sales", formatCurrency(totals.revenue)],
    ["Net units", formatNumber(totals.quantity)],
    ["Accounts with business", formatNumber(totals.uniqueCustomers)],
    ["Sales lines", formatNumber(totals.transactionCount)]
  ];
  return <section className="gpo-business-summary" aria-label="Combined GPO business">
    <h2>Combined GPO business</h2>
    {filters.nationalGpo.length > 0 && <p><strong>National GPO:</strong> {filters.nationalGpo.join("; ")}</p>}
    {filters.regionalPurchasingGroup.length > 0 && <p><strong>Regional purchasing group:</strong> {filters.regionalPurchasingGroup.join("; ")}</p>}
    <p>Totals cover all matching accounts in the selected date range and current filters, including credits. Each sales line is counted once.
      {filters.nationalGpo.length > 0 && filters.regionalPurchasingGroup.length > 0 && " Accounts must match both a selected national GPO and a selected regional group."}
      {" "}Affiliations may be provisional; use verification status to narrow the evidence.</p>
    <div className="gpo-business-metrics">{metrics.map(([label, value]) =>
      <div className="kpi-card" key={label}><span>{label}</span><strong>{value}</strong></div>
    )}</div>
    {accounts.length ? <details>
      <summary>View all {accounts.length.toLocaleString()} account contributions</summary>
      <div className="gpo-business-table"><table>
        <thead><tr><th scope="col">Account</th><th scope="col">Net sales</th><th scope="col">Net units</th><th scope="col">Sales lines</th></tr></thead>
        <tbody>{accounts.map((account) => <tr key={account.name}>
          <td>{account.name}</td><td>{formatCurrency(account.revenue)}</td><td>{formatNumber(account.quantity)}</td><td>{formatNumber(account.transactions)}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Combined total</th><td>{formatCurrency(totals.revenue)}</td><td>{formatNumber(totals.quantity)}</td><td>{formatNumber(totals.transactionCount)}</td></tr></tfoot>
      </table></div>
    </details> : <p>No business matches the selected groups and current filters.</p>}
  </section>;
}
