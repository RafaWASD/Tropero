baseline_commit: 6b07bcaee159d9763d38ecbb08946d61cb2c4ecd

# impl 16 — Ambientes y release · Run C (Edge Function `health`)

**Feature**: `16-ambientes-y-release` (in_progress, Puerta 1 aprobada).
**Chunk**: SOLO Run C (Edge Function `health` pública `verify_jwt=false` → `rpc('health_status')` → JSON
mínimo `{ok, schema_version, env}`; config.toml `[functions.health]`; test de la Edge suite `health`;
hook en `run-tests.mjs`). Runs A (`4f5f5aa`) + B (`6b07bca`) cerrados+committeados. Runs D–F NO se tocan.
**Baseline (Gate 2)**: `6b07bcaee159d9763d38ecbb08946d61cb2c4ecd` (HEAD tras Run B; trabajamos sobre
`main`, sin feature-branch — el diff de Gate 2 se calcula desde este SHA).

## Reconciliación crítica sobre el as-built (leído ANTES de tocar)

1. **Patrón de las EFs existentes (`supabase/functions/_shared/`)** — la EF `health` reusa:
   - `createAdminClient()` (`_shared/supabase.ts`): service_role desde `SUPABASE_URL` /
     `SUPABASE_SERVICE_ROLE_KEY` (env auto-inyectadas en el runtime deployado, server-only, NUNCA en el
     bundle). Sin `actorId` (no hay mutación auditable).
   - `handleOptions(req)` (`_shared/cors.ts`): preflight OPTIONS → 204. Reuso el `corsHeaders` compartido
     SIN tocarlo (es shared por las 8 EFs; modificarlo sería un cambio de contrato más amplio).
   - `jsonOk(data)` / `serverError(code, detail)` (`_shared/errors.ts`): `serverError` loguea el detalle
     server-side y devuelve copy genérico fijo ("Error interno, probá de nuevo.") SIN el `.message` del
     driver → cierra R7.3 (no filtra schema/driver msg). Reuso el patrón de spec 13.
2. **`0125_health_status.sql` (Run B, ya escrita)**: `public.health_status()` SECURITY DEFINER
   `set search_path=''` → `substring(max(filename) from '^\d{4}')` (prefijo 4 dígitos, L1) / `'unknown'`
   si el ledger no existe. REVOKE FROM PUBLIC + anon/authenticated + GRANT EXECUTE TO service_role (M1).
   La EF la invoca con service_role → tiene EXECUTE. `anon` NO (test C4(d)).
3. **NO deployo nada** (gateado, coordina el leader con OK de Raf): NO aplico `0125` a DEV, NO deployo la
   EF. Escribo el código + config + test. La verificación de red (smoke `curl` + Edge suite `health`
   contra DEV) queda para después del deploy → el hook de la suite `health` en `run-tests.mjs` va
   **COMENTADO** (patrón gateado de spec 12/14/M6/tratamientos/audit) para que `check.mjs` quede VERDE
   sin el deploy. El leader lo descomenta post-deploy.

## Plan (tasks Run C)

- [x] **C1** — `supabase/functions/health/index.ts` (nuevo): `createAdminClient().rpc('health_status')`
  → `{ok, schema_version, env}`. Input-free (no lee body/params, R7.9). Fallo → `serverError` (R7.3).
- [x] **C2** — `supabase/config.toml`: `[functions.health] verify_jwt = false` (R7.4).
- [~] **C3** — 🔒 GATEADO (leader + OK de Raf): aplicar `0125` a DEV + `supabase functions deploy health
  --no-verify-jwt` + smoke `curl`. NO lo ejecuto yo. Documentado abajo en §"Qué queda para el deploy".
- [x] **C4** — `supabase/tests/health/run.cjs` (nuevo) + hook COMENTADO en `run-tests.mjs` (se descomenta
  post-deploy). Tests (a) 200 ok:true + schema_version `^\d{4}$|^unknown$`; (b) sin Authorization; (c) body
  ⊆ `{ok,schema_version,env}` (no leak); (d) `anon` NO puede `rpc/health_status` directo.

## Mapa R<n> → archivo:test (Run C)

| R | Cobertura |
|---|---|
| R7.1 | `supabase/functions/health/index.ts` (`ok:true` cuando la RPC responde) + `supabase/tests/health/run.cjs` "C4(a)" |
| R7.2 | `health/index.ts` (`schema_version = data.schema_version`, prefijo 4 dígitos vía `health_status()`) + `health/run.cjs` "C4(a)" (regex `^\d{4}$|^unknown$`) |
| R7.3 | `health/index.ts` (`serverError('health_db'/'health_unexpected')`, copy genérico) — verif por `serverError` (spec 13 Edge suite ya cubre el no-leak del helper) |
| R7.4 | `supabase/config.toml` `[functions.health] verify_jwt=false` + `health/run.cjs` "C4(b)" (invocable sin Authorization) |
| R7.5 | `health/index.ts` (respuesta = solo `{ok,schema_version,env}`, sin datos/conteos/PII) + `health/run.cjs` "C4(c)" (keys ⊆ set + no-leak) |
| R7.7 | `0125_health_status.sql` (REVOKE FROM PUBLIC/anon/authenticated) + `health/run.cjs` "C4(d)" (anon no puede `rpc/health_status`) |
| R7.9 | `health/index.ts` (input-free: NO `req.json()` ni query params) — invariante estático (code review + comentario) |
| R7.6 (DEV) | 🔒 C3 gateado — deploy de la EF `health` a DEV (leader). Verif operativa post-deploy (Edge suite `health` + smoke curl). |

## Verificación local (implementer)

- `pnpm -C app typecheck` → **exit 0** (no toqué nada bajo `app/`; el `.ts` de la EF es Deno, no entra al
  tsc del cliente Expo — igual que las otras 8 EFs).
- `node --check supabase/tests/health/run.cjs` → OK (sintaxis del test suite).
- `node --check scripts/run-tests.mjs` → OK (hook agregado, comentado).
- **NO corro la Edge suite `health` ni el smoke curl**: la EF + `0125` NO están deployadas (gateado). El
  hook queda comentado → `check.mjs` (14 suites, default DEV) queda VERDE sin el deploy. El `check.mjs`
  completo lo corre el **reviewer/Explore** (verify = read-only).

## Qué queda para el deploy (C3 / R7.6 DEV) — GATEADO, lo ejecuta el LEADER con OK de Raf

1. Aplicar la migración a DEV:
   `node scripts/apply-migration-mgmt.mjs --env dev supabase/migrations/0125_health_status.sql`
   (crea `public.health_status()` + REVOKEs + GRANT service_role en el proyecto DEV `xrhlxxdnfzvdnztacofj`).
2. Deploy de la EF `health` a DEV (verify_jwt=false):
   `supabase functions deploy health --no-verify-jwt --project-ref xrhlxxdnfzvdnztacofj`
   (opcional: `supabase secrets set RAFAQ_ENV=development --project-ref <dev>` para que `env` no sea
   `'unknown'`; el test NO lo exige).
3. Smoke `curl` (público, sin auth):
   `curl -s https://xrhlxxdnfzvdnztacofj.supabase.co/functions/v1/health`
   → espera `{"ok":true,"schema_version":"01xx","env":"development|unknown"}` (200).
4. **Descomentar** el hook `run('Health EF suite (spec 16 Run C)', ...)` en `scripts/run-tests.mjs`
   (bloque marcado ⚠️ DESCOMENTAR) → `node scripts/check.mjs` debe quedar verde con la suite `health`
   corriendo contra DEV (patrón spec 12/14/M6/tratamientos/audit).

## Autorrevisión adversarial (paso 8)

Pasada hostil buscando desviaciones/bugs/gaps; lo hallado quedó cerrado:

- **Input-free (R7.9, invariante crítico del Gate 1 M2)**: el handler NO llama `req.json()` ni lee la
  query string. Solo pasa `req` a `handleOptions` (que lee `req.method`) y después lo ignora. Corre con
  service_role → cero input de usuario en el code-path privilegiado. Comentado explícitamente en el código
  como invariante a preservar. ✓
- **No leak (R7.5)**: la respuesta es literal `{ok, schema_version, env}`. `schema_version` viene de
  `health_status()` = prefijo de 4 dígitos (L1), NUNCA el filename completo. `env` = `RAFAQ_ENV`
  (development/production/unknown, no sensible). Sin conteos de filas, sin nombres de tabla, sin PII. El
  test C4(c) asserta keys ⊆ set + un blob-check anti-leak (animal/establishment/user/tenant/count/
  health_status/.sql/select/password/email). Verifiqué que ningún valor legítimo (schema_version 4 dígitos
  o 'unknown', env development/production/unknown, ok:true) matchea esos substrings → cero falso positivo.
- **Fail-closed en fallo (R7.3)**: ambos caminos de error (RPC `error` y excepción) → `serverError`, que
  loguea server-side y devuelve copy genérico fijo SIN el `.message` del driver (helper hardeneado +
  testeado por spec 13). El único caller es service_role; forzar un 5xx en `health` es impráctico (la RPC
  read-only casi no falla) → el design §6 NO exige un test de 5xx para health (se apoya en el helper ya
  cubierto). Mapeo consistente. ✓
- **REVOKE efectivo (R7.7/M1)**: `0125` (Run B) hace REVOKE FROM PUBLIC **+** anon/authenticated + GRANT
  service_role. La EF usa service_role → tiene EXECUTE. El test C4(d) prueba que `anon` (anon key como
  Bearer) NO puede `POST /rest/v1/rpc/health_status` (401/403/404, nunca 200). El 404 es ambiguo entre "no
  existe" (pre-deploy) y "existe pero revocada" (post-deploy) — invariante a esa ambigüedad, igual que
  delete_account Test 8; la suite solo corre post-deploy (gateado). ✓
- **`check.mjs` verde sin deploy (invariante de Runs A–E)**: el hook de la suite `health` va COMENTADO. La
  migración `0125` está escrita (Run B) pero NO aplicada; el bloque de `config.toml` solo afecta `supabase
  start` local; el nuevo `index.ts` no lo importa nada del path de check. No toqué `edge/run.cjs` ni ningún
  test existente ni `app/`. → cero cambio en las 14 suites. Confirmado: `pnpm typecheck` exit 0; `node
  --check` de la suite y de `run-tests.mjs` OK. ✓
- **CORS sin regresión**: reuso `corsHeaders`/`handleOptions` compartidos SIN tocarlos (modificar
  `_shared/cors.ts` afectaría las 8 EFs → cambio de contrato más amplio, fuera de scope). `Allow-Methods:
  POST, OPTIONS` no bloquea un GET/POST simple (solo importa para preflight); UptimeRobot no es browser →
  CORS irrelevante para el monitoreo. Footprint mínimo. ✓
- **Verify_jwt en dos capas (R7.4)**: `config.toml` (local) + `--no-verify-jwt` (remoto, documentado en
  §deploy). Cubierto en ambas. El test C4(b) prueba invocación sin JWT (POST sin headers → 200). ✓
- **Multi-tenant / offline-first**: N/A justificado — `health` es infra/ops, no toca `establishment_id`
  (no hay tenant data; solo lee metadata `ops.applied_migrations`) ni es una feature de carga offline
  (endpoint server-side). Sin hardcodeo de establishment_id. ✓
- **Shape de `data` de supabase-js `.rpc()`**: `health_status()` es `RETURNS json` → PostgREST devuelve el
  objeto JSON escalar → supabase-js lo entrega como `data` objeto (`{ok, schema_version}`), no array. Por
  eso `data.schema_version` es correcto; el `?.` es hardening extra (nunca null en el happy path porque la
  función hace `coalesce(v, 'unknown')`). ✓

## Reconciliación de specs (paso 9)

- **`design.md`**: §6 recibe una nota de reconciliación as-built (Run C): reuso de `_shared/*`, sin tocar
  `cors.ts`, `?? 'unknown'` defensivo, `config.toml` + `--no-verify-jwt` en dos capas, suite dedicada
  `supabase/tests/health/run.cjs` con hook comentado hasta el deploy, C3 gateado (no lo ejecuta el
  implementer). §Archivos suma `supabase/tests/health/run.cjs` a la lista de "Crear".
- **`requirements.md`**: nueva entrada en §Historial de refinamiento (2026-07-14, Run C) — R7.1/R7.2/R7.3/
  R7.5/R7.9 (EF as-built), R7.4 (verify_jwt en 2 capas), R7.6 (deploy gateado), R7.7 (test en suite
  dedicada con hook comentado). Aditivo, sin reescribir ningún EARS (el *qué* no cambió).
- **`tasks.md`**: C1/C2/C4 → `[x]` con notas as-built; C3 queda `[ ]` (gateado al leader, con puntero a
  §deploy de este archivo). Cross-refs a `0125_health_status.sql` intactos.
- **Sin contradicción código↔spec**: los nombres concretos (EF `health`, suite `health/run.cjs`, bloque
  `[functions.health]`, hook comentado) apuntan al as-built.
