alter table users add column if not exists token_version integer not null default 0;

alter table wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('deposit', 'withdrawal', 'daily_reward', 'ledger_adjustment'));
alter table wallet_transactions add column if not exists adjustment_direction text;
alter table wallet_transactions drop constraint if exists wallet_transactions_adjustment_direction_check;
alter table wallet_transactions add constraint wallet_transactions_adjustment_direction_check
  check (adjustment_direction is null or adjustment_direction in ('credit', 'debit'));

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references users(id),
  target_user_id uuid references users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
