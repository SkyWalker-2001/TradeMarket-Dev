create table if not exists user_wallet_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  payout_address text not null,
  payout_qr_data_url text not null,
  updated_at timestamptz not null default now(),
  constraint payout_address_length check (char_length(payout_address) between 8 and 200)
);

alter table wallet_transactions add column if not exists recipient_qr_data_url text;
alter table platform_wallet_config add column if not exists minimum_withdrawal numeric(20, 8) not null default 1;
alter table platform_wallet_config add column if not exists maximum_withdrawal numeric(20, 8) not null default 1000000;
