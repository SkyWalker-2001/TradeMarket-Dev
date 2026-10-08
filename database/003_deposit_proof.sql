alter table wallet_transactions
  add column if not exists proof_image_data_url text;
