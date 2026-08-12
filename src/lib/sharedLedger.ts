import type { AutomatedImportJob, ImportLedger } from "../types";

export type SharedLedgerResult = {
  ledger: ImportLedger;
  stateVersion: number;
  updatedAt?: string | null;
  updatedByEmail?: string | null;
};

export type SharedLedgerSaveResult = Omit<SharedLedgerResult, "ledger">;

export function shouldUseSharedLedger() {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export async function loadSharedSalesLedger() {
  return requestSharedLedger<SharedLedgerResult>("/.netlify/functions/sales-ledger");
}

export async function saveSharedSalesLedger(
  ledger: ImportLedger,
  expectedVersion: number
): Promise<SharedLedgerSaveResult> {
  const compressedLedger = await compressJsonToBase64(ledger);
  return requestSharedLedger<SharedLedgerSaveResult>("/.netlify/functions/sales-ledger", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ledgerEncoding: "gzip-base64",
      compressedLedger,
      expectedVersion
    })
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

async function requestSharedLedger<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (payload.ledgerEncoding === "gzip-base64" && typeof payload.compressedLedger === "string") {
    payload.ledger = await decompressJsonFromBase64(payload.compressedLedger);
    delete payload.compressedLedger;
  }
  return payload as T;
}

export async function compressJsonToBase64(value: unknown) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser cannot compress shared sales data. Update the browser and retry.");
  }
  const source = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream("gzip"));
  return bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function decompressJsonFromBase64<T>(value: string): Promise<T> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open compressed shared sales data. Update the browser and retry.");
  }
  const stream = new Blob([base64ToBytes(value)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as T;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
