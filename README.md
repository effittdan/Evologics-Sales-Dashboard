# Evologics Sales Dashboard

Source-agnostic sales analytics dashboard for Evologics NetSuite exports.

## What It Does

- Imports current NetSuite SpreadsheetML/XML `.xls` report exports in the browser.
- Includes adapters for future Saved Search CSV and XML exports.
- Normalizes all supported imports into a canonical `SalesTransaction` model.
- Runs dashboard filters, charts, KPI cards, tables, and quality warnings only from normalized transaction data.
- Uses Netlify Identity for access and a Supabase-backed shared ledger for deployed sales data.
- Persists import history and accepted transactions in shared storage on the deployed site, with browser local storage as the localhost fallback.
- Prevents repeat imports by tracking file fingerprints and previously accepted transaction keys.
- Feeds the National Sales Map from the same normalized, filtered transactions without exposing the raw ledger publicly.

## Local Development

```powershell
npm install
npm run dev
```

Then open `http://127.0.0.1:5173/` or the port Vite prints.

## Checks

```powershell
npm test
npm run lint
npm run build
```

The real NetSuite exports are intentionally ignored by Git because they may contain customer and order data. Unit tests use safe synthetic SpreadsheetML fixtures, and they additionally validate the local real samples when those files exist on the developer machine.

## Shared Data, Import History, And Duplicate Prevention

On the deployed site, import history is stored in Supabase through the `sales-ledger` Netlify Function. Administrators can import or clear shared data. Viewer users can read the shared ledger and refresh it with **Sync**.

Localhost keeps using browser local storage so development still works without Supabase or Netlify Functions.

Re-importing the exact same file is recorded in the quality ledger but contributes zero new transactions. Rows already accepted from earlier imports are skipped on later imports.

Duplicate-looking rows inside the same newly imported file are preserved because NetSuite can legitimately export separate line items that appear identical.

## National Sales Map

The National Sales Map is an authenticated dashboard view backed by the active
`SalesTransaction` filter result. The dashboard aggregates transactions by
shipping state, product, and customer, then sends the summary to the standalone
map with a versioned `postMessage` contract.

The map receives no patient, physician, document-number, unit-price, or raw
transaction-line details. When the standalone map is opened outside the Sales
Analytics dashboard, it continues to show its committed snapshot instead of
requesting the private Supabase ledger.

Local map development defaults to `http://127.0.0.1:5176/`. Set
`VITE_SALES_MAP_URL` to override the embedded map URL.

## Authentication

The deployed dashboard uses Netlify Identity through `@netlify/identity`. Approved users are split between `administrator` and `user` roles. Netlify Identity stores production credentials; the app only keeps the approved access directory and current session mapping.

Localhost keeps a browser-only fallback so the dashboard can still be developed without Netlify Identity. The fallback stores password hashes, not plaintext.

Netlify setup checklist:

- Enable Identity for `https://evo-sales-dashboard.netlify.app/`.
- Set registration to invite-only.
- Invite the approved users through Netlify Identity, or have them accept Identity invites.
- Keep the `identity-validate` and `identity-signup` functions deployed so unapproved emails are rejected and approved roles are assigned.

## Supabase Shared Ledger Setup

The deployed shared ledger uses a Netlify Function with a server-only Supabase service role key. Do not expose the service role key in browser `VITE_` variables.

1. Create or choose a Supabase project.
2. Apply the migration in `supabase/migrations`.
3. Add these Netlify environment variables:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

The migration creates `public.sales_dashboard_state`, enables RLS, and revokes direct `anon`/`authenticated` table access. Browser users never talk to Supabase directly; they call `/.netlify/functions/sales-ledger`, which authorizes the Netlify Identity user first.


## Purchasing affiliation filters

National GPO, regional purchasing group, and verification status are separate global multiselect filters and are available in the header filter search. Multiple selections within a field use OR; fields combine with AND. Each transaction is counted once even when its account has several possible affiliations. Clear all resets these filters along with the existing filters. Existing view-specific behavior (including the independent New Accounts view) is unchanged.

The expandable purchasing evidence table follows the current filters and exposes sources, notes, and review dates. The initial 2026-09-17 research covers 167 customer names from local exports, not a reconciliation against the live ledger. Inferences, older evidence, transitions, and unresolved identities retain their research statuses. Category-only evidence is not promoted to a national GPO membership. Unknown is not a claim of no membership, and membership does not establish product contract eligibility.

Backfill `data/purchasing-affiliations.json`: retain exact exported customer names, list known shipping states, maintain separate `nationalGpo` and `regionalPurchasingGroup` arrays, and update `verificationStatus`, notes, `checked`, and source references. Empty affiliation arrays display Unknown. Names match ignoring case, whitespace, and an optional CUST code; known shipping states must match. Ambiguous entries, state mismatches, and new accounts remain Not researched. Do not add fuzzy aliases without identity evidence. Mapping updates enrich existing transactions at read time; no sales reimport or ledger schema migration is required. The file is intentionally gitignored. Upload approved backfills with `npx netlify-cli blobs:set purchasing-affiliations current --input data/purchasing-affiliations.json`. The site-scoped private store survives deployments; no code deployment is needed for research-only updates.

Production reads the mapping from the private, site-scoped Netlify Blobs store `purchasing-affiliations`, key `current`, and serves it through the approved-user-only `/api/purchasing-affiliations` Netlify function with no-store caching. Keep the approved account policy aligned with the existing authenticated endpoints. The mapping must never be imported into client code or copied into public/. Vite supplies the same endpoint only during local development. Fetch failures show an explicit retry message rather than claiming the research loaded.

Selecting a national or regional purchasing group also shows Combined GPO business: net sales, net units, accounts with business, and sales lines across all matching members. Expand account contributions to see every account and the combined total (not a top-N subset). Totals respect the date range and other active filters, include signed credits, and count each sales line once. When both national and regional fields are selected, accounts must match both fields. Provisional research remains subject to verification status.
