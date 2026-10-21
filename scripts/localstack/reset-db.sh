#!/usr/bin/env bash
# Reinicia el esquema public de la base local y aplica todas las migraciones.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGURL="${MZ_PG_URL:-postgres://postgres@127.0.0.1:54322/postgres}"
psql "$PGURL" -q -v ON_ERROR_STOP=1 <<'SQL'
set client_min_messages = warning;
drop trigger if exists on_auth_user_created on auth.users;
drop schema if exists public cascade;
create schema public authorization postgres;
grant all on schema public to postgres;
delete from auth.users;
drop policy if exists mz_storage_read_own on storage.objects;
drop policy if exists mz_storage_insert_own on storage.objects;
drop policy if exists mz_storage_update_own on storage.objects;
drop policy if exists mz_storage_delete_own on storage.objects;
delete from storage.objects;
delete from storage.buckets;
SQL
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/localstack/bootstrap.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$PGURL" -q -v ON_ERROR_STOP=1 -1 -f "$f" >/dev/null || { echo "FALLÓ: $f"; exit 1; }
done
psql "$PGURL" -q -c "notify pgrst, 'reload schema'" && sleep 0.5
echo "Migraciones aplicadas: $(ls "$ROOT"/supabase/migrations/*.sql | wc -l)"
