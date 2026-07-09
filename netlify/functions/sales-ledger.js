const { createClient } = require("@supabase/supabase-js");

const approvedUsers = {
  "theresa@evologicsamerica.com": { roles: ["administrator"] },
  "dan@effitt.com": { roles: ["administrator"] },
  "wendy@evologicsamerica.com": { roles: ["administrator"] },
  "mike@evologicsamerica.com": { roles: ["user"] },
  "ryan@evologicsamerica.com": { roles: ["user"] },
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

exports.handler = async (event, context) => {
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
      .select("ledger, updated_at, updated_by_email")
      .eq("id", "global")
      .maybeSingle();

    if (error) return json(500, { message: error.message });
    return json(200, {
      ledger: normalizeLedger(data?.ledger),
      updatedAt: data?.updated_at ?? null,
      updatedByEmail: data?.updated_by_email ?? null
    });
  }

  const body = parseBody(event.body);
  const ledger = normalizeLedger(body?.ledger);
  if (!ledger) {
    return json(400, { message: "Request body must include a valid import ledger." });
  }

  const { data, error } = await supabase
    .from("sales_dashboard_state")
    .upsert(
      {
        id: "global",
        version: 1,
        ledger,
        updated_at: new Date().toISOString(),
        updated_by_email: user.email
      },
      { onConflict: "id" }
    )
    .select("updated_at, updated_by_email")
    .single();

  if (error) return json(500, { message: error.message });
  return json(200, {
    ledger,
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

function json(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}
