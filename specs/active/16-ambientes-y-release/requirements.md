# Spec 16 — Ambientes y release (dev/prod + OTA) — Requirements

**Status**: spec_ready
**Fecha**: 2026-07-13
**Fuente de verdad**: `specs/active/16-ambientes-y-release/context.md` (Gate 0 aprobado por Raf, Puerta 0 2026-07-12) + plan aprobado `C:/Users/RAR20313/.claude/plans/quiero-planificar-la-implementacion-noble-journal.md` (Fases 1 y 5).

## Alcance

Materializar **2 backends** (DEV = proyecto Supabase actual `xrhlxxdnfzvdnztacofj` + PowerSync "Development"; PROD = proyecto Supabase nuevo y limpio + PowerSync "Production" `6a260fd10ef84ed6719fd6bf`) y **3 targets de app EAS** (`development`→DEV, `preview`/`production`→PROD), más las ops livianas de release (health, backup, runbook, UptimeRobot, staged rollout). Cubre las **Fases 1 y 5** del plan.

**Fuera de alcance** (no genera requirements acá): Fase 0 (diagnóstico del fallo de Gradle del build `68cc88d7` + re-aplicación de la config OTA de `expo-updates` sobre `main`) — es **chore PRE-SDD**; 3er backend "homo"; Supabase branching; PITR; CI de tests; limpieza de la contaminación de dev; Sentry/PostHog/audit log (**feature 17**). La config de `expo-updates` (plugin + `updates.url` + `runtimeVersion`) es **prerequisito de Fase 0**: esta spec agrega los `channel` de los profiles y asume que la config OTA de runtime la aporta Fase 0 (ver design §Dependencias).

## Notación

EARS estricto (`docs/specs.md`). "DEV" = ambiente de desarrollo/tests actual; "PROD" = ambiente de beta nuevo. Cada `R<n>` es verificable por ≥1 test (unitario, de config, de integración de Edge Function, o verificación operativa documentada — se indica en `design.md`/`tasks.md`).

---

## R1 — Dos backends y no-regresión de DEV

- **R1.1** El sistema deberá conservar el proyecto Supabase `xrhlxxdnfzvdnztacofj` y la instancia PowerSync "Development" como ambiente **DEV**, sin migrar sus datos ni reconfigurarlo.
- **R1.2** El sistema deberá disponer de un ambiente **PROD** compuesto por un proyecto Supabase nuevo (misma región que DEV) y la instancia PowerSync "Production" (`6a260fd10ef84ed6719fd6bf`).
- **R1.3** Mientras no se exporte `RAFAQ_CONFIRM_PROD`, `node scripts/check.mjs` deberá ejecutar las 14 suites contra **DEV** y quedar verde **sin cambios en el código de tests**.
- **R1.4** El sistema deberá mantener DEV y PROD como proyectos Supabase **separados** (distinto project ref), sin que ninguna operación de PROD pueda escribir en DEV ni viceversa.

## R2 — Config de la app: `app.config.ts` + `APP_VARIANT`

- **R2.1** El sistema deberá definir la configuración de Expo en `app/app.config.ts` (reemplazando `app/app.json`), preservando `name`/`slug`/`scheme`/`version`/`orientation`/`icon`/`plugins`/`permissions`/`eas.projectId`/`owner` actuales.
- **R2.2** Cuando `APP_VARIANT` valga `development`, el sistema deberá exponer el nombre visible **"RAFAQ (Dev)"** y el identificador de app **`ar.rafq.app.dev`** (Android `package` e iOS `bundleIdentifier`).
- **R2.3** Cuando `APP_VARIANT` no valga `development` (o esté ausente), el sistema deberá exponer el nombre **"RAFAQ"** y el identificador **`ar.rafq.app`**.
- **R2.4** El sistema deberá permitir que el target `development` (`ar.rafq.app.dev`) y el de producción (`ar.rafq.app`) coexistan instalados en el mismo dispositivo (identificadores distintos).
- **R2.5** Si algún módulo consume `Constants.expoConfig.extra.supabaseUrl`, entonces el sistema deberá conservar ese valor en `extra` hasta que ese consumidor haya sido migrado (grep de consumidores obligatorio antes de eliminarlo).

## R3 — `env.ts` con lecturas estáticas + `EXPO_PUBLIC_ENV` + shim E2E

- **R3.1** El sistema deberá leer cada variable pública mediante un acceso **ESTÁTICO literal** (`process.env.EXPO_PUBLIC_SUPABASE_URL`, `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY`, `process.env.EXPO_PUBLIC_POWERSYNC_URL`, `process.env.EXPO_PUBLIC_ENV`), uno por variable, para que `babel-preset-expo` lo inlinee en el build web.
- **R3.2** Si un acceso estático devuelve vacío, entonces el sistema deberá recurrir en orden al reader **dinámico** actual (`process.env[name]`) y luego a `Constants.expoConfig.extra`, antes de considerar la variable ausente.
- **R3.3** Mientras falte cualquiera de las tres variables requeridas (`supabaseUrl`, `supabaseAnonKey`, `powersyncUrl`), el sistema deberá lanzar el error accionable en español existente (fail-closed), **sin cambiar el copy**.
- **R3.4** El sistema deberá reconocer la variable `EXPO_PUBLIC_ENV` con dominio `{development, preview, production, e2e}` y default `development` cuando esté ausente.
- **R3.5** Cuando corra la suite E2E, el shim de `app/e2e/helpers/fixtures.ts` deberá inyectar `EXPO_PUBLIC_ENV='e2e'` además de las 3 variables actuales, **sin modificar los ~70 specs**.
- **R3.6** Cuando Playwright cargue el bundle, el sistema deberá exponer una función pura `isE2E()` que devuelva `true` si Playwright marcó `window.__RAFAQ_E2E__` antes del boot **o** si `EXPO_PUBLIC_ENV==='e2e'` (mismo patrón que `ble-e2e-flag.ts`).
- **R3.7** Si no existe la marca `window.__RAFAQ_E2E__` ni `EXPO_PUBLIC_ENV==='e2e'`, entonces `isE2E()` deberá devolver `false` (producción/dev normal).

## R4 — EAS: targets, canales y variables por ambiente

- **R4.1** El profile `development` de `app/eas.json` deberá resolver al backend **DEV**.
- **R4.2** Los profiles `preview` y `production` de `app/eas.json` deberán resolver al backend **PROD**.
- **R4.3** Cada profile deberá declarar su `channel` correspondiente (`development` / `preview` / `production`).
- **R4.4** El sistema deberá proveer las variables `EXPO_PUBLIC_*` y `EXPO_PUBLIC_ENV` por ambiente vía **EAS Environment Variables** (referenciadas por `environment` en cada profile), no embebidas en el bloque `env` inline del profile.
- **R4.5** Si se publica un OTA con `eas update`, entonces el sistema deberá tomar las variables del `--environment <env>` correspondiente y no del campo `env` del build profile (que no viaja a los updates).

## R5 — Scripts parametrizados con guarda de PROD + ledger + backup

- **R5.1** Si un script de ambiente se invoca **sin `--env`**, entonces el sistema deberá operar contra **DEV** (default = cero cambio respecto al comportamiento actual).
- **R5.2** Cuando un script de ambiente se invoque con `--env prod`, el sistema deberá imprimir el project ref/host destino y **abortar** salvo que `RAFAQ_CONFIRM_PROD=1` esté exportado.
- **R5.3** El sistema deberá parametrizar `scripts/apply-migration-mgmt.mjs` con `--env {dev,prod}` (seleccionando `SUPABASE_PROJECT_REF`/`SUPABASE_ACCESS_TOKEN` del ambiente), preservando su comportamiento actual con `--env dev`.
- **R5.4** El sistema deberá proveer `scripts/apply-all-migrations.mjs` que aplique las migraciones en **orden de nombre de archivo** contra el ambiente target y registre cada archivo aplicado en el ledger `ops.applied_migrations`.
- **R5.5** Cuando una migración ya figure en `ops.applied_migrations`, `apply-all-migrations.mjs` deberá saltearla (idempotencia = catch-up incremental por release).
- **R5.6** El sistema deberá crear `ops.applied_migrations` (bootstrap `CREATE SCHEMA/TABLE IF NOT EXISTS`) antes del replay, y ofrecer un modo `--backfill` que registre las migraciones existentes **sin ejecutarlas** (para poner DEV — ya al día — en el ledger).
- **R5.7** El sistema deberá proveer `scripts/backup-db.mjs` que genere un `pg_dump` contra el **POOLER** de PROD, comprimido y con timestamp en el nombre del archivo.
- **R5.8** Si `backup-db.mjs` corre sin connection string de PROD válida, entonces deberá abortar con error **sin producir un archivo de backup vacío o parcial**.
- **R5.9** El sistema deberá parametrizar `scripts/powersync-deploy.sh` con `--env {dev,prod}` (seleccionando instancia/token del ambiente), con default `dev`.
- **R5.10** (Gate 1 H1) El directorio de salida de `backup-db.mjs` deberá estar **gitignoreado** y, por default, residir **fuera del árbol versionado**; ningún artefacto de backup podrá quedar en el working tree trackeable.
- **R5.11** (Gate 1 L2) `backup-db.mjs` deberá pasar la connection string a `pg_dump` por **variable de entorno** (`PGPASSWORD`/URI en env), nunca como argumento de línea de comando visible en `ps`.
- **R5.12** (Gate 1 M5) La guarda de PROD deberá ser **destino-aware**: si el project ref resuelto para `--env dev` (default) coincide con un ref conocido de PROD, entonces el sistema deberá tratar la operación como PROD y exigir `RAFAQ_CONFIRM_PROD=1` igual.
- **R5.13** (Gate 1 L4) Los scripts de ambiente **no deberán** imprimir el header `Authorization` ni el `SUPABASE_ACCESS_TOKEN`/token en stdout/stderr.

## R6 — Estado de PROD por replay ordenado + diff + PROD vacío

- **R6.1** El sistema deberá construir el schema de PROD por **replay ordenado** de las ~123 migraciones (`apply-all-migrations.mjs --env prod`), no por dump de schema.
- **R6.2** El replay deberá ensayarse contra un **Postgres limpio** (local/docker; o un proyecto scratch descartable si Docker está bloqueado por ADR-012) antes de aplicarse a PROD.
- **R6.3** Tras el replay a PROD, el sistema deberá producir un diff `pg_dump --schema-only` de **DEV vs PROD**.
- **R6.4** Si el diff DEV vs PROD muestra un delta, entonces el sistema deberá resolverlo con una **migración nueva `0124+`** aplicada a ambos ambientes, **nunca con un fix manual** en PROD.
- **R6.5** El sistema deberá inicializar PROD **sin datos de negocio sembrados** (solo schema + los catálogos globales que las propias migraciones crean).
- **R6.6** El sistema deberá ejecutar en PROD el checklist manual **no cubierto por el replay**: config de Auth (SMTP/Resend, templates es-AR, Site URL/redirects), secrets de las Edge Functions (`supabase secrets set --project-ref <prod>`), y el SQL de setup de PowerSync (rol de replicación + publication explícita, ver R6.7).
- **R6.6b** (Gate 1 M4) El checklist de Auth de PROD deberá enumerar y dejar **firmada** la postura del ambiente internet-facing: verificar/ajustar `[auth.rate_limit]` del dashboard de PROD (email/SMS/sign-in/token verifications), decidir captcha en signup, y decidir `enable_confirmations` (verificación de email). Aunque la decisión sea "aceptar defaults", deberá quedar explícita en el runbook, no implícita.
- **R6.7** (Gate 1 — hallazgo en vivo) El sistema deberá crear en PROD la publication lógica de PowerSync como **`FOR TABLES IN SCHEMA public`** (PG15+; auto-incluye tablas nuevas de `public` y deja fuera `audit`/`ops`), **no** `FOR ALL TABLES`. **Nota de ownership**: la conversión de la publication de DEV (hoy `FOR ALL TABLES`, `puballtables=true`, verificado en vivo contra dev, PG 17.6) la owna **feature 18** (frontera WAL del audit log); acá en 16 solo se garantiza el setup correcto de PROD desde el arranque.
- **R6.7b** (Gate 1 L3) El sistema deberá **asertar explícitamente** en PROD que la publication de PowerSync tiene `puballtables = false` y que su set de tablas ⊆ el de DEV (query a `pg_publication`/`pg_publication_tables`), como paso firmado del checklist — no dejarlo solo al ojo humano en el diff de R6.3.
- **R6.8** Cuando PROD esté listo, el sistema deberá pasar un **smoke manual**: sign-up → crear campo → import de rodeo (feature 12) → maniobra offline→sync → invitación con Resend.

## R7 — Edge Function `health`

- **R7.1** El sistema deberá proveer una Edge Function `health` que responda `{ ok: true }` cuando `SELECT 1` contra la DB sea exitoso.
- **R7.2** `health` deberá incluir en su respuesta la **versión de schema** (solo el **prefijo numérico de 4 dígitos** de la última migración registrada en `ops.applied_migrations`, p.ej. `"0124"`, o `"unknown"`) y un label de ambiente. (Gate 1 L1: no exponer el filename completo — filtraría nombres de features en un endpoint público.)
- **R7.3** Si `SELECT 1` o la lectura del ledger falla, entonces `health` deberá responder con status **no-200** y un copy genérico, **sin filtrar el mensaje crudo** del driver Postgres/Deno (patrón `serverError`).
- **R7.4** `health` deberá poder invocarse **sin JWT** (`verify_jwt = false`) para ser monitoreada por UptimeRobot.
- **R7.5** `health` **no deberá** exponer datos de negocio, conteos de tablas de tenants, ni PII.
- **R7.6** El sistema deberá deployar `health` en **ambos** proyectos (DEV y PROD).
- **R7.7** (Gate 1 M1) La función `public.health_status()` deberá revocar `EXECUTE` **`FROM PUBLIC`** (y, defensa en profundidad, también `FROM anon, authenticated`), de modo que `anon` no pueda ejecutarla como RPC público vía PostgREST.
- **R7.8** (Gate 1 M2) El sistema deberá documentar la **postura de rate-limit** del endpoint público `health` (cap liviano en el edge por IP, o aceptar-y-documentar el riesgo con justificación: query read-only trivial + monitor de invocaciones de feature 17) en la tabla de rate limits del runbook.
- **R7.9** (Gate 1 M2 invariante) El code-path de `health` (que corre con service_role) **no deberá** leer body ni params del request (superficie input-free).

## R8 — Backup diario + restore drill

- **R8.1** El sistema deberá ejecutar `backup-db.mjs` contra PROD **diariamente** mediante una GitHub Action cron en el repo remoto `RafaWASD/Tropero`.
- **R8.2** La connection string de PROD deberá residir **solo** como GitHub Actions secret (y en `.env.local` para el uso local), **nunca committeada**.
- **R8.3** Los artifacts de backup de la Action deberán retenerse **90 días**.
- **R8.4** El sistema deberá probar el **restore** del backup **una vez** contra un Postgres local y documentar el drill en el runbook.
- **R8.5** Si el backup del día falla, entonces la Action deberá terminar en **estado de error visible** (no verde silencioso).
- **R8.6** (Gate 1 M3) Los artifacts de backup deberán estar **cifrados en reposo** (p.ej. `gpg --symmetric`/`age` con passphrase en un GitHub secret aparte) antes de `upload-artifact`, de modo que el artifact sea inútil sin la clave de restore.
- **R8.7** (Gate 1 M3) El runbook deberá documentar que el repo `RafaWASD/Tropero` debe ser **privado** y que el acceso a Actions/artifacts equivale a acceso efectivo a la PII de PROD.

## R9 — Ops livianas: UptimeRobot + runbook + release

- **R9.1** El sistema deberá proveer `docs/runbook.md` (1 página) con las refs/URLs de **ambos** ambientes (Supabase, PowerSync, Expo).
- **R9.2** El runbook deberá documentar los **comandos exactos** de: release OTA (`eas update` → subida de sourcemaps → `--rollout-percentage` → `eas update:rollback`), migración a PROD, deploy de Edge Functions y sync streams, restore de backup, y triage de incidente.
- **R9.3** El runbook deberá incluir el **checklist manual de setup de PROD** que el replay no cubre (Auth/Resend/templates/redirects, secrets de Edge Functions, PowerSync rol+publication `FOR TABLE`).
- **R9.4** El runbook deberá incluir la **tabla de rotación de secretos** (`SUPABASE_SERVICE_ROLE_KEY` de dev, `SUPABASE_ACCESS_TOKEN`, `EXPO_ACCESS_TOKEN`, `RESEND_API_KEY`, `PS_ADMIN_TOKEN`, `SENTRY_AUTH_TOKEN`) con estado por secreto.
- **R9.5** El sistema deberá proveer un **template de log de incidentes de 5 líneas** (qué pasó / causa / fix / prevención / fecha).
- **R9.6** El sistema deberá documentar el esquema de **release notes con semver** atado al crash-free por versión.
- **R9.7** El sistema deberá documentar el **staged rollout gated por crash-free** (no ampliar una release si crash-free users < ~99.5%).
- **R9.8** El sistema deberá configurar **UptimeRobot** con monitores sobre `health` PROD, `health` DEV y el endpoint de sync de PowerSync PROD, con alerta por email.
- **R9.9** El sistema deberá crear en PROD el tenant **"Campo de prueba RAFAQ"** para las pruebas diarias de Raf y documentarlo en el runbook (insumo del filtro de observabilidad de feature 17).
- **R9.10** (Gate 1 M2/M3/M4) El runbook deberá incluir una **tabla de rate limits** (endpoint público `health` + Auth de PROD) y la **postura de data-at-rest** del backup (cifrado del artifact + repo privado), consolidando R7.8, R8.7 y R6.6b.

---

## Trazabilidad

Cada `R<n>` se cubre con ≥1 task en `tasks.md` y su verificación (test unitario / assert de config / test de Edge Function / verificación operativa documentada). El implementer registra el mapa `R<n> → archivo:test` en `progress/impl_16-ambientes-y-release.md`. Los requisitos de naturaleza operativa (R6.2/R6.3/R6.6/R6.8, R8.1/R8.4, R9.1–R9.9) se verifican por artefacto committeado + checklist ejecutado y firmado en el runbook, no por test automatizado (ver `design.md` §Verificación).

## Cobertura de las "Casos y decisiones" del context.md (Gate 0)

| Decisión context.md | Requirement(s) |
|---|---|
| D1 — Dos backends (DEV=actual, PROD=nuevo limpio) | R1.1, R1.2, R1.4 |
| D2 — Tres targets EAS + EAS env vars + `EXPO_PUBLIC_ENV` | R2.2–R2.3, R3.4, R4.1–R4.5 |
| D3 — Estado de PROD por replay + ledger + diff | R5.4–R5.6, R6.1–R6.4 |
| D4 — `app.config.ts` + lecturas estáticas + fixtures | R2.1, R3.1–R3.7 |
| D5 — Scripts con guarda de prod + backup/health día 1 | R5.1–R5.9, R7.1–R7.6, R8.1–R8.5 |
| D6 — PROD nace vacío + re-import | R6.5, R6.8 |
| D7 — Riesgo `preview→PROD`: tenant de prueba aislado | R9.9 |
| Checklist manual (Auth/Resend, Edge secrets, PowerSync publication) | R6.6, R6.6b, R6.7, R6.7b, R9.3 |
| Edge case: `check.mjs` verde sin cambios | R1.3, R5.1 |
| Edge case: shim E2E intacto | R3.2, R3.5 |
| Edge case: `extra.supabaseUrl` grep antes de borrar | R2.5 |
| Edge case: bundle `.dev` coexiste con prod | R2.4 |
| Edge case: `eas update` vs `env` de build | R4.4, R4.5 |
| Edge case: pg_dump contra el pooler + restore drill una vez | R5.7, R8.4 |

---

## Historial de aprobación

- **Gate 0 (Puerta 0 — contexto)**: APROBADO por Raf, 2026-07-12 → `context_ready`. Contexto en `context.md`.
- **spec_author (redacción)**: 2026-07-13 → `spec_ready`. Este documento + `design.md` + `tasks.md`.
- **Gate 1 (security_analyzer modo `spec`)**: **FAIL** (1 HIGH + 5 MEDIUM), 2026-07-13. Reporte: `progress/security_spec_16-ambientes-y-release.md`. Findings foldeados (ver Historial de refinamiento) → re-emitida `spec_ready` para re-review.
- **Puerta 1 (spec)**: PENDIENTE (aprobación humana de Raf tras Gate 1 PASS).

## Historial de refinamiento

### 2026-07-14 — Reconciliación as-built de Run B (implementación de scripts)

Aditivo, sin cambiar el *qué* de ningún EARS. Detalle en `progress/impl_16-runB.md` + `design.md` §4/§5.

- **R7.2 / R6.4 — numeración de la migración `health_status`**: el as-built es
  **`0125_health_status.sql`**, no `0124`: `0124_audit_log.sql` (spec 18, DONE) ya ocupaba 0124. El
  ejemplo `"0124"` de R7.2 y el símbolo `0124+` de R6.4 son ilustrativos del **formato** (prefijo de 4
  dígitos) / de la **convención** (todo delta futuro = migración numerada nueva); el comportamiento no
  cambia — solo el número concreto del primer delta pasa a 0125.
- **R5.2 / R5.12 — hardening de `backup-db.mjs`**: como `backup-db` SIEMPRE apunta a PROD (lee
  `SUPABASE_DB_URL_PROD` y exfiltra PII), exige `RAFAQ_CONFIRM_PROD=1` **siempre** (con o sin `--env`),
  más estricto que el mínimo de R5.2 y alineado a la lógica destino-aware de R5.12 (fail-closed).
- **R5.9 — `powersync-deploy.sh` prod**: selecciona la instancia PROD swappeando el link
  `powersync/cli.prod.yaml` (creado en Run F/F5) con restauración por `trap EXIT`; falla fail-closed si
  ese archivo no existe (no puede deployar prod a la instancia dev por error). Token
  `PS_ADMIN_TOKEN_PROD`→`PS_ADMIN_TOKEN` (account-level).

### 2026-07-13 — Reconciliación Gate 1 (FAIL → cierre de findings, aditivo, sin rediseño)

Cambios foldeados desde `progress/security_spec_16-ambientes-y-release.md`. Todos aditivos (nuevos `R<n>` o ajuste de wording de un `R<n>` existente); IDs previos preservados.

| Finding | Severidad | Cierre en requirements | + design/tasks |
|---|---|---|---|
| H1 — `backups/` no gitignoreado (dump PROD con PII) | HIGH | **R5.10** (gitignore + output fuera del working tree) | design §Archivos (agrega `.gitignore`) + §7; task B4 + nueva B7 (assert `git check-ignore`) |
| M1 — `REVOKE` de `health_status()` sin `FROM PUBLIC` | MED | **R7.7** | design §5 (SQL `FROM PUBLIC`) + task B6 |
| M2 — `health` público sin postura de rate-limit | MED | **R7.8**, **R7.9**, **R9.10** | design §6/§8 + task E5 |
| M3 — artifact de backup con PII sin cifrar | MED | **R8.6**, **R8.7**, **R9.10** | design §7 + tasks D1/D3 |
| M4 — checklist Auth de PROD sin rate-limit/captcha/email-confirm | MED | **R6.6b**, **R9.10** | design §Bring-up + task E2 |
| M5 — guarda de prod flag-aware, no destino-aware | MED | **R5.12** | design §4 + task B1 |
| L1 — `schema_version` filtra filename completo (contradice test C4) | LOW | **R7.2** (solo prefijo `^\d{4}`) | design §5 (`substring`) |
| L2 — conn string a `pg_dump` por argv | LOW | **R5.11** | design §4 + task B4 |
| L3 — publication `FOR TABLE` sin aserción explícita | LOW | **R6.7b** | design §Bring-up + task F3 |
| L4 — `apply-all-migrations.mjs` no debe loguear el token | LOW | **R5.13** | design §4 + task B3 |
| L5 — `.env.example` con placeholders, no valores reales | LOW | (task E4, nota) | task E4 |
| L6 — `RAFAQ_CONFIRM_PROD=1` en la Action solo en jobs read-only | LOW | (invariante, design §7) | design §7 |
| **Hallazgo en vivo** — publication de DEV es `FOR ALL TABLES` (PG 17.6) | — | **R6.7** reescrito: PROD nace `FOR TABLES IN SCHEMA public`; conversión de DEV la owna feature 18 | design §Multi-tenancy + §Bring-up + task F3 |
