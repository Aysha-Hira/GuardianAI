#!/bin/bash
# One-time PostgreSQL setup for Guardian AI (Postgres.app on macOS).
# Creates a dedicated 'guardian' login + database, writes the connection URL and the
# watchlist encryption key to .env, installs the driver, and copies existing users over.
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="$(command -v psql || true)"
[ -z "$PSQL" ] && PSQL="/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
[ -x "$PSQL" ] || { echo "psql not found — is Postgres.app installed and running?"; exit 1; }
PY=".venv/bin/python"

touch .env
if grep -q '^GUARDIAN_DATABASE_URL=' .env; then
  echo "GUARDIAN_DATABASE_URL already in .env — keeping it."
else
  DB_PASS="$($PY -c 'import secrets; print(secrets.token_urlsafe(24))')"
  echo "Creating database user 'guardian' and database 'guardian' ..."
  "$PSQL" -h localhost -d postgres -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'guardian') THEN
    CREATE ROLE guardian LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE guardian WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
  if ! "$PSQL" -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='guardian'" | grep -q 1; then
    "$PSQL" -h localhost -d postgres -q -c "CREATE DATABASE guardian OWNER guardian;"
  fi
  "$PSQL" -h localhost -d guardian -q -c "REVOKE ALL ON DATABASE guardian FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO guardian;"
  printf '\n# PostgreSQL (written by scripts/setup_postgres.sh)\nGUARDIAN_DATABASE_URL=postgresql+psycopg://guardian:%s@localhost:5432/guardian\n' "$DB_PASS" >> .env
  echo "Saved GUARDIAN_DATABASE_URL to .env"
fi

if grep -q '^GUARDIAN_DATA_KEY=' .env; then
  echo "GUARDIAN_DATA_KEY already in .env — keeping it."
else
  KEY="$($PY -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  printf '# Encrypts watchlist face photos/embeddings. Losing it = losing the watchlist. Never commit.\nGUARDIAN_DATA_KEY=%s\n' "$KEY" >> .env
  echo "Saved GUARDIAN_DATA_KEY to .env"
fi
chmod 600 .env

echo "Installing PostgreSQL driver ..."
"$PY" -m pip install -q "psycopg[binary]>=3.2"

"$PY" scripts/migrate_to_postgres.py
echo
echo "All set. Start the backend as usual — it should print: [Guardian DB] Using PostgreSQL"
