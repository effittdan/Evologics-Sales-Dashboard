import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isNightlySalesMessage,
  isSupportedSalesAttachment,
  prepareAutomatedSalesImport,
  type GraphFileAttachment,
  type GraphSalesMessage,
  type PreparedAutomatedImport
} from "../../src/lib/automatedImport";
import { salesTransactionKey } from "../../src/lib/analytics";
import type { ImportLedger, ImportQualitySummary, SalesTransaction } from "../../src/types";

declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const graphBaseUrl = "https://graph.microsoft.com/v1.0";
const maximumAttachmentBytes = 5 * 1024 * 1024;
const maximumMessagePages = 5;
const automationIdentity = "microsoft-graph-automation";

export default async () => {
  const result = await runNightlySalesEmailImport();
  console.log("Nightly sales email import complete", result);
};

export const config = {
  schedule: "15 7-10 * * *"
};

export async function runNightlySalesEmailImport(
  now = new Date(),
  fetchImplementation: typeof fetch = fetch
) {
  const tenantId = requiredEnvironmentVariable("MS_GRAPH_TENANT_ID");
  const clientId = requiredEnvironmentVariable("MS_GRAPH_CLIENT_ID");
  const clientSecret = requiredEnvironmentVariable("MS_GRAPH_CLIENT_SECRET");
  const mailbox = requiredEnvironmentVariable("MS_GRAPH_MAILBOX");
  const supabaseUrl = requiredEnvironmentVariable("SUPABASE_URL");
  const supabaseServiceRoleKey = requiredEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const accessToken = await requestGraphAccessToken(
    tenantId,
    clientId,
    clientSecret,
    fetchImplementation
  );
  const messages = await listRecentMessages(mailbox, accessToken, now, fetchImplementation);
  const matchingMessages = messages.filter(isNightlySalesMessage);
  const summary = { messagesChecked: messages.length, messagesMatched: matchingMessages.length, imported: 0, duplicate: 0, reviewRequired: 0, failed: 0 };

  for (const message of matchingMessages) {
    const attachments = await listMessageAttachments(
      mailbox,
      message.id,
      accessToken,
      fetchImplementation
    );
    for (const attachment of attachments.filter(isSupportedSalesAttachment)) {
      try {
        if ((attachment.size ?? 0) > maximumAttachmentBytes) {
          throw new Error(`Attachment exceeds the ${maximumAttachmentBytes} byte import limit.`);
        }
        const text = await downloadAttachment(
          mailbox,
          message.id,
          attachment.id,
          accessToken,
          fetchImplementation
        );
        const importedAt = now.toISOString();
        const batchId = `graph-${message.id}-${attachment.id}`;
        const prepared = await prepareAutomatedSalesImport(
          attachment.name ?? "netsuite-sales-report.xls",
          text,
          importedAt,
          batchId
        );
        const result = await processPreparedImport(supabase, message, attachment, prepared);
        summary[result.status] += 1;
      } catch (error) {
        summary.failed += 1;
        console.error("Nightly sales attachment failed", {
          messageId: message.id,
          attachmentId: attachment.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return summary;
}

async function processPreparedImport(
  supabase: SupabaseClient,
  message: GraphSalesMessage,
  attachment: GraphFileAttachment,
  prepared: PreparedAutomatedImport
): Promise<{ status: "imported" | "duplicate" | "reviewRequired" }> {
  const job = await startImportJob(supabase, message, attachment, prepared);
  if (job.skip) return { status: statusForExistingJob(job.status) };

  try {
    if (prepared.reviewReasons.length) {
      await finishImportJob(supabase, job.id, {
        status: "review_required",
        prepared,
        reviewReasons: prepared.reviewReasons
      });
      return { status: "reviewRequired" };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await loadSharedLedgerState(supabase);
      if (state.ledger.importedFileFingerprints.includes(prepared.fileFingerprint)) {
        await finishImportJob(supabase, job.id, { status: "duplicate", prepared });
        return { status: "duplicate" };
      }

      const existingKeys = new Set(state.ledger.importedTransactionKeys);
      const accepted = prepared.transactions.filter(
        (transaction) => !existingKeys.has(salesTransactionKey(transaction))
      );
      const skippedDuplicateRows = prepared.transactions.length - accepted.length;
      if (!accepted.length) {
        await finishImportJob(supabase, job.id, {
          status: "duplicate",
          prepared,
          skippedDuplicateRows
        });
        return { status: "duplicate" };
      }

      const quality: ImportQualitySummary = {
        ...prepared.quality,
        acceptedTransactionCount: accepted.length,
        skippedDuplicateRows
      };
      const { data, error } = await supabase
        .rpc("merge_sales_import_batch", {
          p_expected_version: state.version,
          p_transactions: accepted,
          p_quality: [quality],
          p_file_fingerprint: prepared.fileFingerprint,
          p_transaction_keys: accepted.map(salesTransactionKey),
          p_updated_by_email: automationIdentity
        })
        .maybeSingle();

      if (error) throw error;
      if (!data) continue;

      await finishImportJob(supabase, job.id, {
        status: "imported",
        prepared,
        accepted,
        skippedDuplicateRows
      });
      return { status: "imported" };
    }

    throw new Error("Shared sales data changed repeatedly while the automated import was merging.");
  } catch (error) {
    await failImportJob(supabase, job.id, error).catch((jobError) => {
      console.error("Unable to mark the automated import job as failed", jobError);
    });
    throw error;
  }
}

async function startImportJob(
  supabase: SupabaseClient,
  message: GraphSalesMessage,
  attachment: GraphFileAttachment,
  prepared: PreparedAutomatedImport
) {
  const { data: existing, error: lookupError } = await supabase
    .from("sales_import_jobs")
    .select("id, status")
    .eq("source", "microsoft_graph")
    .eq("attachment_fingerprint", prepared.fileFingerprint)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing && existing.status !== "failed") {
    return { id: existing.id as string, status: existing.status as string, skip: true };
  }

  const values = {
    source: "microsoft_graph",
    external_message_id: message.id,
    internet_message_id: message.internetMessageId ?? null,
    attachment_name: attachment.name ?? "netsuite-sales-report.xls",
    attachment_fingerprint: prepared.fileFingerprint,
    sender_email: message.from?.emailAddress?.address?.toLowerCase() ?? null,
    subject: message.subject ?? null,
    received_at: message.receivedDateTime ?? null,
    status: "processing",
    parsed_row_count: prepared.parsed.rows.length,
    error_message: null,
    completed_at: null,
    details: {
      sourceReportType: prepared.parsed.sourceReportType,
      sourceSheetName: prepared.parsed.sourceSheetName ?? null
    }
  };

  const query = existing
    ? supabase.from("sales_import_jobs").update(values).eq("id", existing.id)
    : supabase.from("sales_import_jobs").insert(values);
  const { data, error } = await query.select("id, status").single();
  if (error) {
    if (error.code === "23505") return { id: "", status: "duplicate", skip: true };
    throw error;
  }
  return { id: data.id as string, status: data.status as string, skip: false };
}

async function finishImportJob(
  supabase: SupabaseClient,
  jobId: string,
  options: {
    status: "imported" | "duplicate" | "review_required";
    prepared: PreparedAutomatedImport;
    accepted?: SalesTransaction[];
    skippedDuplicateRows?: number;
    reviewReasons?: string[];
  }
) {
  if (!jobId) return;
  const accepted = options.accepted ?? [];
  const { error } = await supabase
    .from("sales_import_jobs")
    .update({
      status: options.status,
      accepted_transaction_count: accepted.length,
      skipped_duplicate_rows: options.skippedDuplicateRows ?? 0,
      total_revenue: accepted.reduce((total, transaction) => total + transaction.revenue, 0),
      error_message: options.reviewReasons?.join("; ") ?? null,
      completed_at: new Date().toISOString(),
      details: {
        sourceReportType: options.prepared.parsed.sourceReportType,
        sourceSheetName: options.prepared.parsed.sourceSheetName ?? null,
        normalizedTransactionCount: options.prepared.transactions.length,
        reviewReasons: options.reviewReasons ?? []
      }
    })
    .eq("id", jobId);
  if (error) throw error;
}

async function failImportJob(supabase: SupabaseClient, jobId: string, error: unknown) {
  if (!jobId) return;
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabase
    .from("sales_import_jobs")
    .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
    .eq("id", jobId);
  if (updateError) throw updateError;
}

async function loadSharedLedgerState(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("sales_dashboard_state")
    .select("version, ledger")
    .eq("id", "global")
    .single();
  if (error) throw error;
  return { version: data.version as number, ledger: normalizeLedger(data.ledger) };
}

function normalizeLedger(value: unknown): ImportLedger {
  const ledger = value as Partial<ImportLedger> | null;
  return {
    version: 1,
    transactions: Array.isArray(ledger?.transactions) ? ledger.transactions : [],
    quality: Array.isArray(ledger?.quality) ? ledger.quality : [],
    importedFileFingerprints: Array.isArray(ledger?.importedFileFingerprints)
      ? ledger.importedFileFingerprints
      : [],
    importedTransactionKeys: Array.isArray(ledger?.importedTransactionKeys)
      ? ledger.importedTransactionKeys
      : []
  };
}

async function requestGraphAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  fetchImplementation: typeof fetch
) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetchImplementation(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Microsoft Graph token request failed.");
  }
  return payload.access_token as string;
}

export async function listRecentMessages(
  mailbox: string,
  accessToken: string,
  now: Date,
  fetchImplementation: typeof fetch
) {
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    "$select": "id,internetMessageId,subject,from,sender,receivedDateTime,hasAttachments",
    "$filter": `receivedDateTime ge ${since}`,
    "$orderby": "receivedDateTime desc",
    "$top": "100"
  });
  let nextUrl: string | undefined = `${graphBaseUrl}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?${params}`;
  const messages: GraphSalesMessage[] = [];

  for (let page = 0; nextUrl && page < maximumMessagePages; page += 1) {
    const payload = await fetchGraphJson(nextUrl, accessToken, fetchImplementation);
    if (Array.isArray(payload.value)) messages.push(...(payload.value as GraphSalesMessage[]));
    nextUrl = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : undefined;
  }

  return messages;
}

async function listMessageAttachments(
  mailbox: string,
  messageId: string,
  accessToken: string,
  fetchImplementation: typeof fetch
) {
  const url = `${graphBaseUrl}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`;
  const payload = await fetchGraphJson(url, accessToken, fetchImplementation);
  return Array.isArray(payload.value) ? (payload.value as GraphFileAttachment[]) : [];
}

async function downloadAttachment(
  mailbox: string,
  messageId: string,
  attachmentId: string,
  accessToken: string,
  fetchImplementation: typeof fetch
) {
  const url = `${graphBaseUrl}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
  const response = await fetchImplementation(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Microsoft Graph attachment download failed (${response.status}).`);
  return new TextDecoder("utf-8").decode(await response.arrayBuffer());
}

async function fetchGraphJson(
  url: string,
  accessToken: string,
  fetchImplementation: typeof fetch
) {
  const response = await fetchImplementation(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Microsoft Graph request failed (${response.status}).`);
  }
  return payload as { value?: unknown[]; "@odata.nextLink"?: string };
}

function requiredEnvironmentVariable(name: string) {
  const value = Netlify.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}.`);
  return value;
}

function statusForExistingJob(status: string) {
  if (status === "imported") return "duplicate" as const;
  if (status === "review_required") return "reviewRequired" as const;
  return "duplicate" as const;
}
