#!/bin/sh
set -eu

: "${INITIAL_ADMIN_EMAIL:?INITIAL_ADMIN_EMAIL must be configured}"
: "${INITIAL_ADMIN_PASSWORD:?INITIAL_ADMIN_PASSWORD must be configured}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set initial_admin_email="$INITIAL_ADMIN_EMAIL" \
  --set initial_admin_password="$INITIAL_ADMIN_PASSWORD" <<'SQL'
insert into users (email, password_hash, display_name, role)
values (
  lower(:'initial_admin_email'),
  crypt(:'initial_admin_password', gen_salt('bf', 12)),
  'Trade Market Admin',
  'admin'
)
on conflict (email) do update set role = 'admin';
SQL
