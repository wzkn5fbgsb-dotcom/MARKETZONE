#!/usr/bin/env bash
# Arranca el entorno local tipo Supabase: Postgres + Auth + PostgREST + pasarela.
# Requiere los binarios de Supabase Auth y PostgREST (rutas en MZ_AUTH_BIN / MZ_POSTGREST_BIN).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${MZ_STATE_DIR:-/home/claude/localstack}"
AUTH_BIN="${MZ_AUTH_BIN:-/home/claude/scratch/gotrue/auth}"
PGRST_BIN="${MZ_POSTGREST_BIN:-/home/claude/scratch/postgrest}"
SECRET="${MZ_JWT_SECRET:-local-dev-jwt-secret-with-at-least-32-characters}"
mkdir -p "$STATE/logs"

if ! pg_isready -h 127.0.0.1 -p 54322 -q; then
  runuser -u claude -- /usr/lib/postgresql/16/bin/pg_ctl -D "$STATE/pg" -l "$STATE/logs/pg.log" \
    -o "-p 54322 -k $STATE/sock -c listen_addresses=127.0.0.1" start >/dev/null
  sleep 2
fi

pkill -f "$AUTH_BIN serve" 2>/dev/null || true
pkill -f "$PGRST_BIN" 2>/dev/null || true
pkill -f "^bun .*localstack/gateway" 2>/dev/null || true
pkill -f "^python3 .*smtp-sink" 2>/dev/null || true
sleep 0.5

python3 "$ROOT/scripts/localstack/smtp-sink.py" "$STATE/mail" > "$STATE/logs/smtp.log" 2>&1 &

( set -a; . "$STATE/gotrue.env"; set +a; cd "$(dirname "$AUTH_BIN")"; nohup "$AUTH_BIN" serve > "$STATE/logs/auth.log" 2>&1 & )

cat > "$STATE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator-local@127.0.0.1:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 3000
db-pool = 20
CONF
nohup "$PGRST_BIN" "$STATE/postgrest.conf" > "$STATE/logs/postgrest.log" 2>&1 &
nohup bun "$ROOT/scripts/localstack/gateway.ts" > "$STATE/logs/gateway.log" 2>&1 &

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:54321/auth/v1/health >/dev/null 2>&1 && curl -sf http://127.0.0.1:3000/ >/dev/null 2>&1; then
    bun "$ROOT/scripts/localstack/keys.ts" > "$STATE/keys.json"
    echo "Entorno local listo: http://127.0.0.1:54321"
    exit 0
  fi
  sleep 0.5
done
echo "No arrancó a tiempo. Revisa $STATE/logs" >&2
exit 1
