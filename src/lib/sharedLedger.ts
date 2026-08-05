import type { AutomatedImportJob, ImportLedger } from "../types";

export type SharedLedgerResult = {
  ledger: ImportLedger;
  stateVersion: number;
  updatedAt?: string | null;
  updatedByEmail?: string | null;
};

export function shouldUseSharedLedger() {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export async function loadSharedSalesLedger() {
  return requestSharedLedger("/.netlify/functions/sales-ledger");
}

export async function saveSharedSalesLedger(ledger: ImportLedger, expectedVersion: number) {
  return requestSharedLedger("/.netlify/functions/sales-ledger", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ledger, expectedVersion })
  });
}

export async function loadAutomatedImportHistory() {
  const response = await fetch("/api/sales-import-history", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Automated import history is unavailable.");
  return (Array.isArray(payload.jobs) ? payload.jobs : []) as AutomatedImportJob[];
}

async function requestSharedLedger(path: string, init?: RequestInit): Promise<SharedLedgerResult> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Shared sales storage is not available.");
  }
  return payload as SharedLedgerResult;
}
