create table if not exists public.sales_import_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'microsoft_graph',
  external_message_id text,
  internet_message_id text,
  attachment_name text not null,
  attachment_fingerprint text not null,
  sender_email text,
  subject text,
  received_at timestamp with time zone,
  status text not null check (
    status in ('processing', 'imported', 'duplicate', 'review_required', 'failed')
  ),
  parsed_row_count integer not null default 0,
  accepted_transaction_count integer not null default 0,
  skipped_duplicate_rows integer not null default 0,
  total_revenue numeric(14, 2) not null default 0,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  unique (source, attachment_fingerprint)
);

create index if not exists sales_import_jobs_created_at_idx
  on public.sales_import_jobs (created_at desc);

create index if not exists sales_import_jobs_status_idx
  on public.sales_import_jobs (status, created_at desc);

alter table public.sales_import_jobs enable row level security;

revoke all on table public.sales_import_jobs from public;
revoke all on table public.sales_import_jobs from anon;
revoke all on table public.sales_import_jobs from authenticated;
grant select, insert, update on table public.sales_import_jobs to service_role;

comment on table public.sales_import_jobs is
  'Audit trail for automated and manual sales imports. Access is limited to server-side service-role clients.';

create or replace function public.replace_sales_dashboard_ledger(
  p_expected_version integer,
  p_ledger jsonb,
  p_updated_by_email text
)
returns table (
  state_version integer,
  ledger jsonb,
  updated_at timestamp with time zone,
  updated_by_email text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update public.sales_dashboard_state as state
  set
    version = state.version + 1,
    ledger = p_ledger,
    updated_at = now(),
    updated_by_email = p_updated_by_email
  where state.id = 'global'
    and state.version = p_expected_version
  returning state.version, state.ledger, state.updated_at, state.updated_by_email;
end;
$$;

create or replace function public.merge_sales_import_batch(
  p_expected_version integer,
  p_transactions jsonb,
  p_quality jsonb,
  p_file_fingerprint text,
  p_transaction_keys jsonb,
  p_updated_by_email text
)
returns table (
  state_version integer,
  ledger jsonb,
  updated_at timestamp with time zone,
  updated_by_email text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_transactions) <> 'array'
    or jsonb_typeof(p_quality) <> 'array'
    or jsonb_typeof(p_transaction_keys) <> 'array' then
    raise exception 'Sales import merge parameters must be JSON arrays.';
  end if;

  return query
  update public.sales_dashboard_state as state
  set
    version = state.version + 1,
    ledger = jsonb_build_object(
      'version', 1,
      'transactions', coalesce(state.ledger -> 'transactions', '[]'::jsonb) || p_transactions,
      'quality', coalesce(state.ledger -> 'quality', '[]'::jsonb) || p_quality,
      'importedFileFingerprints', (
        select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
        from (
          select distinct value
          from jsonb_array_elements_text(
            coalesce(state.ledger -> 'importedFileFingerprints', '[]'::jsonb)
            || jsonb_build_array(p_file_fingerprint)
          ) as fingerprints(value)
        ) as unique_fingerprints
      ),
      'importedTransactionKeys', (
        select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
        from (
          select distinct value
          from jsonb_array_elements_text(
            coalesce(state.ledger -> 'importedTransactionKeys', '[]'::jsonb)
            || p_transaction_keys
          ) as transaction_keys(value)
        ) as unique_transaction_keys
      )
    ),
    updated_at = now(),
    updated_by_email = p_updated_by_email
  where state.id = 'global'
    and state.version = p_expected_version
  returning state.version, state.ledger, state.updated_at, state.updated_by_email;
end;
$$;

revoke all on function public.replace_sales_dashboard_ledger(integer, jsonb, text) from public;
revoke all on function public.replace_sales_dashboard_ledger(integer, jsonb, text) from anon;
revoke all on function public.replace_sales_dashboard_ledger(integer, jsonb, text) from authenticated;
grant execute on function public.replace_sales_dashboard_ledger(integer, jsonb, text) to service_role;

revoke all on function public.merge_sales_import_batch(integer, jsonb, jsonb, text, jsonb, text) from public;
revoke all on function public.merge_sales_import_batch(integer, jsonb, jsonb, text, jsonb, text) from anon;
revoke all on function public.merge_sales_import_batch(integer, jsonb, jsonb, text, jsonb, text) from authenticated;
grant execute on function public.merge_sales_import_batch(integer, jsonb, jsonb, text, jsonb, text) to service_role;
