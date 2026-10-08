drop index if exists wallet_transactions_daily_reward_unique;

create unique index if not exists wallet_transactions_one_pending_reward
  on wallet_transactions (user_id)
  where kind = 'daily_reward' and status = 'pending';
