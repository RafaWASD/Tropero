# Security review (modo `code`) — `16-ambientes-y-release` · Run B

**Veredicto: PASS**

Gate 2 de seguridad sobre el chunk Run B (scripts parametrizados + guarda de prod + ledger + backup +
`health_status`). Sin findings HIGH-confidence explotables. Dos notas MEDIUM/coverage que NO bloquean
Run B pero deben trackearse a Run F (encriptación del backup + precondición operativa de la guarda
destino-aware). Detalle abajo.

- **baseline_commit**: `4f5f5aa7fa15f9093ca22746622f7de2c1a68535` (HEAD == baseline; todos los cambios
  de Run B están sin commitear en el working tree).
- **Diff analizado**: `git status --porcelain` + `git diff 4f5f5aa` sobre los archivos de Run B (main,
  sin feature-branch).

---

## Archivos analizados

| Archivo | Tipo | Estado |
|---|---|---|
| `scripts/lib/env-target.mjs` | lógica pura (guarda de prod) | nuevo |
| `scripts/lib/ledger-plan.mjs` | lógica pura (replay/ledger) | nuevo |
| `scripts/lib/backup-cmd.mjs` | lógica pura (plan de backup) | nuevo |
| `scripts/apply-migration-mgmt.mjs` | imperativo (write a DB vía Mgmt API) | modificado |
| `scripts/apply-all-migrations.mjs` | imperativo (bootstrap ledger + replay) | nuevo |
| `scripts/backup-db.mjs` | imperativo (pg_dump PROD) | nuevo |
| `scripts/powersync-deploy.sh` | shell (deploy sync streams) | modificado |
| `supabase/migrations/0125_health_status.sql` | SQL (SECURITY DEFINER) | nuevo |
| `.gitignore` | config (agrega `backups/`) | modificado |
| `scripts/run-tests.mjs` | runner (registra los units nuevos) | modificado |
| `scripts/lib/*.test.mjs` (x3) | tests | nuevos (no reviewados como superficie) |

---

## Findings HIGH de Sentry

**Ninguno.** La skill `sentry-skills:security-review` (más el análisis manual con las refs
`injection.md` / `data-protection.md`) no identificó vulnerabilidad HIGH-confidence explotable en el diff.
La superficie del chunk son scripts de ops (sin input attacker-controlled: argv/env de operador, filenames
del repo) + un objeto SQL locked-down. No hay endpoint público nuevo, ni input de cliente Expo, ni ruta
de datos attacker-controlled.

---

## Findings RAFAQ-SPECIFIC

**Ninguno HIGH.** Todos los controles del catálogo aplicables a este diff (A1 service-role/bypass,
B1 information disclosure, D3 secrets, F command/SQL injection) están correctos. Ver verificación abajo.

---

## Verificación de los 5 focos (todos PASS)

### 1. Guarda de PROD (M5) — INFALIBLE en el código

Enumeré TODAS las rutas de write/apply/exfil y cada una aborta ANTES de cualquier `fetch`/`spawn`/deploy
si falta `RAFAQ_CONFIRM_PROD=1`:

| Script | Ruta a prod | Guarda | Aborta antes de |
|---|---|---|---|
| `apply-migration-mgmt.mjs` | `--env prod` → `resolveTarget` | `ProdGuardError` en `resolveTarget` (env-target.mjs:103) | `fetch` (línea 55). try/catch en 40-50, fetch en 55. ✓ |
| `apply-all-migrations.mjs` | `--env prod` → `resolveTarget` | idem, línea 48 en try | cualquier `mgmtQuery` (bootstrap/replay/insert). ✓ |
| `backup-db.mjs` | SIEMPRE apunta a PROD | guarda always-on `RAFAQ_CONFIRM_PROD !== '1'` (backup-db.mjs:57) | `buildBackupPlan` + `spawn('pg_dump')`. ✓ (más estricto que R5.2) |
| `powersync-deploy.sh --env prod` | deploy sync-config | `RAFAQ_CONFIRM_PROD != 1` (línea 61) + fail-closed si falta `cli.prod.yaml` (65) | `cp`/`deploy`. ✓ |

- `RAFAQ_CONFIRM_PROD` se compara con `=== '1'` estricto (fail-closed): cualquier otro valor NO abre la
  guarda. La guarda corre ANTES de validar completitud de ref/token, y ANTES del I/O.
- Destino-aware (M5/R5.12): un slot `dev` que apunta a un ref conocido de PROD también exige confirm
  (`env-target.mjs:96-97`). Cubierto por test `B1(e)`.
- No hay default-dev que apunte a prod hoy: `SUPABASE_PROJECT_REF` es el ref dev; `SUPABASE_PROJECT_REF_PROD`
  no existe en el setup dev-only → `knownProdRefs` vacío → cero falso positivo, y cero prod-real alcanzable
  por default.

### 2. Secrets NUNCA en logs/argv/artifacts — PASS

- **Conn string a `pg_dump` por libpq env, NO argv** (`backup-cmd.mjs:64`): `pgDumpArgs = ['--no-owner',
  '--no-privileges', '--verbose']` — sin `-d`/`--dbname`/conn string. La password viaja en
  `pgEnv.PGPASSWORD` y llega al child por `spawn(..., { env: { ...process.env, ...plan.pgEnv } })`
  (`backup-db.mjs:79-82`). No visible en `ps`. Cubierto por test `B4(c)`.
- **`pg_dump --verbose`** escribe progreso a stderr (`inherit`), pero pg_dump NO imprime `PGPASSWORD`;
  solo host/db/progreso (no secreto). OK.
- **Token de Supabase**: `Authorization: Bearer` se arma inline en el `fetch`; nunca se loguea. Los errores
  loguean SOLO el body de RESPUESTA (`apply-migration-mgmt.mjs:62`, `apply-all-migrations.mjs:67`
  `body.slice(0,600)`) — la Mgmt API no ecoa el header auth. Se loguea solo `target.ref` (no secreto).
- **`safeSummary`** (`backup-cmd.mjs:69`) = host/db/out, sin password ni conn string. Test `B4(b)`.
- **URI inválida** en `parseConnString` → mensaje genérico, NO ecoa el valor crudo (`backup-cmd.mjs:19`).
- **Backup cifrado + fuera del tree + gitignored**: output default `~/.rafaq-backups/` (fuera del working
  tree, test `B4(d)`); `backups/` agregado a `.gitignore` como red de contención → un `git add -A` NO
  commitea un dump PII. **Caveat**: la encriptación gpg NO está en este script — es responsabilidad de la
  Action (Run F). Ver MEDIUM-1 abajo.
- `powersync/cli.yaml` = solo IDs públicos (instance/org/project), sin token; `cli.yaml.tmp` y
  `sync-config.yaml` gitignoreados (verificado con `git check-ignore`).

### 3. `apply-all-migrations` — ledger seguro — PASS

- `ops.applied_migrations` REVOKEado del cliente: el `BOOTSTRAP_SQL` hace
  `REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated` + `REVOKE ALL ON ALL TABLES IN SCHEMA ops
  FROM PUBLIC, anon, authenticated` (`apply-all-migrations.mjs:86-87`). El CREATE TABLE precede al REVOKE
  en el mismo batch → la tabla queda cubierta.
- `ops` NO expuesto por PostgREST: `config.toml` expone solo `["public", "graphql_public"]` → el schema
  `ops` es inalcanzable vía REST, independientemente del REVOKE. Doble protección.
- El replay ejecuta SOLO migraciones del repo: `readdirSync(supabase/migrations).filter(.sql)` — fuente
  confiable (versionada), no SQL arbitrario de una fuente externa.
- INSERT del ledger: `filename` va con `sqlEscape` (dobla `'`), `checksum` es sha256 hex. Ambos valores son
  repo-controlled (no attacker-controlled). No explotable. Ver "False positives" para el análisis de SQLi.

### 4. `0125_health_status.sql` — PASS

- `security definer set search_path = ''` con todas las refs fully-qualified (`ops.applied_migrations`).
- `REVOKE ALL ... FROM PUBLIC` + `FROM anon, authenticated` + `GRANT EXECUTE ... TO service_role`
  (líneas 35-39). Sin el GRANT explícito el health rompería (correcto y necesario tras revocar PUBLIC).
- No filtra datos: devuelve `{ok, schema_version}` con `schema_version` = SOLO el prefijo de 4 dígitos
  (`substring(max(filename) from '^\d{4}')`), NO el filename completo → no revela nombres de features/roadmap.
- EXCEPTION `undefined_table OR invalid_schema_name` → `'unknown'` sin romper `ok:true` (defensivo si el
  ledger aún no existe).
- La auth del endpoint `health` (Edge Function) es Run C (no está en este diff); la función SQL en sí queda
  correctamente lockdown para service_role únicamente.

### 5. `powersync-deploy --env prod` — PASS

- No deja el link de instancia colgado: `cp cli.yaml cli.yaml.tmp` → `trap 'mv -f ... cli.yaml' EXIT` →
  `cp cli.prod.yaml cli.yaml` (`powersync-deploy.sh:70-72`). El swap se restaura SIEMPRE al salir
  (normal, `set -e`, o señal que dispara EXIT en bash). `cli.yaml.tmp` gitignoreado (`*.tmp`).
- Fail-closed si falta el yaml de prod: aborta con exit 1 si no existe `cli.prod.yaml` (líneas 65-69),
  ANTES del swap/deploy → imposible deployar prod-streams por error hoy (el yaml lo crea Run F).
- Guarda de prod (línea 61) antes de todo lo anterior.

---

## MEDIUM / coverage (NO bloquean Run B; trackear a Run F)

### MEDIUM-1 · Backup local queda en claro (encriptación gpg diferida a la Action / Run F)

`backup-db.mjs` produce un `.sql.gz` **sin cifrar** en `~/.rafaq-backups/`. Contiene PII de PROD (EID
SENASA, emails, teléfonos, geo — Ley 25.326). El FOCO del gate pedía "backup CIFRA (gpg AES256)", pero el
cifrado NO está en este script: el propio comentario (`backup-db.mjs:15`) y el design §7 lo delegan a la
GitHub Action (`gpg` antes de subir el artifact), que es **Run F, fuera de este chunk**.

- Mitigación presente en Run B: gate `RAFAQ_CONFIRM_PROD` + output fuera del tree + `backups/` gitignored.
- Riesgo residual: en una corrida **local** manual (break-glass), el dump plaintext queda en disco del
  operador (C3 data-at-rest). Inherente a `pg_dump` sin un paso de cifrado.
- Acción: al aterrizar Run F, verificar que la Action haga `gpg --symmetric --cipher-algo AES256` (passphrase
  desde secret) ANTES de cualquier `upload-artifact`, y que el `.sql.gz` plano se borre post-cifrado. No es
  un FAIL de Run B (el chunk scopeó el cifrado a la Action), pero el humano debe aceptar conscientemente que
  el dump local NO se cifra en reposo.

### MEDIUM-2 · Robustez de la guarda destino-aware depende de config operativa (precondición Run F)

La detección "slot dev apunta a prod" (M5/R5.12) solo dispara si el ref de prod está en `knownProdRefs`
(`SUPABASE_PROJECT_REF_PROD` o `RAFAQ_KNOWN_PROD_REFS`). Hoy (dev-only) ese set está vacío → no hay riesgo
porque no existe prod. Cuando Run F provisione PROD, la guarda destino-aware SOLO protege si el operador
setea `SUPABASE_PROJECT_REF_PROD`. La ventana de riesgo (doble misconfig: prod existe, `_PROD` sin setear,
Y `SUPABASE_PROJECT_REF` apuntando al ref de prod) es baja y está documentada en la spec, pero conviene que
Run F la vuelva precondición explícita (setear `SUPABASE_PROJECT_REF_PROD` es requisito, no opcional).
La ruta explícita `--env prod` sí está 100% guardada independientemente de esto.

---

## False positives descartados (trazabilidad)

- **SQLi en el INSERT del ledger** (`apply-all-migrations.mjs:118-120`): `filename` y `checksum` se
  interpolan en el string SQL. Descartado como HIGH: (a) ambos son repo-controlled (filenames de
  `supabase/migrations`, sha256 hex), NO attacker-controlled; (b) `filename` va con `sqlEscape` (dobla `'`),
  y con `standard_conforming_strings` on (default PG moderno) el `\` es literal → no hay ruta de escape.
  Tradeoff aceptable para una tool de ops supervisada y gateada. (Mejora opcional, no bloqueante: usar
  parámetros de la Mgmt API si algún día soportara binding — hoy es query-string, así que el escape es el
  control correcto.)
- **`spawn(pg_dump, ..., { env: { ...process.env, ... } })` pasa todo el env al child**: descartado —
  es el patrón estándar de `spawn`; pg_dump no loguea env vars ajenas. No es leak.
- **`--verbose` de pg_dump a stderr inherit**: descartado — pg_dump no imprime `PGPASSWORD`; solo
  progreso/host/db (no secreto).
- **`RAFAQ_CONFIRM_PROD` cargado desde `.env.local`**: el parser (`if (!(m[1] in process.env))`) puede
  levantar `RAFAQ_CONFIRM_PROD=1` si un dev lo deja pegado en `.env.local`, volviendo la guarda un no-op
  permanente. Descartado como finding de código: es un opt-in deliberado del operador (equivalente a
  exportarlo en la shell); la guarda es un speed-bump consciente, no un secreto. LOW/footgun, no HIGH.

---

## Cobertura indirecta (Deno / RLS / PowerSync)

- La skill de Sentry NO cubre bien: shell (`powersync-deploy.sh`), libpq/`pg_dump`, semántica de
  `SECURITY DEFINER`/`REVOKE`/PostgREST, ni el modelo de guarda-de-prod. **Todo eso se revisó a mano**
  (arriba) contra el catálogo RAFAQ (A1, B1, C3, D3, F).
- El endpoint `health` (Edge Function, auth pública/service_role) y la aplicación real de `0125` a DEV/PROD
  son **Run C/F** — fuera de este diff. La función SQL en sí queda correcta; su exposición HTTP se revisa
  cuando llegue la Edge Function.
- No hay sync rules de PowerSync nuevas en este diff (solo el mecanismo de deploy). Las reglas viven en
  `sync-streams/rafaq.yaml` (sin cambios acá).

---

## Tabla de inputs (campos que el usuario tipea)

| campo | límite | validación | OK? |
|---|---|---|---|
| — | (no hay forms/buscadores/texto libre/prompts en este chunk) | n.a. | n.a. |

Los únicos "inputs" son argv/env de operador (`--env`, `--backfill`, `--out-dir`, `RAFAQ_CONFIRM_PROD`) y
filenames del repo. `--env` valida dominio `{dev,prod}` con default dev y rechazo explícito de otros valores
(`env-target.mjs:88`, `powersync-deploy.sh:34`). No es superficie attacker-controlled.

## Tabla de rate limits (acciones abusables)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `apply-migration-mgmt` / `apply-all-migrations` (write a DB vía Mgmt API) | n.a. | n.a. | sí (guarda prod) | Tool de ops local, no endpoint expuesto; requiere `SUPABASE_ACCESS_TOKEN` de operador. No hay superficie pública que rate-limitear. |
| `backup-db` (pg_dump PROD) | n.a. | n.a. | sí (confirm always-on) | idem, break-glass local gateado. |
| `powersync-deploy --env prod` | n.a. | n.a. | sí (confirm + cli.prod.yaml) | idem. |
| `health_status()` / endpoint `health` | fuera de scope | — | — | La Edge Function `health` es Run C; su rate limit/exposición se revisa ahí. |

Ninguna acción de Run B es un endpoint público autenticable por un atacante remoto → rate limiting "n.a."
justificado. El endpoint `health` (Run C) sí deberá revisarse por rate limit/DoS cuando exista.

---

**Cierre**: PASS. Sin HIGH. Dos MEDIUM de coverage (cifrado del backup + precondición destino-aware) que
son deuda explícita de **Run F**, no defectos de Run B. El leader debe pasar estos dos ítems al tracking de
Run F antes de mostrar al humano.
