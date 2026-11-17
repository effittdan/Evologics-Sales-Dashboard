import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Overview} from '../src/App';
import {applyFilters,emptyFilters,kpis,type DashboardFilters} from '../src/lib/analytics';
import type {SalesTransaction} from '../src/types';
import '../src/styles.css';
const data:SalesTransaction[]=Array.from({length:24},(_,i)=>({
  customerName:'Synthetic hospital',customerRaw:'Synthetic hospital',sourceFile:'synthetic.csv',sourceReportType:'YTD',sourceRowNumber:i+1,
  transactionType:'Invoice',transactionDate:`2026-${i<12?'10':'11'}-10`,dateCreated:`2026-${i<12?'10':'11'}-10T12:00:00Z`,
  documentNumber:`TEST-${i}`,sku:`EAP-${i%3}`,productDescription:'Synthetic EvoPatch',quantity:1,unitPrice:100,revenue:100,
  isCreditMemo:false,productClass:'Amniotic Tissue : EvoPatch',salesCategory:'Direct Retail',salesRepVendor:'Synthetic rep',shippingState:'TX'
}));
function Fixture(){
 const [filters,setFilters]=useState<DashboardFilters>(emptyFilters);
 const rows=applyFilters(data,filters);
 return <main style={{padding:30}}><h1>Synthetic current-month regression</h1><label>Date range<select value={filters.datePreset} onChange={e=>setFilters({...filters,datePreset:e.target.value as DashboardFilters['datePreset']})}><option value="all">All dates</option><option value="month">Current month</option></select></label>
 <button onClick={()=>setFilters(emptyFilters)}>Clear all</button>
 <Overview rows={rows} productRows={rows} comparisonRows={data} metrics={kpis(rows)} filters={filters} dateBasis="transaction" comparisonAnchor="2026-11-10" />
 </main>;
}
createRoot(document.getElementById('test')!).render(<Fixture/>);
