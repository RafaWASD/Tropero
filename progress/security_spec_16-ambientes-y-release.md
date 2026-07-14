# Gate 1 — Security review (modo `spec`) — Feature 16 · Ambientes y release

**Feature**: `16-ambientes-y-release`
**Analista**: security_analyzer (modo `spec`)
**Input**: `specs/active/16-ambientes-y-release/{requirements,design,tasks}.md` + `context.md`

## Veredicto vigente: **PASS** (Ronda 2 — re-review, 2026-07-13)

Ronda 1 (2026-07-13) fue **FAIL** (1 HIGH + 5 MEDIUM + 6 LOW + 1 hallazgo en vivo). El spec_author reconcilió los 13 items de forma aditiva (nuevos `R<n>` / ajuste de wording, sin rediseño, IDs previos preservados). Re-verifiqué cada finding contra la spec reconciliada: **todos cerrados**. Las 3 adiciones nuevas (cifrado gpg del artifact, guarda destino-aware, `GRANT EXECUTE ... TO service_role`) **no introducen ningún HIGH nuevo** — son aditivas y fail-safe. Queda 1 nit LOW no bloqueante (passphrase gpg por argv).

**→ Apto para Puerta 1.** Recordatorio de gating operativo: Run F (bring-up de PROD) sigue requiriendo Puerta 1 aprobada + deps externas + OK de deploy de Raf por cada escritura a un ambiente real (ya está así en `tasks.md`).

---

## Ronda 2 — Verificación de cierre de cada finding

| # | Finding (Ronda 1) | Cierre verificado | Evidence en la spec | Estado |
|---|---|---|---|---|
| **H1** | `backups/` no gitignoreado → dump PROD (PII) commiteable | Output default **fuera** del working tree (`~/.rafaq-backups/` local; `$RUNNER_TEMP` en CI) + `backups/` a `.gitignore` como red de contención | R5.10; design §4 (tabla backup) + §7 + §Archivos (agrega `.gitignore`); tasks B4(d), **B7** (`git check-ignore`), D1 (`--out-dir "$RUNNER_TEMP"`) | ✅ CERRADO |
| **M1** | `REVOKE` de `health_status()` sin `FROM PUBLIC` no deniega anon | `REVOKE ... FROM PUBLIC` **+** `FROM anon, authenticated` **+** `GRANT EXECUTE ... TO service_role` (caller real tras revocar PUBLIC) | R7.7; design §5 (SQL) + §4 (`ops` REVOKE FROM PUBLIC tb); tasks B6, **C4(d)** (anon no puede `rpc/health_status`) | ✅ CERRADO |
| **M2** | `health` público sin postura de rate-limit | Aceptar-y-documentar (query read-only trivial + monitor feat.17) + invariante input-free (no lee body/params) + tabla en runbook | R7.8, R7.9, R9.10; design §6; tasks C1, **E5** | ✅ CERRADO |
| **M3** | Artifact de backup con PII sin cifrar | `gpg --symmetric AES256` con `BACKUP_GPG_PASSPHRASE` (secret aparte) antes de `upload-artifact` → sube `*.sql.gz.gpg`; runbook exige repo privado | R8.6, R8.7, R9.10; design §7; tasks D1, D3, F8 | ✅ CERRADO |
| **M4** | Checklist Auth PROD sin rate-limit/captcha/email-confirm | Checklist internet-facing firmado: `[auth.rate_limit]` + captcha signup + `enable_confirmations` | R6.6b, R9.10; design §Bring-up paso 3; tasks E2, F3 | ✅ CERRADO |
| **M5** | Guarda de prod flag-aware, no destino-aware | `resolveTarget` destino-aware: ref de `dev` == ref conocido de PROD → exige `RAFAQ_CONFIRM_PROD=1` igual | R5.12; design §4 (`resolveTarget`); tasks **B1(e)** (test destino-aware) | ✅ CERRADO |
| **L1** | `schema_version` filtra filename completo (contradice test C4) | Solo prefijo `^\d{4}` (`substring(max(filename) from '^\d{4}')`) — alinea con el test C4 | R7.2; design §5; task B6 | ✅ CERRADO |
| **L2** | Conn string a `pg_dump` por argv | Por env (`PGPASSWORD`/URI en env, no argv) | R5.11; design §4; task B4(c) | ✅ CERRADO |
| **L3** | Publication `FOR TABLE` sin aserción explícita | Aserción `puballtables=false` + set ⊆ DEV (query a `pg_publication`/`pg_publication_tables`), paso firmado | R6.7b; design §Multi-tenancy + §Bring-up; task F3 | ✅ CERRADO |
| **L4** | `apply-all-migrations.mjs` podría loguear el token | No imprime `Authorization`/`SUPABASE_ACCESS_TOKEN` (hereda patrón) | R5.13; design §4; task B3 | ✅ CERRADO |
| **L5** | `.env.example` con valores reales | Solo placeholders | design §Archivos (nota) + task E4 | ✅ CERRADO |
| **L6** | `RAFAQ_CONFIRM_PROD=1` en jobs de escritura | Invariante: solo en la Action read-only de backup | design §7 (invariante) + task D1 | ✅ CERRADO |
| **Live** | Publication de DEV es `FOR ALL TABLES` (PG 17.6, verificado en vivo) | PROD nace `FOR TABLES IN SCHEMA public` (excluye `audit`/`ops` del WAL); conversión de DEV la owna **feature 18** | R6.7; design §Multi-tenancy (autoritativo); task F3 | ✅ CERRADO |

---

## Escrutinio de las adiciones NUEVAS (¿introducen un HIGH?)

Reglas del rol: toda adición hecha para cerrar un finding se re-audita. Las tres nuevas:

1. **`GRANT EXECUTE ON FUNCTION public.health_status() TO service_role` (M1)** — **Seguro, y necesario.** Tras `REVOKE ... FROM PUBLIC`, la función pierde el grant default que el caller heredaba; el único invocador real (la EF `health` con service_role) necesita `EXECUTE` explícito o el health rompe. `service_role` es el grantee correcto (la EF usa `createAdminClient()` → `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, verificado en `_shared/supabase.ts` — server-only, **nunca** en el bundle). Otorgarle EXECUTE a un rol que de por sí bypassa RLS, sobre una función que solo devuelve `{ok, schema_version(4 dígitos)}`, no agrega superficie. `anon`/`authenticated` **no** reciben el grant (test C4(d) lo asserta). No es HIGH.

2. **Guarda destino-aware (`resolveTarget`, M5)** — **Fail-safe puro.** La lógica solo puede *agregar* un requisito de confirmación (si el ref de `dev` coincide con el de PROD), nunca removerlo. Peor caso = falso positivo (pide confirmación de más) = fail-closed. Si `SUPABASE_PROJECT_REF_PROD` no está seteado (máquina dev-only), degrada al comportamiento dev normal sin nada de PROD que proteger. No abre superficie de ataque. No es HIGH.

3. **Cifrado gpg del artifact (M3)** — **Sube la barra, sin regresión.** `gpg --symmetric AES256` con passphrase en un secret **distinto** del de la conn string; el artifact subido es solo `*.sql.gz.gpg` (glob preciso — el `.sql.gz` en claro queda en `$RUNNER_TEMP`, no se sube, y el runner efímero se destruye → el plaintext nunca sale del runner). Quien tenga acceso de descarga de artifacts pero no a los secrets del workflow no puede descifrar. Cripto adecuada. No es HIGH.

   - **Nit LOW (no bloqueante) — L7**: la passphrase se pasa como `--passphrase "$BK"` (argv), mismo patrón que L2 ya corregimos para la conn string. En un runner GitHub efímero y single-tenant (repo privado) el riesgo de `ps`-snooping es prácticamente nulo y GitHub enmascara el secret en logs, así que **no gatea el PASS**. Recomendación de consistencia para el implementer: usar `--pinentry-mode loopback --passphrase-fd 0` (passphrase por stdin) en vez de argv. Documentarlo si se quiere, pero no bloquea.

Ningún otro cambio de la reconciliación abre superficie. El `REVOKE ... FROM PUBLIC` agregado al schema `ops` (design §4) es defensa en profundidad correcta (las tablas no traen grant default a PUBLIC; `ops` tampoco está en `api.schemas` — verificado en `config.toml`).

---

## Tabla de inputs (campos que tipea el usuario)

Sin cambios respecto a Ronda 1: feature de infra/ops, **no expone formularios/buscadores/texto libre de usuario final**.

| Entrada | Origen | Límite | Validación | OK? |
|---|---|---|---|---|
| `--env {dev,prod}` / `--backfill` / `--out-dir` (CLI) | Operador (Raf) | dominio `{dev,prod}` / flag / ruta | server-side en `resolveTarget` (throw si inválido) + guarda destino-aware | OK |
| Body/params del request a `health` EF | Público (no-auth) | n/a — la función los **ignora** (input-free, R7.9) | superficie input-free, corre con service_role sin leer input | OK |
| SQL de migraciones (replay) | Developer (repo) | n/a — código versionado | code review + diff pg_dump DEV/PROD | OK |

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Edge Function `health` (público, `verify_jwt=false`) | Aceptado-y-documentado (sin cap) | n/a (unauth) | n/a | R7.8/R9.10 — query read-only trivial (`SELECT 1`+`max`), blast radius 1 RPC, monitor por feat.17; input-free (R7.9). Postura firmada en runbook. |
| Auth de PROD (signup / OTP / email / token refresh) | Verificación explícita en checklist de PROD | per-IP (nativo Supabase) | sí (nativo) | R6.6b — el checklist firma `[auth.rate_limit]` + captcha + `enable_confirmations` del ambiente internet-facing. |
| `apply-*` / `powersync-deploy` (write a ambiente real) | n/a (operador, guarda `RAFAQ_CONFIRM_PROD` + destino-aware) | n/a | sí (aborta sin confirm; destino-aware R5.12) | No attacker-facing. |
| `backup-db.mjs` (pg_dump PROD) | n/a (CI/operador, guardado) | n/a | sí (aborta sin conn string, R5.8) | Read-only; artifact cifrado (R8.6). |

---

## Dominios revisados / excluidos

**Revisados**: A (authz function-level — `health_status()` REVOKE/GRANT ✔; `health` service_role input-free ✔; guarda destino-aware ✔), B (exposición — `serverError` no filtra driver msg ✔, `schema_version` 4 dígitos ✔, `ops` fuera de PostgREST ✔), C (offline/sync — publication `FOR TABLES IN SCHEMA public` excluye `ops`/`audit` ✔, auth PowerSync = JWKS igual que DEV ✔), D (secretos — service_role solo server-side ✔, `EXPO_PUBLIC_*` sin secretos ✔, conn string solo GitHub secret/`.env.local` gitignoreado ✔, artifact cifrado ✔, `.env.example` placeholders ✔), E (abuso — `health` postura documentada ✔, Auth PROD checklist ✔), H (auth/sesión — Site URL/redirects en checklist ✔), I (compliance — backup cifrado + repo privado + fuera del tree ✔).

**Excluidos** (justificación): A2/A3 mass-assignment/IDOR (sin CRUD de negocio), C1/C2 sync rules/Realtime nuevos (reusa `rafaq.yaml` sin cambios), F2 CSV/import (feature 12), F3 SSRF (fetch a hosts fijos: `api.supabase.com`, pooler PROD), G BLE (feature server/ops), RLS row-level (sin policies nuevas; replay idéntico verificado por diff R6.3).

---

## Historial

- **Ronda 1 (2026-07-13)**: **FAIL** — H1 (backups/gitignore), M1–M5, L1–L6 + hallazgo en vivo (publication DEV `FOR ALL TABLES`). Detalle de findings en la historia de git de este archivo.
- **Ronda 2 (2026-07-13)**: **PASS** — 13/13 findings cerrados, verificados contra requirements/design/tasks; adiciones nuevas re-auditadas sin HIGH nuevo; 1 nit LOW no bloqueante (L7, gpg passphrase por argv). Apto para Puerta 1.
