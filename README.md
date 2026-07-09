# Evologics Sales Dashboard

Source-agnostic sales analytics dashboard for Evologics NetSuite exports.

## What It Does

- Imports current NetSuite SpreadsheetML/XML `.xls` report exports in the browser.
- Includes adapters for future Saved Search CSV and XML exports.
- Normalizes all supported imports into a canonical `SalesTransaction` model.
- Runs dashboard filters, charts, KPI cards, tables, and quality warnings only from normalized transaction data.
- Keeps the MVP local-first with no backend required.
- Persists import history and accepted transactions in browser local storage.
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

## Import History And Duplicate Prevention

Import history is stored locally in the browser. Re-importing the exact same file is recorded in the quality ledger but contributes zero new transactions. Rows already accepted from earlier imports are skipped on later imports.

Duplicate-looking rows inside the same newly imported file are preserved because NetSuite can legitimately export separate line items that appear identical.

## Local Login Prototype

The dashboard includes a local sign-in panel and browser-stored user list for MVP workflow testing. Seeded users are split between `administrator` and `user` roles, and passwords are stored as browser-side hashes, not plaintext.

This is not production authentication. Before live company use, move users, password handling, sessions, roles, and audit logs to a server-backed identity provider or database.
