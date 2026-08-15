#!/usr/bin/env bash
# Deploy feature 23 (request_id / operationId) al backend DEV: migración 0131 + las 9 Edge Functions.
#
# CÓMO CORRERLO (desde la raíz del repo):   ! bash scripts/deploy-23-dev.sh
#
# - Usa SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF de .env.local. NO imprime secretos.
# - SOLO DEV: el ref está hardcodeado (xrhlxxdnfzvdnztacofj) y aborta si .env.local apunta a otro lado.
# - Migración vía Management API (no hay DB password para `db push`). Idempotente: 0131 usa
#   `add column if not exists` / `create or replace` / `create index if not exists`, así que re-correrlo
#   no rompe. Si el smoke-check de 0131 falla, la migración aborta y el script NO deploya funciones.
set -uo pipefail
cd "$(dirname "$0")/.."

DEV_REF="xrhlxxdnfzvdnztacofj"
TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | sed 's/^SUPABASE_ACCESS_TOKEN=//' | tr -d '\r"')
ENV_REF=$(grep '^SUPABASE_PROJECT_REF=' .env.local | sed 's/^SUPABASE_PROJECT_REF=//' | tr -d '\r"')
[ -n "$TOKEN" ] || { echo "FATAL: no hay SUPABASE_ACCESS_TOKEN en .env.local"; exit 1; }
[ "$ENV_REF" = "$DEV_REF" ] || { echo "FATAL: SUPABASE_PROJECT_REF ($ENV_REF) != DEV ($DEV_REF). Abortando por seguridad."; exit 1; }

API="https://api.supabase.com/v1/projects/$DEV_REF/database/query"
run_sql()      { node -e "console.log(JSON.stringify({query: process.argv[1]}))" "$1"                              | curl -s -X POST "$API" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @-; echo; }
run_sql_file() { node -e "console.log(JSON.stringify({query: require('fs').readFileSync(process.argv[1],'utf8')}))" "$1" | curl -s -X POST "$API" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @-; }

echo "### 0. DB actual (debe decir postgres del proyecto DEV) + pre-check"
run_sql "select current_database() as db"
echo "-- ¿ya existe la columna request_id? (0 = no, esperado) --"
run_sql "select count(*) as ya_existe from information_schema.columns where table_schema='audit' and table_name='record_version' and column_name='request_id'"

echo ""; echo "### 1. Aplicando migración 0131 ..."
RESP=$(run_sql_file "supabase/migrations/0131_audit_request_id.sql")
echo "$RESP"
if echo "$RESP" | grep -qiE '"error"|"code":|failed|exception'; then
  echo ""; echo ">>> La migración devolvió ERROR (ver arriba). NO deployo funciones. Revisá y avisá."; exit 1
fi

echo ""; echo "### 2. Post-check migración"
echo "-- columna request_id (esperado: is_nullable=YES) --"
run_sql "select column_name, is_nullable from information_schema.columns where table_schema='audit' and table_name='record_version' and column_name='request_id'"
echo "-- ¿authenticated puede EXECUTE resolve_request_id? (esperado: false) --"
run_sql "select has_function_privilege('authenticated','audit.resolve_request_id()','EXECUTE') as authenticated_puede, has_function_privilege('anon','audit.resolve_request_id()','EXECUTE') as anon_puede"

echo ""; echo "### 3. Deployando las 9 Edge Functions a DEV ..."
SUPABASE_ACCESS_TOKEN="$TOKEN" npx --yes supabase@2 functions deploy --project-ref "$DEV_REF"

echo ""; echo "### LISTO. Chequeá arriba: request_id is_nullable=YES · authenticated/anon_puede=false · 9 funciones OK."
echo "### Después, desde el chat re-corro el E2E y consulto audit.record_version para ver el request_id aterrizado."
