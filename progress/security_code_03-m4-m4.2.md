# Security Code Review — Spec 03 MODO MANIOBRAS · M4 reanudación + R10.6 single-active + M4.2 R10.8

**Modo**: `code` (Gate 2, ADR-019)
**Fecha**: 2026-06-17
**Analista**: security_analyzer (Opus 4.8 1M)
**Skill**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability aplicada)

## Veredicto

**PASS — 0 findings HIGH.**

Los tres chunks (M4-reanudación R10.5/R10.6, single-active-session R10.6, M4.2 surfacing de rechazos R10.8) NO introducen ninguna vulnerabilidad explotable de alta confianza. El delta es frontend + un toque al connector de PowerSync, sin schema (Gate 1 N/A confirmado). El scoping multi-tenant, el manejo de PII en el store de rechazos, el contrato dead-letter del connector y los guards de carrera están correctos. Los hallazgos de defensa-en-profundidad (MEDIUM/LOW, abajo) NO bloquean.

## Alcance exacto auditado

Rango committed `101d898..7cfbea7` (verificado: exactamente los 4 commits de spec 03, chain contiguo `9d8962a → a9eff93 → 279a10f → 7cfbea7`, sin commits ajenos interleaved):

- `9d8962a` — M4 reanudación (retomar jornada abierta; nueva cierra la abierta)
- `a9eff93` — cambios de spec-03 en archivos compartidos (solo lo de spec 03)
- `279a10f` — R10.6 enforce una sola jornada activa por establishment
- `7cfbea7` — M4.2 R10.8 surfacing de rechazos de sync

**Baseline**: `56f27438` (registrado en `progress/impl_03-modo-maniobras.md`). El diff cumulativo baseline..HEAD arrastra specs 04/05/08/09/10 → se descartó; se auditó el diff EXACTO de los 4 commits vía `git show` + patch scoped (`101d898..7cfbea7`, 2916 líneas).

**Fuera de alcance (ignorado)**: working-tree sin commitear, `app/src/services/sigsa/`, `specs/active/08-*`, `progress/*_08-sigsa-*`, `RAFAQ-resumen-app.*`, `design/veto-*` (terminal de spec 08).

## Findings HIGH

Ninguno.

## Superficies escrutadas (con evidencia)

### 1. `closeActiveSessions` / `createSession` — tenant scoping + race (R10.6)

**Veredicto: SEGURO.** Sin finding.

- `buildCloseActiveSessionsUpdate` (`app/src/services/powersync/local-reads.ts:2205-2212`):
  ```sql
  UPDATE sessions SET status = 'closed', ended_at = ?
  WHERE establishment_id = ? AND status = 'active' AND deleted_at IS NULL
  ```
  Parametrizado (sin string-interp). Scopeado por `establishment_id` + `status='active'` + `deleted_at IS NULL` → NO toca sesiones de otro tenant ni re-toca cerradas/borradas.
- **Data flow del `establishmentId`** (`sessions.ts:128-131`): viene de `CreateSessionInput.establishmentId` = contexto activo (`useEstablishment`), NUNCA hardcodeado (CLAUDE.md ppio 6). No es attacker-controlled de forma que rompa el scoping: aun si se forzara un establishment ajeno, el SQLite local no contiene sesiones de ese establishment (ver punto siguiente), y la RLS server-side lo rechaza al subir.
- **Frontera de tenant real (no solo RLS)**: la stream `est_sessions` de PowerSync (`sync-streams/rafaq.yaml:130-135`) scopea el SQLite local a `sessions WHERE establishment_id IN org_scope` (`org_scope = user_roles WHERE user_id = auth.user_id() AND active = true`). El UPDATE masivo solo alcanza filas presentes en el SQLite local = del propio tenant. La RLS `sessions_update = has_role_in` re-valida cada UPDATE al subir (defensa en profundidad C1 del catálogo cubierta).
- **Race / fail-closed** (`sessions.ts:129-143`): el close-all (`closeActiveSessions`) se ejecuta y se chequea ANTES del INSERT; si `!closed.ok` → return temprano, NO inserta. No deja la nueva conviviendo con activas viejas. Ambos writes son locales/offline encolados FIFO (close-all antes del insert) → al subir cierran las viejas y aparece la nueva. No hay ventana donde se cierre algo ajeno ni quede huérfana a HIGH confidence (ver MEDIUM-1 para la nota de atomicidad inter-proceso, que NO es explotable).

### 2. Store de rechazos de upload — `upload-rejections.ts` (lo más sensible, R10.8)

**Veredicto: SEGURO.** Sin finding. Los tres riesgos señalados en el prompt se verificaron y descartaron:

- **NO persiste `opData`** (CONFIRMADO): `UploadRejection` (`upload-rejections.ts:115-126`) y `recordUploadRejection` (`:163-191`) guardan SOLO `{ id, table, op, code, at }`. El `op.opData` (que trae datos de campo: pesos, EID, notas) NUNCA se lee ni se guarda. Cap 50 (`MAX_UPLOAD_REJECTIONS`, `:129`) + dedup por `id` (`:182-188`) correctos. Privacidad B2/C3 del catálogo respetada.
- **Never-throw NO traga un fallo de seguridad** (CONFIRMADO): el `try/catch` que envuelve `recordUploadRejection` (`:164-190`) es un canal de NOTIFICACIÓN puro. La decisión de seguridad (descartar el upload rechazado permanente) YA ocurrió en `connector.uploadData` (`connector.ts:117-121` / `:169-174`) ANTES de llamar a `surfaceUploadRejection`. Un fallo del store solo significa que el operario podría no ver el banner — NO bypassa ninguna authz, NO hace fail-open, NO suprime el rechazo (el rechazo lo decide el server vía RLS/CHECK; el cliente no puede revertirlo). Es lo correcto: el surfacing es best-effort por diseño para no romper el drenado de la cola (un dead-letter envenenado trabaría TODA la sync). No es el patrón fail-open de `error-handling.md` (no hay check de seguridad saltado en el catch).
- **`rejectionReason` NO filtra IDs/PII** (CONFIRMADO): `rejectionReason` (`:90-105`) devuelve strings es-AR HARDCODEADOS por `errcode` (`23514`/`42501`/default), prefijados con el TIPO de maniobra (label es-AR de la tabla, p.ej. "Pesaje"). Cero interpolación de `id`, `code` crudo, `establishment_id`, ni opData. La UI (`SyncRechazoSheet.tsx`) renderiza solo `rejectionReason(table, code)` + `rejectionWhenLabel(at)` (tiempo relativo) — nunca el `id` ni el `code` raw. No hay information-disclosure (B1/CWE-209). Los mensajes son genéricos y accionables, no revelan estructura interna.

### 3. Connector — contrato dead-letter de `surfaceUploadRejection` (R10.8)

**Veredicto: SEGURO.** Sin finding.

- `connector.ts:112-122` (CRUD-plano) y `:153-175` (intents): un error transitorio (`isTransientUploadError`/`classifyIntentUploadError === 'transient'`) hace **re-throw** → la tx queda en cola para reintento (no se pierde). Un rechazo **PERMANENTE** (RLS `42501` / CHECK `23514` / tenant-check) → `surfaceUploadRejection(op, error)` + `transaction.complete()` (descarta la op para no envenenar la cola). El contrato se mantiene: el rechazo permanente NO se pierde en silencio (va al store observable + `console.warn`) Y no rompe el loop de upload.
- `surfaceUploadRejection` (`connector.ts:189-209`): DOS canales, cada uno en su PROPIO `try/catch` (si el `console.warn` tirara, el `recordUploadRejection` igual corre, y viceversa). El `console.warn` loguea SOLO `{table, op, code}` (`:193-197`) — NO opData (B2 respetado). El catch noop es legítimo aquí (notificación, no seguridad — mismo razonamiento que §2).

### 4. Reanudación — `maniobra.tsx` / `maniobra-resume.ts` / `NuevaJornadaConfirmSheet` / session reads

**Veredicto: SEGURO.** Sin finding.

- `buildActiveSessionQuery` (`local-reads.ts:2268-2277`): scopeado por `establishment_id = ?` + `status='active'` + `deleted_at IS NULL`, parametrizado.
- `buildSessionByIdQuery` (`local-reads.ts:2283-2291`): lee por `id = ?` + `deleted_at IS NULL`. NO filtra por establishment, PERO el SQLite local ya está tenant-scopeado por la stream `est_sessions` → un `id` de otro tenant simplemente no existe en el local DB → no hay IDOR/lectura cross-tenant (CWE-639 descartado: la clave no es attacker-controlled hacia datos ajenos porque el dataset local ya está acotado al tenant). Es lectura local pura, offline.
- `maniobra-resume.ts` (helper PURO, `:1-55`): sin red, sin SDK, sin input no confiable — arma textos derivables del `Session` (maniobras, contador, fecha). Tolerante a config corrupto (`→ ''`/`null`, no tira). Nada que explotar.
- **Guard de carrera (R10.6)** (`maniobra.tsx`): el CTA "Nueva jornada" está `disabled={loading}` + el handler hace `if (loading) return` mientras `getActiveSession` está en vuelo → no arranca a ciegas dejando dos activas. Tras 279a10f el cierre de la abierta lo hace `createSession` (fail-closed), no el sheet (que solo navega). Correcto.
- `buildMoveAnimalToRodeoUpdate` (`local-reads.ts:2118-2123`, R4.4 via a9eff93): `UPDATE animal_profiles SET rodeo_id = ? WHERE id = ? AND deleted_at IS NULL`, parametrizado. Validación server-side (triggers `tg_animal_profiles_rodeo_same_system_check` 0047 + `tg_animal_profiles_rodeo_check` 0021 + RLS `has_role_in`) — patrón CRUD-plano offline establecido. El `rodeoId` viene de `rodeo.available` (RodeoContext, solo rodeos del campo activo). No replica validación en cliente (correcto: el server es la autoridad). Sin finding.

## Checklist RAFAQ-específico

- **RLS / sync rules (C1/C2)**: `est_sessions` y las 5 tablas de evento de maniobra (`est_animal_events`) scopeadas por `establishment_id IN org_scope` en `sync-streams/rafaq.yaml`. Las nuevas queries de sesión NO ensanchan la superficie sincronizada. OK.
- **Service-role / `createAdminClient` (A1)**: NINGÚN cambio usa service-role. Todo es CRUD-plano cliente sujeto a RLS. N/A.
- **Mass assignment (A2)**: `buildCreateSessionInsert` (`local-reads.ts:2162-2177`) lista campos explícitamente (`id, establishment_id, rodeo_id, config, status='active', work_lot_label, animal_count=0, event_count=0, started_at`). NO hay spread de `body` del cliente. `created_by` lo FUERZA el trigger al subir. OK.
- **Information disclosure (B1)**: ningún `err.message`/`error.message` crudo se devuelve al usuario. El store solo guarda `code` (errcode Postgres, no message) y la UI muestra motivos hardcodeados. OK.
- **Secrets (D)**: cero secretos hardcodeados; ningún `console.log`/`console.warn` de opData o tokens (el único `console.warn` loguea `table/op/code`). OK.
- **Validación de inputs**: ver tabla. Estos chunks NO agregan formularios/buscadores/texto-libre nuevos atacables. El único texto persistido es `work_lot_label` (ya existente, R9.4, no tocado por estos commits) y el `config` jsonb (server-controlled shape del wizard). N/A material.
- **Rate limiting**: ver tabla. No hay acciones abusables nuevas (sin Edge Function, sin email/SMS, sin API externa, sin bulk fan-out). N/A.
- **Offline/sync (C)**: data-at-rest local — el store de rechazos es in-memory (no persiste a disco) y SIN opData → no agrega PII al SQLite local. Stale-auth en replay (C4): el server re-autoriza cada upload (RLS + triggers); un rol revocado entre la edición offline y el sync rechaza el upload → R10.8 lo superficia. OK.
- **BLE (G)**: no tocado por estos chunks. N/A.

## Tabla de inputs (campos que el usuario tipea, nuevos/modificados en el delta)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| (ninguno nuevo) | — | — | — |

> Estos chunks no introducen formularios, buscadores ni campos de texto libre/prompt nuevos. El `work_lot_label` (R9.4) y el `config` del wizard preexisten y NO se modifican acá. El `id`/`table`/`op`/`code` del store de rechazos provienen del `CrudEntry` de PowerSync y del errcode del server (no del usuario); el path e2e `consumeSyncRejectE2E` que los inyecta está gated fuera de prod (ver False positives descartados). Sin campo de entrada que validar.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit (sí/no/n.a.) | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `createSession` (arrancar jornada) | n.a. | per-establishment (scope) | sí (close-all antes del insert) | write local offline, sin costo server por request; sube como CRUD-plano sujeto a RLS. No es vector de amplificación. |
| `closeActiveSessions` (cierre masivo) | n.a. | per-establishment | sí | UPDATE masivo acotado al set de activas del propio tenant (típicamente 0-1). No es bulk fan-out atacable. |
| `recordUploadRejection` (store) | n.a. | in-memory, cap 50 | best-effort (no aplica fail-closed) | el cap 50 + dedup por id acota el crecimiento; in-memory, sin I/O server. No abusable. |

> Ninguna acción nueva manda email/SMS, pega a API externa, ni es bulk con fan-out por request. No se tocó `[auth.rate_limit]` de `config.toml`. N/A justificado.

## False positives descartados (trazabilidad)

- **`sync-rechazo-e2e.ts` `consumeSyncRejectE2E` como vector de inyección** — DESCARTADO. La inyección de un rechazo en el store solo ocurre si Playwright marcó `window.__RAFAQ_SYNC_REJECT_E2E__` vía `addInitScript` ANTES de cargar el bundle (`sync-rechazo-e2e.ts:31-54`). Ningún input de usuario ni ruta de UI puede setear esa global en prod/dev → siempre devuelve null → cero efecto. Mismo patrón gated ya vetado en Gate 2 previos (`maneuver-e2e-fault.ts`, `ble-e2e-flag.ts`). Aun si se disparara, solo inyecta un banner UI con `{id, table, op, code}` — NO escribe DB, NO cambia privilegios, NO persiste. No es superficie de ataque material.
- **`buildSessionByIdQuery` sin filtro de establishment como IDOR** — DESCARTADO. La lectura por `id` no es cross-tenant porque el SQLite local ya está scopeado por la stream `est_sessions` (un id ajeno no existe localmente). No hay clave attacker-controlled que alcance datos de otro tenant.
- **`recordUploadRejection` never-throw como exception-swallowing inseguro** — DESCARTADO. No salta ningún check de seguridad (la decisión de descartar ya ocurrió antes); es notificación pura. No cae en el patrón fail-open de `error-handling.md`.

## Findings MEDIUM (defensa en profundidad — NO bloquean)

- **MED-1 · Atomicidad close-all + insert no transaccional (race inter-proceso teórica)** — `createSession` (`sessions.ts:129-143`) ejecuta `closeActiveSessions` y luego el INSERT como DOS writes locales separados, no en una transacción única. En el modelo single-device/single-operator de R10.6 (un dispositivo = una maniobra, exclusión de scope consciente) esto es correcto y no explotable: no hay concurrencia real de dos `createSession` en vuelo. Si en el futuro hubiera dos procesos/tabs creando sesiones en paralelo sobre el mismo establishment, podría quedar >1 activa transitoriamente (el `buildActiveSessionQuery` LIMIT 1 ya lo tolera devolviendo la más reciente). Defensa en profundidad: envolver close-all + insert en una `writeTransaction` única, o un índice parcial UNIQUE server-side `(establishment_id) WHERE status='active'`. No es HIGH (no hay impacto de seguridad ni cross-tenant; el invariante es de negocio, no de authz). Documentado para backlog.

## Findings LOW (anexo)

- **LOW-1 · `console.warn` en prod** — `surfaceUploadRejection` (`connector.ts:193`) emite `console.warn` con `{table, op, code}` siempre (no gated por `__DEV__`). No filtra PII (sin opData), pero en prod agrega ruido. Cosmético.

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A — estos chunks no tocan Edge Functions.
- **RLS / triggers**: la skill de Sentry no evalúa políticas RLS de Postgres ni triggers server-side directamente. Se verificó MANUALMENTE que las queries nuevas se apoyan en la RLS existente (`sessions_update/insert = has_role_in`, `animal_profiles_update = has_role_in`) y en triggers ya vigentes (0047/0021/0050/0056) — sin schema nuevo en estos chunks (Gate 1 N/A confirmado).
- **PowerSync sync rules**: la skill no parsea `sync-streams/rafaq.yaml`. Se verificó MANUALMENTE que `est_sessions` y `est_animal_events` scopean por `establishment_id IN org_scope` → la frontera de tenant del SQLite local (paralela a RLS, dominio C1) está cubierta para las tablas que estos chunks leen/escriben.

## Requirements cubiertos

- **R10.5** (persistir sesión en curso + ofrecer retomar): `getActiveSession` + `buildActiveSessionQuery` + `ResumeJornadaCard` + `maniobra-resume.ts`. Scoping y read offline OK.
- **R10.6** (una sola sesión activa por dispositivo): `closeActiveSessions` en `createSession` (fail-closed, scopeado por establishment) + guard de carrera UI (`loading`). OK (MED-1 = atomicidad, no-bloqueante).
- **R10.8** (rechazo de sync visible, no en silencio): store observable sin opData + connector best-effort + banner/sheet con motivo es-AR genérico. Privacidad y dead-letter OK.
