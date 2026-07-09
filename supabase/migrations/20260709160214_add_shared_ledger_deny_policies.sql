create policy "No direct browser reads"
on public.sales_dashboard_state
for select
to anon, authenticated
using (false);

create policy "No direct browser inserts"
on public.sales_dashboard_state
for insert
to anon, authenticated
with check (false);

create policy "No direct browser updates"
on public.sales_dashboard_state
for update
to anon, authenticated
using (false)
with check (false);

create policy "No direct browser deletes"
on public.sales_dashboard_state
for delete
to anon, authenticated
using (false);
