create table if not exists custom_charge_logs (
  id uuid default gen_random_uuid() primary key,
  charge_id uuid references custom_charges(id) on delete set null,
  reference_code text not null,
  admin_id uuid references users(id) on delete set null,
  action text not null check (action in ('created', 'paid', 'expired', 'cancelled', 'pix_generated', 'link_generated', 'payment_error', 'status_check')),
  amount numeric(10,2),
  payment_method text check (payment_method in ('pix', 'link')),
  status text,
  gateway_transaction_id text,
  gateway_response jsonb,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamp with time zone default now()
);

create index if not exists idx_custom_charge_logs_charge_id on custom_charge_logs(charge_id);
create index if not exists idx_custom_charge_logs_reference_code on custom_charge_logs(reference_code);
create index if not exists idx_custom_charge_logs_admin_id on custom_charge_logs(admin_id);
create index if not exists idx_custom_charge_logs_action on custom_charge_logs(action);
create index if not exists idx_custom_charge_logs_created_at on custom_charge_logs(created_at desc);

alter table custom_charge_logs enable row level security;

DO $$ BEGIN
  create policy "Admins can view all custom charge logs"
    on custom_charge_logs for select
    using (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  create policy "Service role can insert custom charge logs"
    on custom_charge_logs for insert
    with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  create policy "Admins can insert custom charge logs"
    on custom_charge_logs for insert
    with check (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
