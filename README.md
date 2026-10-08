# Trade Market

Trade Market is a Dockerized application with a Next.js frontend, a Node.js/Express REST API, and PostgreSQL.

## Run locally

Requirements: Docker Desktop with Docker Compose.

```powershell
Copy-Item .env.example .env
# Set POSTGRES_PASSWORD, INITIAL_ADMIN_PASSWORD, and JWT_SECRET in .env.
docker compose up --build
```

Open `http://localhost:3000`. The API health endpoint is `http://localhost:4000/api/v1/health`. PostgreSQL data persists in the `postgres_data` volume. Stop services with `docker compose down`.

## Application areas

- `/` — public product and membership information
- `/auth` — registration and sign-in
- `/dashboard` — market samples, paper trading, wallet, memberships, reward claims, referrals, settings, and transaction history
- `/admin` — protected user, deposit, withdrawal, ledger, referral, and wallet configuration tools

Membership deposit requests use the configured USDT network (BEP20). Admins manually review deposits and withdrawal requests. Users can collect a reward equal to 0.1% of their confirmed membership deposit once every rolling 24 hours; collection immediately credits the earnings and available wallet balances. Reward and withdrawal decisions are recorded in the ledger; refusal explanations are stored with the transaction.

On first initialization of a new PostgreSQL data volume, `database/007_seed_initial_admin.sh` creates `INITIAL_ADMIN_EMAIL` as an administrator and hashes `INITIAL_ADMIN_PASSWORD` with PostgreSQL bcrypt support. Existing accounts are promoted to admin without resetting their password. This initialization script runs only when PostgreSQL creates a fresh data volume; do not delete a production volume to rerun it.

Market prices and paper trades are simulated sample data and do not place real market orders. Configure the receiving wallet under Admin → Wallet settings before accepting deposits.

## Database migrations

Fresh databases load SQL files from `database/` through the Compose initialization mounts. For an existing database, apply each migration that has not already been applied, in order. For the withdrawal profile and limits migration:

```powershell
Get-Content -Raw database/008_withdrawal_profiles_and_limits.sql | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U trademarket -d trademarket
```

The `postgres_data` volume preserves existing data across restarts. `docker compose down -v` deletes that data.

## Project structure

```text
apps/web/       Next.js frontend
apps/api/       Express REST API
database/       PostgreSQL schema and migrations
docker-compose.yml
```
