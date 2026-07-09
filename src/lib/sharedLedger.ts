import type { ImportLedger } from "../types";

export type SharedLedgerResult = {
  ledger: ImportLedger;
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

export async function saveSharedSalesLedger(ledger: ImportLedger) {
  return requestSharedLedger("/.netlify/functions/sales-ledger", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ledger })
  });
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
