alter table wallet_transactions drop constraint if exists wallet_transactions_status_check;
alter table wallet_transactions add constraint wallet_transactions_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'paid', 'cancel_requested', 'cancelled'));

alter table wallet_transactions add column if not exists request_reason text not null default '';
alter table wallet_transactions add column if not exists cancellation_reason text not null default '';
alter table wallet_transactions add column if not exists review_reason text not null default '';
alter table wallet_transactions add column if not exists cancellation_review_reason text not null default '';
