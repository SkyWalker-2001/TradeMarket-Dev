create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  referral_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  created_at timestamptz not null default now()
);

create table if not exists paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null check (symbol in ('BTC', 'ETH', 'SOL', 'BNB')),
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(20, 8) not null check (quantity > 0),
  price numeric(20, 8) not null check (price > 0),
  created_at timestamptz not null default now()
);

create table if not exists membership_tiers (
  key text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_demo boolean not null default true
);

insert into membership_tiers (key, name, description, sort_order) values
  ('starter', 'Starter', 'Explore the market dashboard and paper trading tools.', 1),
  ('growth', 'Growth', 'Illustrative membership tier for product exploration.', 2),
  ('pro', 'Pro', 'Illustrative membership tier for product exploration.', 3)
on conflict (key) do nothing;

create table if not exists user_memberships (
  user_id uuid primary key references users(id) on delete cascade,
  tier_key text not null default 'starter' references membership_tiers(key),
  status text not null default 'demo' check (status in ('demo', 'active', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references users(id) on delete cascade,
  referred_user_id uuid unique references users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'joined')),
  created_at timestamptz not null default now(),
  check (referrer_id <> referred_user_id)
);

create table if not exists reward_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null,
  points integer not null default 0 check (points >= 0),
  status text not null default 'illustrative' check (status in ('illustrative', 'pending', 'awarded')),
  created_at timestamptz not null default now()
);

create index if not exists paper_trades_user_created_idx on paper_trades(user_id, created_at desc);
create index if not exists referrals_referrer_created_idx on referrals(referrer_id, created_at desc);
create index if not exists reward_events_user_created_idx on reward_events(user_id, created_at desc);
