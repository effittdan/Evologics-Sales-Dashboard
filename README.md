# Evologics Sales Dashboard

Source-agnostic sales analytics dashboard for Evologics NetSuite exports.

## What It Does

- Imports current NetSuite SpreadsheetML/XML `.xls` report exports in the browser.
- Includes adapters for future Saved Search CSV and XML exports.
- Normalizes all supported imports into a canonical `SalesTransaction` model.
- Runs dashboard filters, charts, KPI cards, tables, and quality warnings only from normalized transaction data.
- Keeps the MVP local-first with no backend required.

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
