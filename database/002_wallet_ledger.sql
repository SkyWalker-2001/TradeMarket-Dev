create table if not exists platform_wallet_config (
  id smallint primary key default 1 check (id = 1),
  usdt_network text not null default '',
  deposit_address text not null default '',
  deposit_qr_data_url text not null default '',
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into platform_wallet_config (id) values (1) on conflict (id) do nothing;

alter table user_memberships add column if not exists deposit_amount numeric(20, 8) not null default 0;

create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdrawal', 'daily_reward')),
  tier_key text references membership_tiers(key),
  amount numeric(20, 8) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'paid')),
  tx_hash text not null default '',
  wallet_address text not null default '',
  note text not null default '',
  reward_day date,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null
);

create unique index if not exists wallet_transactions_tx_hash_unique
  on wallet_transactions (lower(tx_hash)) where tx_hash <> '';
create unique index if not exists wallet_transactions_one_pending_deposit
  on wallet_transactions (user_id) where kind = 'deposit' and status = 'pending';
create index if not exists wallet_transactions_user_created_idx
  on wallet_transactions (user_id, created_at desc);
create index if not exists wallet_transactions_review_idx
  on wallet_transactions (status, created_at) where status = 'pending';
alter table wallet_transactions add column if not exists reward_day date;
alter table wallet_transactions add column if not exists tier_key text references membership_tiers(key);
create unique index if not exists wallet_transactions_daily_reward_unique
  on wallet_transactions (user_id, reward_day) where kind = 'daily_reward';
