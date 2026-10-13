#!/usr/bin/env bash
# Runs add-comping-engine-tables.sql (twice, to prove it is re-runnable) and
# the budget-function checks in scripts/test-sql.sql against a throwaway
# local Postgres. Needs a local Postgres install; not required for deploys.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
DATA="$(mktemp -d)"
trap 'su postgres -c "$PGBIN/pg_ctl -D $DATA stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
chown postgres "$DATA"
su postgres -c "$PGBIN/initdb -D $DATA -A trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $DATA -o '-p 55432 -k /tmp' -l $DATA/log start -w" >/dev/null
# Supabase-like roles so the REVOKE statements have targets.
psql -h /tmp -p 55432 -U postgres -q -c "create role anon; create role authenticated;"
psql -h /tmp -p 55432 -U postgres -v ON_ERROR_STOP=1 -q -f scripts/test-sql.sql

# Concurrency: 20 parallel sessions x 10 reservations against a $1 cap at
# $0.20/call. The row lock must allow exactly 5 — never more.
psql -h /tmp -p 55432 -U postgres -q -c "delete from rentcast_budget where month = '2030-01';"
for i in $(seq 1 20); do
  psql -h /tmp -p 55432 -U postgres -q -t -c "select count(*) filter (where allowed) from (select (reserve_rentcast_call('2030-01', 1, 0, 0, 0.20)).allowed from generate_series(1,10)) s;" >/dev/null &
done
wait
ROW=$(psql -h /tmp -p 55432 -U postgres -q -t -A -c "select calls || ' ' || spend_usd from rentcast_budget where month = '2030-01';")
if [ "$ROW" != "5 1.0000" ]; then echo "CONCURRENCY CHECK FAILED: $ROW"; exit 1; fi
echo "Concurrency check passed: 200 parallel reservations, exactly 5 allowed (\$1.00 cap)."
