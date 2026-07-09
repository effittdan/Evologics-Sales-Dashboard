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
