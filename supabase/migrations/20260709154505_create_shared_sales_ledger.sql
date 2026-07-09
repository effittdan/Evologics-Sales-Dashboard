create table if not exists public.sales_dashboard_state (
  id text primary key,
  version integer not null default 1,
  ledger jsonb not null default jsonb_build_object(
    'version', 1,
    'transactions', jsonb_build_array(),
    'quality', jsonb_build_array(),
    'importedFileFingerprints', jsonb_build_array(),
    'importedTransactionKeys', jsonb_build_array()
  ),
  updated_at timestamp with time zone not null default now(),
  updated_by_email text
);

alter table public.sales_dashboard_state enable row level security;

revoke all on table public.sales_dashboard_state from anon;
revoke all on table public.sales_dashboard_state from authenticated;

comment on table public.sales_dashboard_state is
  'Shared Evologics sales dashboard import ledger. Access is mediated by Netlify Functions using the Supabase service role.';
