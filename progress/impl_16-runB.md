baseline_commit: 4f5f5aa7fa15f9093ca22746622f7de2c1a68535

# impl 16 — Ambientes y release · Run B (scripts parametrizados + ledger + backup)

**Feature**: `16-ambientes-y-release` (in_progress, Puerta 1 aprobada).
**Chunk**: SOLO Run B (scripts `--env` con guarda de prod destino-aware + ledger `ops.applied_migrations`
+ `apply-all-migrations` + `backup-db` cifrable + `powersync-deploy --env` + migración `health_status`
+ `.gitignore backups/`). Runs A cerrado (`4f5f5aa`); Runs C–F NO se tocan.
**Baseline (Gate 2)**: `4f5f5aa7fa15f9093ca22746622f7de2c1a68535` (HEAD tras Run A; trabajamos sobre
`main`, sin feature-branch — el diff de Gate 2 se calcula desde este SHA).

## Reconciliación crítica sobre el as-built (leído ANTES de tocar)

1. **Numeración de la migración `health_status` (0124 → 0125).** La spec (design §5 + task B6) dice
   `0124_health_status.sql`, pero **`supabase/migrations/0124_audit_log.sql` YA existe** (spec 18, DONE,
   committeada antes de Run A). El "primer delta 0124+" del spec era un off-by-one: 0124 lo tomó spec 18
   en el mismo commit que speceó el bloque de ambientes. El siguiente número libre es **0125** →
   `supabase/migrations/0125_health_status.sql`. Reconciliado en design §5 + task B6 + requirements R7.2
   (nota). El contenido SQL es idéntico al del design; solo cambia el número.
2. **NO corro los scripts contra ninguna DB** (deploy/write gateado). Escribo scripts + unit-testeo la
   LÓGICA PURA extraída a `scripts/lib/*.mjs` (patrón `env-resolve.ts`/`app-env.ts`).
3. **Default DEV = cero cambio de comportamiento** en `apply-migration-mgmt.mjs` y `powersync-deploy.sh`:
   sin `--env`, el path es byte-idéntico al de hoy.

## Plan (tasks Run B)

- [x] **B1** — `scripts/lib/env-target.mjs` (puro): `resolveTarget(argv, env)` + guarda destino-aware (M5) + test.
- [x] **B2** — `scripts/apply-migration-mgmt.mjs`: acepta `--env {dev,prod}` vía `env-target`; default dev idéntico.
- [x] **B3** — `scripts/apply-all-migrations.mjs` (nuevo): bootstrap ledger + replay ordenado + diff-vs-ledger + `--backfill`. Lógica pura en `scripts/lib/ledger-plan.mjs` + test.
- [x] **B4** — `scripts/backup-db.mjs` (nuevo): `pg_dump` al pooler PROD, output fuera del tree, conn string por env. Lógica pura en `scripts/lib/backup-cmd.mjs` + test.
- [x] **B5** — `scripts/powersync-deploy.sh`: acepta `--env {dev,prod}` (default dev idéntico; prod guarda + config prod).
- [x] **B6** — `supabase/migrations/0125_health_status.sql` (nuevo, reconciliado de 0124): `public.health_status()` SECURITY DEFINER + REVOKE FROM PUBLIC/anon/authenticated + GRANT service_role.
- [x] **B7** — `.gitignore`: agrega `backups/`.

## Mapa R<n> → archivo:test (Run B)

| R | Cobertura |
|---|---|
| R5.1 | `scripts/lib/env-target.test.mjs` "(a) sin --env → dev" + `apply-migration-mgmt.mjs`/`powersync-deploy.sh` default dev |
| R5.2 | `env-target.test.mjs` "(b) --env prod sin confirm → ProdGuardError" |
| R5.3 | `env-target.test.mjs` "(c) --env prod + confirm → target prod ref correcto"; `apply-migration-mgmt.mjs` usa resolveTarget |
| R5.4 | `scripts/lib/ledger-plan.test.mjs` "orden por prefijo numérico"; `apply-all-migrations.mjs` |
| R5.5 | `ledger-plan.test.mjs` "migración en el ledger se saltea" |
| R5.6 | `ledger-plan.test.mjs` "--backfill registra sin ejecutar"; bootstrap `ops.applied_migrations` en `apply-all-migrations.mjs` |
| R5.7 | `scripts/lib/backup-cmd.test.mjs` "outPath rafaq-prod-<ISO>.sql.gz"; `backup-db.mjs` |
| R5.8 | `backup-cmd.test.mjs` "(a) sin SUPABASE_DB_URL_PROD → throw, sin archivo" |
| R5.9 | `scripts/powersync-deploy.sh` (`--env {dev,prod}`, default dev) — verif operativa (bash, sin unit) |
| R5.10 | `backup-cmd.test.mjs` "(d) output default fuera del repo"; `.gitignore backups/` (B7) |
| R5.11 | `backup-cmd.test.mjs` "(c) conn string NO en argv de pg_dump (por env)" |
| R5.12 | `env-target.test.mjs` "(e) --env dev pero ref dev == ref PROD → exige confirm igual" (destino-aware) |
| R5.13 | `env-target.test.mjs` "safeSummary/ProdGuardError no filtran token"; scripts no loguean Authorization (heredan patrón) |
| R7.2/R7.7/R6.4 | `supabase/migrations/0125_health_status.sql` (SD, prefijo 4 dígitos, REVOKE FROM PUBLIC/anon/authenticated, GRANT service_role) — verif por Edge suite en Run C |

(La verificación de red — aplicar a dev/prod, ledger real, pg_dump real — es deploy gateado, coordina el leader. Acá: solo lógica pura unit-testeada + typecheck.)

## Verificación local (implementer)

- `pnpm -C app typecheck` → **exit 0** (no toqué nada bajo `app/`; los scripts `.mjs` no entran al tsc del cliente).
- Unit triple nuevo (`env-target` + `ledger-plan` + `backup-cmd`) → **28/28 pass** (`node --test`, sin red, sin keys). Registrado en `run-tests.mjs` (corre siempre).
- `node --check` de los 3 scripts imperativos + los 3 módulos puros → OK. `bash -n powersync-deploy.sh` → OK.
- **Guard/abort paths ejercitados SIN red** (todos salen ANTES de cualquier fetch/spawn):
  - `apply-migration-mgmt.mjs` sin args → usage exit 2.
  - `apply-migration-mgmt.mjs --env prod` sin confirm → ProdGuard exit 2 (antes de fetch).
  - `apply-all-migrations.mjs --env prod` sin confirm → ProdGuard exit 2 (antes de mgmtQuery/bootstrap).
  - `backup-db.mjs` sin confirm → guarda destino-aware exit 2 (antes de spawn).
  - `backup-db.mjs` con confirm pero sin `SUPABASE_DB_URL_PROD` → R5.8 abort exit 2 (sin crear archivo/spawn).
- `git check-ignore backups/rafaq-prod-x.sql.gz` → **matchea (exit 0)** (B7).
- `check.mjs` completo (14 suites de red, default DEV) lo corre el **reviewer/Explore** (verify = read-only; no deployo).

## Autorrevisión adversarial (paso 8)

Pasada hostil buscando desviaciones/bugs/gaps; lo hallado quedó cerrado:

- **Default DEV byte-idéntico (R5.1, invariante)**: `apply-migration-mgmt.mjs` sin `--env` resuelve el
  MISMO endpoint (`https://api.supabase.com/v1/projects/<ref>/database/query`), MISMO body/headers, con
  `SUPABASE_PROJECT_REF`/`SUPABASE_ACCESS_TOKEN`. Único cambio: reordené las validaciones pre-vuelo
  (ahora falta-archivo antes de falta-ref) — ambas salen exit 2, el happy-path no cambia. `powersync-deploy.sh`
  sin `--env` = flujo idéntico (cp rafaq.yaml → validate → deploy); solo agrega sufijo cosmético al log.
- **Guarda destino-aware sin falso negativo (M5/R5.12)**: `--env prod` SIEMPRE exige confirm
  (independiente de refs); el path dev suma el trigger si `devRef ∈ knownProdRefs`. El único no-detectable
  es "devRef ES un ref de prod pero el sistema no tiene forma de saberlo" (sin lista) — inherente, el spec
  lo reconoce ("lista de refs conocidos"). `RAFAQ_CONFIRM_PROD` estricto `=== '1'` (fail-closed). Hoy
  `SUPABASE_PROJECT_REF_PROD` no existe → knownProdRefs vacío → cero falsos positivos en el setup dev-only.
- **No leak de secretos (L2/L4/R5.13)**: `ProdGuardError` solo carga el `ref` (no el token) — test lo
  asserta. `mgmtQuery` loguea solo el body de RESPUESTA (no el header `Authorization`). `backup-cmd`:
  `safeSummary` sin password/conn string (test), y la conn string va a pg_dump por libpq env vars, NUNCA
  en `pgDumpArgs` (test: sin `-d`/`--dbname`, password solo en `pgEnv.PGPASSWORD`).
- **Backup fail-closed (R5.8/R5.10)**: `buildBackupPlan` throws si falta la conn string ANTES de tocar el
  FS (aborta sin archivo); el script escribe a `.partial` y renombra al final, con `rmSync` del parcial en
  cualquier error (pg_dump exit≠0, gzip/write error, spawn ENOENT→exit 127). Output default fuera del tree
  (`~/.rafaq-backups`, test asserta `!startsWith(repoRoot)`) + `backups/` gitignoreado (red de contención).
- **`backup-db` guarda SIEMPRE (hardening consciente)**: como lee `SUPABASE_DB_URL_PROD` y exfiltra PII,
  exige `RAFAQ_CONFIRM_PROD=1` con o sin `--env` (más estricto que R5.2; alineado a M5). Documentado.
- **`powersync-deploy.sh --env prod` fail-closed**: aborta si falta `RAFAQ_CONFIRM_PROD=1` o si no existe
  `powersync/cli.prod.yaml` (se crea en F5) — imposible deployar prod-streams a la instancia dev por error.
  El swap de `cli.yaml` se restaura con `trap EXIT`; backup a `*.tmp` (ya gitignoreado). Path dev intacto.
- **Ledger idempotente (R5.4/R5.5/R5.6)**: `planMigrations` ordena por prefijo numérico (no lexicográfico
  ingenuo) y saltea las ya-registradas; `--backfill` marca `execute=false` (registra sin ejecutar). INSERT
  con `ON CONFLICT DO NOTHING` → re-runs seguros. Tradeoff apply+insert en 2 llamadas (no atómico)
  documentado (tool de ops supervisado, gateado).
- **`health_status()` (0125)**: `security definer set search_path=''`, referencia `ops.applied_migrations`
  fully-qualified, EXCEPTION `undefined_table OR invalid_schema_name` → `'unknown'` sin romper `ok:true`;
  `substring(... from '^\d{4}')` = solo prefijo (L1). REVOKE FROM PUBLIC **+** anon/authenticated + GRANT
  service_role (M1). SQL idéntico al design §5 (ya Gate-1-revisado); solo cambió el número de archivo.
- **`check.mjs` no rompe**: agrego una función nueva (0125, no aplicada aún — Run C) y un `run(...)` de
  units puros que pasan; no toco ningún test existente ni `app/`. Default DEV = cero cambio.

## Reconciliación de specs (paso 9)

- **`design.md`**: §5 renombrado a `0125_health_status.sql` + nota de reconciliación (off-by-one 0124→0125);
  §4 agrega nota as-built (3 módulos `scripts/lib/*.mjs`, hardening de `backup-db` guarda-siempre, apply+insert
  no atómico) + fila `powersync-deploy.sh` reescrita (swap `cli.prod.yaml` + trap + token prod); §Archivos
  suma `ledger-plan`/`backup-cmd` + `.test.mjs` + `0125` + `powersync/cli.prod.yaml` (Run F).
- **`requirements.md`**: nueva entrada en §Historial de refinamiento (2026-07-14) — numeración 0124→0125
  (R7.2/R6.4, ejemplo/convención sin cambio de comportamiento), hardening `backup-db` (R5.2/R5.12), mecanismo
  prod de `powersync-deploy.sh` (R5.9). Sin reescribir EARS (el *qué* no cambió).
- **`tasks.md`**: B1–B7 marcadas `[x]`; B5 con nota as-built; B6 renumerada a `0125` (+ explicación); C3
  (Run C, cross-ref) actualizada a `0125_health_status.sql` para no dejar un pointer roto. El símbolo `0124+`
  de R6.4/context/F6 (convención de "delta futuro = migración numerada") se deja intacto (no es el archivo health).
- **Sin contradicción código↔spec**: los nombres de archivo concretos apuntan al as-built (0125, 3 módulos lib).
</content>
</invoke>
