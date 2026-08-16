#!/usr/bin/env bash
# Deploy feature 24 (visor audit) al backend DEV: secret MITROPERO_STAFF_USER_IDS + Edge Function audit_query.
#   CÓMO:  bash scripts/deploy-24-dev.sh
# - Usa SUPABASE_ACCESS_TOKEN de .env.local (no imprime el token). SOLO DEV (ref hardcodeado + assert).
# - Busca los user_ids de staff (Raf + Facundo) por email en auth.users, setea el secret, deploya la EF.
# - NO toca la DB (no migración). SUPABASE_DB_URL lo auto-inyecta Supabase en las EFs.
set -uo pipefail
cd "$(dirname "$0")/.."

DEV_REF="xrhlxxdnfzvdnztacofj"
STAFF_EMAILS="'rravenna59@gmail.com','iamfadolf@gmail.com'"   # Raf + Facundo
TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | sed 's/^SUPABASE_ACCESS_TOKEN=//' | tr -d '\r"')
ENV_REF=$(grep '^SUPABASE_PROJECT_REF=' .env.local | sed 's/^SUPABASE_PROJECT_REF=//' | tr -d '\r"')
[ -n "$TOKEN" ] || { echo "FATAL: no SUPABASE_ACCESS_TOKEN en .env.local"; exit 1; }
[ "$ENV_REF" = "$DEV_REF" ] || { echo "FATAL: SUPABASE_PROJECT_REF ($ENV_REF) != DEV ($DEV_REF)"; exit 1; }
API="https://api.supabase.com/v1/projects/$DEV_REF/database/query"

echo "### 1. Buscando user_ids de staff por email (auth.users)"
RESP=$(node -e "console.log(JSON.stringify({query:\"select id, email from auth.users where email in ($STAFF_EMAILS) order by email\"}))" \
  | curl -s -X POST "$API" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @-)
echo "$RESP"
IDS=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const r=JSON.parse(s);if(!Array.isArray(r)){console.error('resp no es array');process.exit(0)}console.log(r.map(x=>x.id).join(','))}catch(e){process.exit(0)}})")
N=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const r=JSON.parse(s);console.log(Array.isArray(r)?r.length:0)}catch(e){console.log(0)}})")
echo "encontrados: $N  ids: $IDS"
[ -n "$IDS" ] || { echo "FATAL: no se encontraron user_ids de staff"; exit 1; }
[ "$N" = "2" ] || echo ">>> OJO: se esperaban 2 staff y se encontraron $N. Revisá antes de confiar en el allowlist."

echo ""; echo "### 2. Seteando secret MITROPERO_STAFF_USER_IDS"
SUPABASE_ACCESS_TOKEN="$TOKEN" npx --yes supabase@2 secrets set "MITROPERO_STAFF_USER_IDS=$IDS" --project-ref "$DEV_REF"

echo ""; echo "### 3. Deployando la Edge Function audit_query a DEV"
SUPABASE_ACCESS_TOKEN="$TOKEN" npx --yes supabase@2 functions deploy audit_query --project-ref "$DEV_REF"

echo ""; echo "### LISTO. Staff = los emails de arriba ($N). EF audit_query deployada."
echo "### Falta: hosting de la web en Cloudflare Pages (aparte) + smoke end-to-end (Raf loguea en el visor)."
