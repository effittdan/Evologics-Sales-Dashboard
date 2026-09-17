import type { SalesTransaction } from "../types";

export type AffiliationFilterKey = "nationalGpo" | "regionalPurchasingGroup" | "verificationStatus";
export type PurchasingAffiliation = {
  customerName: string;
  states: string[];
  nationalGpo: string[];
  regionalPurchasingGroup: string[];
  verificationStatus: string;
  system: string;
  notes: string;
  sourceIds: string[];
  checked: string;
};
export type PurchasingMapping = {
  checked: string;
  coverage: string;
  sources: Record<string, { title: string; url: string; date: string }>;
  rows: PurchasingAffiliation[];
};

function normalizeName(name: string) {
  return name.trim().replace(/^CUST\d+\s+/i, "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function enrichPurchasingAffiliations(rows: SalesTransaction[], mapping: PurchasingMapping | null) {
  const byName = new Map<string, PurchasingAffiliation[]>();
  for (const entry of mapping?.rows ?? []) {
    const key = normalizeName(entry.customerName);
    byName.set(key, [...(byName.get(key) ?? []), entry]);
  }
  return rows.map((row) => {
    const candidates = byName.get(normalizeName(row.customerName)) ?? [];
    const state = row.shippingState?.trim().toUpperCase();
    // Shipping state is a guard against mismatches, not proof of facility identity.
    const matches = candidates.filter((entry) => !entry.states.length || Boolean(state && entry.states.includes(state)));
    return { ...row, purchasingAffiliation: matches.length === 1 ? matches[0] : undefined };
  });
}

export function affiliationValues(row: SalesTransaction, key: AffiliationFilterKey): string[] {
  const affiliation = row.purchasingAffiliation;
  if (key === "verificationStatus") return [affiliation?.verificationStatus ?? "Not researched"];
  return affiliation?.[key].length ? affiliation[key] : ["Unknown"];
}

export function affiliationOptions(rows: SalesTransaction[], key: AffiliationFilterKey) {
  return [...new Set(rows.flatMap((row) => affiliationValues(row, key)))].sort((a, b) => a.localeCompare(b));
}

export async function loadPurchasingMapping(): Promise<PurchasingMapping> {
  const response = await fetch("/api/purchasing-affiliations", { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Purchasing affiliation research is unavailable. Retry to load the GPO filters.");
  const payload = await response.json();
  if (!Array.isArray(payload.rows) || !payload.sources || typeof payload.checked !== "string") {
    throw new Error("Purchasing affiliation research could not be read. Retry to load the GPO filters.");
  }
  return payload;
}
