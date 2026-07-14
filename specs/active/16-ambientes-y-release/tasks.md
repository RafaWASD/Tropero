# Spec 16 — Ambientes y release — Tasks

**Status**: spec_ready · **Fecha**: 2026-07-13
Requisitos: `requirements.md`. Diseño: `design.md`. El implementer marca `[x]` y registra el mapa
`R<n> → archivo:test` en `progress/impl_16-ambientes-y-release.md`.

> **Gate 1 (2026-07-13) reconciliado**: findings foldeados en las tasks (H1→B4/B7 + `.gitignore`;
> M1→B6/C4; M2→C1/E5; M3→D1/D3/F8; M4→E2/F3; M5→B1; L1→B6; L2→B4; L3→F3; L4→B3; hallazgo publication
> `FOR TABLES IN SCHEMA public`→F3). Detalle en `requirements.md` §Historial de refinamiento.

## Cómo leer estos runs (decomposición de una feature GRANDE)

Feature grande → se ejecuta en **runs** (como specs 02/03/08). Los runs se dividen en dos clases:

- 🟢 **BUILDABLE YA** (sin cuentas externas): Runs **A–E**. El implementer arranca por acá mientras las
  dependencias externas de Raf están pendientes. Todo con default DEV = cero cambio; `check.mjs` verde.
- 🔒 **GATED por dependencias externas de Raf** (cuentas/provisioning) + Gate 1 + OK de deploy: Run **F**.
  No es autónomo del implementer: son ops que ejecutan leader+Raf contra PROD (deploy a DB compartida /
  proyecto nuevo), en el orden operativo del `design.md` §Bring-up de PROD.

Dependencias externas que gatean Run F (context.md §Dependencias externas): (b) crear proyecto Supabase
PROD + provisionar PowerSync "Production" `6a260fd10ef84ed6719fd6bf`; (c) GitHub secret con conn string
de PROD; (d) cuenta UptimeRobot. (La dep (a) — log del build EAS — es de **Fase 0**, chore fuera de
esta spec.)

**Regla dura**: ningún task de Run A–E puede tocar PROD ni requerir `RAFAQ_CONFIRM_PROD`. Todo lo que
escribe a un ambiente real vive en Run F, gateado.

---

## 🟢 Run A — Config de app + env (100% buildable, sin cuentas)

> Es el run que "desbloquea" al implementer. No toca PROD. `check.mjs` y E2E deben quedar verdes.

- [x] **A1** — Migrar `app/app.json` → `app/app.config.ts` (TS) con `APP_VARIANT`: `development` →
  name "RAFAQ (Dev)" + `package`/`bundleIdentifier` `ar.rafq.app.dev`; caso contrario "RAFAQ" +
  `ar.rafq.app`. Preservar slug/scheme/version/icon/plugins/permissions/`eas.projectId`/`owner`.
  Cubre: R2.1, R2.2, R2.3, R2.4.
  **Verif**: assert de que `APP_VARIANT=development` produce name/ids `.dev` y el default produce
  `ar.rafq.app` (evaluar `app.config.ts` en node); typecheck verde.

- [x] **A2** — `Grep` de consumidores de `Constants.expoConfig.extra.supabaseUrl` (clave literal
  `supabaseUrl`) en `app/src`. Si no hay ninguno, eliminar `extra.supabaseUrl`; si hay, conservarlo y
  documentar el consumidor. Registrar el resultado del grep en `impl_16`. Cubre: R2.5.

- [x] **A3** — `app/src/utils/env-resolve.ts`: agregar `composeReader(staticMap, dynamicRead,
  extraRead)` puro (orden estático → dinámico → extra). **No tocar** `resolveEnv` ni su copy
  fail-closed. Cubre: R3.1, R3.2, R3.3.
  **Verif** (`env-resolve.test.ts`, ya en `run-tests.mjs`): (a) estático gana sobre dinámico y extra;
  (b) cae al dinámico si el estático está vacío; (c) cae a extra si ambos vacíos; (d) `resolveEnv`
  sigue tirando el mismo error en español si falta cualquiera de las 3.

- [x] **A4** — `app/src/utils/env.ts`: cablear el mapa STATIC (4 accesos literales
  `process.env.EXPO_PUBLIC_*`, incluida `EXPO_PUBLIC_ENV`) + `composeReader`. Cubre: R3.1, R3.2.

- [x] **A5** — `app/src/utils/app-env.ts` (nuevo, puro): `getAppEnv(): 'development'|'preview'|
  'production'|'e2e'` (default `development`) + `isE2E()` (flag `window.__RAFAQ_E2E__` **o**
  `EXPO_PUBLIC_ENV==='e2e'`) + export de `APP_E2E_GLOBAL_KEY`. Patrón de `ble-e2e-flag.ts`.
  Cubre: R3.4, R3.6, R3.7.
  **Verif** (`app-env.test.ts`, nuevo, registrar en `run-tests.mjs`): (a) sin marca ni env → `isE2E()`
  false y `getAppEnv()` `development`; (b) `EXPO_PUBLIC_ENV='e2e'` → `isE2E()` true; (c)
  `globalThis.__RAFAQ_E2E__=true` → `isE2E()` true; (d) valor fuera de dominio → default `development`.

- [x] **A6** — Extender `app/e2e/helpers/fixtures.ts` (fixture `page` **y** `applyEnvShim`): en el
  `addInitScript` setear además `process.env.EXPO_PUBLIC_ENV='e2e'` y `window.__RAFAQ_E2E__=true`. **No
  tocar** los ~70 specs. Cubre: R3.5.

- [x] **A7** — Registrar `app-env.test.ts` (y el resto de units nuevas) en `scripts/run-tests.mjs`.
  Correr `node scripts/check.mjs` (verde SIN cambios, DEV por diseño) + suite E2E completa verde.
  Cubre: R1.3, R3.5. **Nota**: `check.mjs`/E2E los corre el **reviewer/Explore** (read-only), no el
  implementer (memoria: verify = read-only).

---

## 🟢 Run B — Scripts parametrizados + ledger (buildable; default DEV, PROD gated)

> Los scripts quedan escritos y unit-testeados con default DEV. Ninguna ejecución contra PROD acá.

- [x] **B1** — `scripts/lib/env-target.mjs` (nuevo, puro): `resolveTarget(argv, env)` → sin `--env`
  devuelve `dev`; con `--env prod` exige `RAFAQ_CONFIRM_PROD=1` (si no, imprime el ref y sale con
  código ≠0). **Destino-aware (Gate 1 M5)**: si el ref resuelto para `dev` coincide con
  `SUPABASE_PROJECT_REF_PROD` (o ∈ lista de refs de PROD conocidos), tratar como PROD y exigir
  `RAFAQ_CONFIRM_PROD=1` igual. Cubre: R5.1, R5.2, R5.12.
  **Verif** (`env-target.test.ts`, registrar en `run-tests.mjs`): (a) sin `--env` → `dev`; (b)
  `--env prod` sin confirm → throw/exit; (c) `--env prod` + `RAFAQ_CONFIRM_PROD=1` → target prod con
  ref correcto; (d) `--env` inválido → error; (e) **`--env dev` (default) pero el ref de dev == ref de
  PROD → exige confirmación igual** (M5, destino-aware).

- [x] **B2** — `scripts/apply-migration-mgmt.mjs`: aceptar `--env {dev,prod}` vía `env-target.mjs`
  (selecciona `SUPABASE_PROJECT_REF`/`_PROD` + token). Default dev = comportamiento **idéntico** a hoy.
  Cubre: R5.1, R5.2, R5.3.

- [x] **B3** — `scripts/apply-all-migrations.mjs` (nuevo): bootstrap `ops.applied_migrations` (CREATE
  SCHEMA/TABLE IF NOT EXISTS + `REVOKE ... FROM PUBLIC, anon, authenticated`) → listar
  `supabase/migrations/*.sql` ordenado por filename → aplicar solo las **ausentes** del ledger
  (Management API `database/query`) → insertar en el ledger. Flags: `--env`, `--backfill` (registra sin
  ejecutar). Guarda de prod vía `env-target.mjs`. **No loguear** el header `Authorization`/token (L4,
  hereda el patrón de `apply-migration-mgmt.mjs`). Cubre: R5.4, R5.5, R5.6, R5.13, R6.1.
  **Verif** (unit puro de la lógica de orden + diff-contra-ledger, sin red): (a) orden por filename
  numérico; (b) una migración ya en el ledger se saltea; (c) `--backfill` no ejecuta SQL, solo inserta.

- [x] **B4** — `scripts/backup-db.mjs` (nuevo): `pg_dump` contra el pooler de PROD. **Output por default
  FUERA del working tree** (Gate 1 H1): `~/.rafaq-backups/rafaq-prod-<ISO>.sql.gz` (override con
  `--out-dir`). Conn string a `pg_dump` **por env** (`PGPASSWORD`/URI en env, no argv — L2). Aborta con
  error si falta la conn string, **sin** crear archivo parcial. Nunca loguea la conn string. Cubre: R5.7,
  R5.8, R5.10, R5.11.
  **Verif**: (a) sin `SUPABASE_DB_URL_PROD` → exit ≠0 y no crea archivo; (b) la conn string no aparece
  en stdout/stderr (assert sobre el output); (c) la conn string **no** aparece en la línea de comando de
  `pg_dump` (se pasa por env, L2); (d) el output default resuelve a una ruta fuera del repo.

- [x] **B5** — `scripts/powersync-deploy.sh`: aceptar `--env {dev,prod}` (default dev = idéntico a
  hoy; prod elige la config/instancia de PROD y exige la guarda). Cubre: R5.9.
  **As-built**: prod swappea el link de instancia por `powersync/cli.prod.yaml` (creado en Run F/F5) con
  `trap EXIT` que restaura; token `PS_ADMIN_TOKEN_PROD`→`PS_ADMIN_TOKEN`. Falla fail-closed si falta
  `cli.prod.yaml` (no puede deployar prod a la instancia dev por error).

- [x] **B6** — `supabase/migrations/0125_health_status.sql` (nuevo; **as-built 0125, no 0124** — 0124 lo
  tomó `0124_audit_log.sql` de spec 18, ver design §5): `public.health_status()`
  SECURITY DEFINER defensiva → `schema_version` = **prefijo numérico de 4 dígitos**
  (`substring(max(filename) from '^\d{4}')`, no el filename completo — Gate 1 L1), `unknown` si el
  ledger no existe. `REVOKE ALL ON FUNCTION public.health_status() FROM PUBLIC` **+** `FROM anon,
  authenticated` (Gate 1 M1 — sin `FROM PUBLIC` la función queda ejecutable como RPC público) **+**
  `GRANT EXECUTE ... TO service_role` (tras revocar PUBLIC, el caller real —la EF `health`— necesita
  EXECUTE explícito o el health rompe; anon/authenticated NO). Cubre: R7.2, R7.7, R6.4 (primer delta
  `0125` — as-built).
  **Nota**: aplicar a DEV es task de Run C (junto con la Edge suite); no rompe `check.mjs`.

- [x] **B7** — `.gitignore`: agregar `backups/` (Gate 1 H1 — red de contención aunque el output default
  vaya fuera del working tree). Cubre: R5.10.
  **Verif**: `git check-ignore backups/rafaq-prod-x.sql.gz` matchea (exit 0).

---

## 🟢 Run C — Edge Function `health` (buildable; deploy a DEV en este run, a PROD en Run F)

- [x] **C1** — `supabase/functions/health/index.ts` (nuevo): `createAdminClient().rpc('health_status')`
  → `{ ok, schema_version, env }` (schema_version = prefijo numérico, L1). Sin auth de usuario. **No lee
  body ni params** (input-free — Gate 1 M2/R7.9; corre con service_role). En fallo, `serverError` (copy
  genérico, sin driver msg). No expone datos de negocio/PII. Cubre: R7.1, R7.2, R7.3, R7.5, R7.9.
  **As-built**: reusa `_shared/{cors,errors,supabase}.ts` (handleOptions / jsonOk / serverError /
  createAdminClient); `data?.schema_version ?? 'unknown'` (hardening defensivo, espeja el `'unknown'` de
  la función DB). NO modifica `_shared/cors.ts` (shared por las 8 EFs).

- [x] **C2** — `supabase/config.toml`: agregar `[functions.health]` con `verify_jwt = false`.
  Cubre: R7.4. **As-built**: bloque insertado tras `[edge_runtime]`; el deploy remoto va además con
  `--no-verify-jwt` (config.toml aplica a `supabase start` local; el flag lo hace explícito en el remoto).

- [ ] **C3** — 🔒 GATEADO (leader + OK de deploy de Raf, NO lo ejecuta el implementer): aplicar
  `0125_health_status.sql` a **DEV** (`apply-migration-mgmt.mjs --env dev`; as-built 0125) + deploy de
  `health` a **DEV** (`supabase functions deploy health --no-verify-jwt`) + smoke `curl`. Pasos exactos en
  `progress/impl_16-runC.md` §"Qué queda para el deploy". Cubre: R7.6 (DEV).

- [x] **C4** — Test de la Edge suite para `health` (contra DEV), registrar hook en `run-tests.mjs`:
  (a) 200 con `ok:true` y `schema_version` `^\d{4}$|^unknown$`; (b) invocable **sin** header
  Authorization; (c) el body no trae claves fuera de `{ok,schema_version,env}` (no leak); (d) **`anon`
  NO puede ejecutar `POST /rest/v1/rpc/health_status` directo** (REVOKE FROM PUBLIC, Gate 1 M1). Cubre:
  R7.1, R7.4, R7.5, R7.7. **As-built**: suite dedicada `supabase/tests/health/run.cjs` (no folded en
  `edge/run.cjs`); hook en `run-tests.mjs` **COMENTADO** (⚠️ DESCOMENTAR post-deploy C3) para que
  `check.mjs` quede verde sin el deploy — patrón gateado de spec 12/14/M6/tratamientos/audit.

---

## 🟢 Run D — Backup automation (YAML buildable; secret + primera corrida en Run F)

- [ ] **D1** — `.github/workflows/backup-prod.yml` (para `RafaWASD/Tropero`): cron diario +
  `workflow_dispatch`; instala postgresql-client; `node scripts/backup-db.mjs --env prod --out-dir
  "$RUNNER_TEMP"` (H1 — fuera del tree) con `RAFAQ_CONFIRM_PROD=1` + `SUPABASE_DB_URL_PROD` desde
  `secrets`; **cifrar el dump** con `gpg --symmetric AES256` (passphrase en el secret
  `BACKUP_GPG_PASSPHRASE`, distinto del de la conn string — Gate 1 M3) → `upload-artifact` del
  `*.sql.gz.gpg` con retention 90 días; fail-fast (Action roja si `pg_dump` falla). Cubre: R8.1, R8.2,
  R8.3, R8.5, R8.6.
  **Invariante (L6)**: `RAFAQ_CONFIRM_PROD=1` solo en esta Action (read-only); nunca en un job que corra
  scripts de escritura.

- [ ] **D2** — Documentar el procedimiento de **restore drill** en `docs/runbook.md`
  (`gpg --decrypt` → `gunzip | psql` en un Postgres local + verificación de tablas clave). La
  **ejecución** del drill es Run F. Cubre: R8.4 (doc).

- [ ] **D3** — Documentar en el runbook la **postura de data-at-rest** del backup (Gate 1 M3/R8.7): el
  repo `RafaWASD/Tropero` debe ser **privado**; acceso a Actions/artifacts = acceso efectivo a la PII de
  PROD; el artifact va cifrado. Cubre: R8.7.

---

## 🟢 Run E — Runbook + docs de release (buildable now)

- [ ] **E1** — `docs/runbook.md` (1 página): refs/URLs de ambos ambientes (Supabase/PowerSync/Expo,
  con placeholders para PROD hasta Run F); comandos exactos de release OTA (`eas update` → sourcemaps →
  `--rollout-percentage` → `eas update:rollback`), migración a PROD, deploy functions/streams, restore.
  Cubre: R9.1, R9.2.

- [ ] **E2** — Runbook §checklist manual de setup de PROD: Auth/Resend/templates/redirects **+ postura
  internet-facing (Gate 1 M4/R6.6b)**: verificar `[auth.rate_limit]` del dashboard de PROD, captcha en
  signup, `enable_confirmations` (email) — firmar la decisión aunque sea "aceptar defaults". Secrets de
  Edge Functions. PowerSync rol de replicación + publication **`FOR TABLES IN SCHEMA public`** (no
  `FOR ALL TABLES`) + aserción `puballtables=false`. + tabla de rotación de secretos (service_role dev,
  access token, expo token, resend, PS admin, sentry, `BACKUP_GPG_PASSPHRASE`) con estado.
  Cubre: R9.3, R9.4, R6.6 (doc), R6.6b (doc), R6.7 (doc), R6.7b (doc).

- [ ] **E5** — Runbook §tabla de rate limits + data-at-rest (Gate 1 M2/M3/R9.10): fila del endpoint
  público `health` (postura adoptada: aceptar-y-documentar, query read-only trivial + monitor feature
  17) + fila de Auth de PROD (rate-limits nativos verificados) + postura de cifrado del artifact de
  backup. Cubre: R7.8, R9.10.

- [ ] **E3** — Runbook §release: template de log de incidentes de 5 líneas (qué pasó/causa/fix/
  prevención/fecha) + esquema de release notes semver atado a crash-free por versión + staged rollout
  gated por crash-free (< ~99.5% no amplía). Cubre: R9.5, R9.6, R9.7.

- [ ] **E4** — `.env.example` + `powersync/README.md`: documentar las vars `_PROD`
  (`SUPABASE_PROJECT_REF_PROD`, `SUPABASE_DB_URL_PROD`, instancia PowerSync Production) y el estado de
  la instancia "Production". Cubre: R1.2 (doc), R5.7 (doc).

---

## 🔒 Run F — Bring-up de PROD (GATED: deps externas de Raf + Gate 1 + OK de deploy)

> **No autónomo del implementer.** Ejecutan leader+Raf en el orden del `design.md` §Bring-up de PROD.
> Cada task que escribe a un ambiente real requiere Gate 1 PASS + Puerta 1 + OK de deploy de Raf.

- [ ] **F1** — 🔒(dep b) Raf crea el proyecto Supabase PROD (misma región que DEV) → cargar refs en
  `.env.local` (`_PROD`). Cubre: R1.2, R1.4.

- [ ] **F2** — Ensayar el replay contra un Postgres limpio (local/docker; o proyecto scratch si Docker
  bloqueado por ADR-012) → luego `apply-all-migrations.mjs --env prod` (replay ordenado a PROD).
  Cubre: R6.1, R6.2.

- [ ] **F3** — 🔒 Checklist manual de PROD (firmar en el runbook cada ítem):
  - Auth: SMTP/Resend, templates es-AR, Site URL/redirects **+ postura internet-facing (M4)**:
    `[auth.rate_limit]`, captcha en signup, `enable_confirmations`.
  - `supabase secrets set --project-ref <prod>` (incl. `RAFAQ_ENV=production` y `BACKUP_GPG_PASSPHRASE`
    donde corresponda).
  - PowerSync: rol de replicación + `CREATE PUBLICATION powersync FOR TABLES IN SCHEMA public;` (R6.7,
    PG15+; **no** `FOR ALL TABLES`) → **asertar** `puballtables=false` y set de tablas ⊆ DEV vía query a
    `pg_publication`/`pg_publication_tables` (R6.7b). **Nota de ownership**: la conversión de la
    publication de **DEV** (hoy `FOR ALL TABLES`) la owna feature 18 — acá NO se toca dev.
  Cubre: R6.6, R6.6b, R6.7, R6.7b.

- [ ] **F4** — Deploy de las **8** Edge Functions + `health` a PROD
  (`supabase functions deploy <fn> --project-ref <prod>`; `health` con `--no-verify-jwt`).
  Cubre: R7.6 (PROD).

- [ ] **F5** — 🔒(dep b) Provisionar PowerSync "Production" (conexión a DB PROD,
  `client_auth.supabase:true`) → `powersync-deploy.sh --env prod` con `sync-streams/rafaq.yaml` **sin
  tocar**. Cubre: R1.2, R5.9.

- [ ] **F6** — `pg_dump --schema-only` DEV vs PROD → diff. Cada delta → migración `0124+` aplicada a
  **ambos** (nunca fix manual en PROD). Cubre: R6.3, R6.4.

- [ ] **F7** — 🔒 Setear las EAS Environment Variables de `preview`/`production` apuntando a PROD
  (`eas env:create`); `development` a DEV. Verificar que un `eas update --environment preview` toma las
  de PROD. Cubre: R4.4, R4.5, R4.1, R4.2, R4.3.

- [ ] **F8** — 🔒(dep c) Cargar los GitHub secrets `SUPABASE_DB_URL_PROD` **y** `BACKUP_GPG_PASSPHRASE`
  (Gate 1 M3) en `RafaWASD/Tropero`; confirmar que el repo es **privado** (M3/R8.7) → disparar la Action
  (primera corrida) → verificar artifact cifrado (`*.sql.gz.gpg`). Cubre: R8.1, R8.2, R8.6, R8.7.

- [ ] **F9** — Ejecutar el **restore drill** una vez: descifrar (`gpg --decrypt`) el artifact → restaurar
  el backup de PROD en un Postgres local → firmar el resultado en el runbook. Cubre: R8.4.

- [ ] **F10** — 🔒(dep d) Configurar UptimeRobot: monitores sobre health PROD, health DEV y endpoint
  sync PowerSync PROD + alerta email. Documentar URLs en el runbook. Cubre: R9.8.

- [ ] **F11** — Crear en PROD el tenant "Campo de prueba RAFAQ" (para las pruebas diarias de Raf) y
  documentarlo en el runbook (insumo del filtro de observabilidad de feature 17). Cubre: R9.9.

- [ ] **F12** — Smoke manual en PROD: sign-up → crear campo → import de rodeo (feature 12) → maniobra
  offline→sync → invitación con Resend. Registrar en el runbook. Cubre: R6.5, R6.8.

- [ ] **F13** — Reconciliación de cierre: reflejar cualquier delta as-built (F2–F6, F12) en
  `requirements.md`/`design.md` antes de `done` (regla dura `docs/specs.md` §Reconciliación).

---

## Notas de orden

- **Arrancar por Run A** (desbloquea al implementer sin esperar cuentas). Runs A→E son independientes de
  las cuentas de Raf y se pueden cerrar en paralelo a que Raf provisiona PROD.
- **Run F** solo después de: Runs A–E cerrados + Gate 1 PASS + Puerta 1 aprobada + deps externas (b)(c)(d)
  disponibles + OK de deploy de Raf por cada escritura a un ambiente real.
- **`check.mjs` verde SIN cambios** es invariante de todos los runs A–E (default DEV; guarda de prod).
