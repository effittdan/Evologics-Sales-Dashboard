import { getUser } from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";

declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const approvedEmails = new Set([
  "theresa@evologicsamerica.com",
  "dan@effitt.com",
  "wendy@evologicsamerica.com",
  "eda@evologicsamerica.com",
  "mike@evologicsamerica.com",
  "rgray@evologicsamerica.com",
  "jim@evologicsamerica.com",
  "sam@evologicsamerica.com"
]);

export default async (request: Request) => {
  if (request.method !== "GET") {
    return Response.json({ message: "Method not allowed." }, { status: 405 });
  }
  const user = await getUser();
  const email = user?.email?.trim().toLowerCase() ?? "";
  if (!approvedEmails.has(email)) {
    return Response.json(
      { message: "Sign in with an approved Evologics dashboard account." },
      { status: 401 }
    );
  }

  const supabaseUrl = Netlify.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ message: "Shared sales storage is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await supabase
    .from("sales_import_jobs")
    .select(
      "id, source, attachment_name, sender_email, subject, received_at, status, parsed_row_count, accepted_transaction_count, skipped_duplicate_rows, total_revenue, error_message, created_at, completed_at"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json(
    {
      jobs: (data ?? []).map((job) => ({
        id: job.id,
        source: job.source,
        attachmentName: job.attachment_name,
        senderEmail: job.sender_email,
        subject: job.subject,
        receivedAt: job.received_at,
        status: job.status,
        parsedRowCount: job.parsed_row_count,
        acceptedTransactionCount: job.accepted_transaction_count,
        skippedDuplicateRows: job.skipped_duplicate_rows,
        totalRevenue: Number(job.total_revenue ?? 0),
        errorMessage: job.error_message,
        createdAt: job.created_at,
        completedAt: job.completed_at
      }))
    },
    { headers: { "cache-control": "no-store" } }
  );
};

export const config = {
  path: "/api/sales-import-history"
};
