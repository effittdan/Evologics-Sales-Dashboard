import { createClient } from "@supabase/supabase-js";
import { gunzipSync, gzipSync } from "node:zlib";

const approvedUsers = {
  "theresa@evologicsamerica.com": { roles: ["administrator"] },
  "dan@effitt.com": { roles: ["administrator"] },
  "wendy@evologicsamerica.com": { roles: ["administrator"] },
  "eda@evologicsamerica.com": { roles: ["user"] },
  "mike@evologicsamerica.com": { roles: ["user"] },
  "rgray@evologicsamerica.com": { roles: ["user"] },
  "jim@evologicsamerica.com": { roles: ["user"] },
  "sam@evologicsamerica.com": { roles: ["user"] }
};

const emptyLedger = {
  version: 1,
  transactions: [],
  quality: [],
  importedFileFingerprints: [],
  importedTransactionKeys: []
};

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json"
};

const ledgerEncoding = "gzip-base64";
const maxCompressedLedgerBytes = 12 * 1024 * 1024;
const maxLedgerBytes = 50 * 1024 * 1024;

export const handler = async (event, context) => {
  if (!["GET", "PUT"].includes(event.httpMethod)) {
    return json(405, { message: "Method not allowed." });
  }

  const user = authorizeNetlifyUser(context);
  if (!user) {
    return json(401, { message: "Sign in with an approved Evologics dashboard account." });
  }
  if (event.httpMethod === "PUT" && !user.roles.includes("administrator")) {
    return json(403, { message: "Only administrators can update shared sales data." });
  }

  const supabase = createSupabaseClient();
  if (!supabase) {
    return json(503, {
      message: "Shared Supabase storage is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    });
  }

  if (event.httpMethod === "GET") {
    const { data, error } = await supabase
      .from("sales_dashboard_state")
      .select("version, ledger, updated_at, updated_by_email")
      .eq("id", "global")
      .maybeSingle();

    if (error) return json(500, { message: error.message });
    return json(200, {
      ledgerEncoding,
      compressedLedger: compressLedger(normalizeLedger(data?.ledger)),
      stateVersion: data?.version ?? 1,
      updatedAt: data?.updated_at ?? null,
      updatedByEmail: data?.updated_by_email ?? null
    });
  }

  const body = parseBody(event.body);
  const ledger = normalizeLedger(parseLedger(body));
  if (!ledger) {
    return json(400, { message: "Request body must include a valid import ledger." });
  }
  if (!Number.isInteger(body?.expectedVersion)) {
    return json(400, { message: "Request body must include the expected shared-ledger version." });
  }

  const { data, error } = await supabase
    .rpc("replace_sales_dashboard_ledger", {
      p_expected_version: body.expectedVersion,
      p_ledger: ledger,
      p_updated_by_email: user.email
    })
    .maybeSingle();

  if (error) return json(500, { message: error.message });
  if (!data) {
    return json(409, {
      message: "Shared sales data changed during this update. Sync the latest data and retry the import."
    });
  }
  return json(200, {
    stateVersion: data.state_version,
    updatedAt: data.updated_at,
    updatedByEmail: data.updated_by_email
  });
};

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function authorizeNetlifyUser(context) {
  const identityUser = context.clientContext?.user;
  const email = String(identityUser?.email || "").trim().toLowerCase();
  const approvedUser = approvedUsers[email];
  if (!approvedUser) return null;

  const identityRoles = Array.isArray(identityUser?.app_metadata?.roles)
    ? identityUser.app_metadata.roles
    : [];
  const roles = [...new Set([...approvedUser.roles, ...identityRoles])];
  return { email, roles };
}

function normalizeLedger(value) {
  if (!value) return emptyLedger;
  if (value.version !== 1) return null;
  if (!Array.isArray(value.transactions)) return null;
  if (!Array.isArray(value.quality)) return null;
  if (!Array.isArray(value.importedFileFingerprints)) return null;
  if (!Array.isArray(value.importedTransactionKeys)) return null;
  return {
    version: 1,
    transactions: value.transactions,
    quality: value.quality,
    importedFileFingerprints: value.importedFileFingerprints,
    importedTransactionKeys: value.importedTransactionKeys
  };
}

function parseBody(rawBody) {
  try {
    return JSON.parse(rawBody || "{}");
  } catch {
    return null;
  }
}

function parseLedger(body) {
  if (body?.ledger) return body.ledger;
  if (body?.ledgerEncoding !== ledgerEncoding || typeof body?.compressedLedger !== "string") {
    return null;
  }
  try {
    const compressed = Buffer.from(body.compressedLedger, "base64");
    if (compressed.length > maxCompressedLedgerBytes) return null;
    return JSON.parse(gunzipSync(compressed, { maxOutputLength: maxLedgerBytes }).toString("utf8"));
  } catch {
    return null;
  }
}

function compressLedger(ledger) {
  return gzipSync(JSON.stringify(ledger)).toString("base64");
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}
