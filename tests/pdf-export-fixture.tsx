// Local manual regression fixture; not an application entry point or production auth bypass.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PdfExportButton } from '../src/components/PdfExportButton';
import '../src/styles.css';
createRoot(document.getElementById('test')!).render(<main style={{padding: 30}}>
  <h1>PDF export test — synthetic data only</h1>
  <PdfExportButton target=".overview-report" title="Evologics PDF regression test" />
  <section className="view-stack overview-report">
    <div className="overview-print-header print-only"><h1>Synthetic overview — 100 rows</h1><img src="/evologics-logo-wide.png" /></div>
    <div className="kpi-grid"><article className="kpi-card"><h2>Total revenue</h2><strong>$12,345.67</strong></article></div>
    <div className="recharts-wrapper" style={{height:220}}><svg width="600" height="200"><rect x="20" y="60" width="140" height="140" fill="#1f4f45"/><text x="200" y="100">Synthetic chart</text></svg></div>
    <section className="product-class-unit-report">
      <div className="product-class-print-header"><h1>EvoPatch synthetic SKU report</h1></div>
      <PdfExportButton target=".product-class-unit-report" title="Evologics product PDF test" />
      <div className="table-card"><table><thead><tr><th>SKU</th><th>Description</th><th>Units</th></tr></thead><tbody>
        {Array.from({length:100},(_,i)=><tr key={i}><td>TEST-{i+1}</td><td>Synthetic test product {i+1}</td><td>{i+1}</td></tr>)}
      </tbody></table></div>
    </section>
  </section>
</main>);
