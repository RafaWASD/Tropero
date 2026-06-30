# Security Gate 2 (modo code) — Delta #15 "VINCULAR LA CRÍA AL PIE" — FRONTEND (spec 02)

**Veredicto: PASS** (0 findings HIGH).

- **Scope:** SOLO el frontend del prompt UI. El backend (RPCs `link_calf_to_mother` / `register_birth` 6-arg + outbox/upload/events) ya pasó Gate 2 por separado (PASS, HIGH resuelto en migración 0116, commit 70c2efd) — NO re-auditado acá.
- **Baseline:** `a25e21f` (registrado en `progress/impl_cria-al-pie-alta-frontend.md`). Diff = working tree sin commitear.
- **Gate 1 (spec/migración): N/A** — `git diff supabase/` y `git status --porcelain supabase/` VACÍOS. Este run no toca migraciones ni Edge Functions. Frontend puro.
- **Skill `sentry-skills:security-review`:** corrida sobre el diff (foco RN/TS, injection, authorization, data-protection). 0 findings HIGH/Critical tras trazar data-flow.

## Archivos analizados
- `app/src/components/LinkCalfPrompt.tsx` (NUEVO, 845 líneas) — prompt saltable, máquina de 3 fases.
- `app/src/utils/link-calf-query.ts` (NUEVO) — clasificador PURO del identificador.
- `app/app/crear-animal.tsx` (MOD) — wiring (`linkPromptMotherId`, `navigateAfterCreate`, montaje del prompt).
- `app/src/components/index.ts` (MOD) — export del barrel (trivial).
- `scripts/run-tests.mjs` (MOD) — registro de `link-calf-query.test.ts` (trivial).
- `app/e2e/animals.spec.ts` (MOD) — 5 tests nuevos + 1 editado.

Dependencias de servicio LEÍDAS para trazar el data-flow (no modificadas en este run, ya auditadas):
`app/src/services/animals.ts` (`lookupByTag`, `searchAnimals`), `app/src/services/events.ts` (`fetchMother`, `linkCalfToMother`, `registerBirth`), `app/src/services/powersync/local-reads.ts` (query builders), `app/src/utils/animal-input.ts` (`sanitizeIdvInput`), `app/src/utils/animal-birth-year.ts` (`sanitizeBirthYearInput`, `sanitizeDayMonthInput`, `validateBirthDate`).

## Findings HIGH
Ninguno.

## Validación de los 5 focos del brief (todos OK)

### 1. Validación de input — "caravana del ternero" (texto libre numérico)
Cadena de validación trazada, defensa en profundidad + autoridad server-side:
- **UX/captura** (`LinkCalfPrompt.tsx:455-459`): `onChangeText` → `sanitizeIdvInput(t)` → `replace(/\D/g,'').slice(0, IDV_MAX_LENGTH)` → **solo dígitos, tope 20** (`animal-input.ts:40-42`). `keyboardType="number-pad"`.
- **Clasificación** (`link-calf-query.ts:43-49`): `classifyCalfQuery` exige `/^\d+$/` y `≥ CALF_MIN_DIGITS (3)`; `=15` → `eid`, resto → `idv`. Vacío/`<3`/no-numérico → `empty`/`too-short` → error inline, NO dispara el find-or-create. Re-chequea numericidad por si un paste mete letras (degrada a `too-short`).
- **Lo que fluye a las queries es dígito-puro, 3–20 chars.** No hay camino para que llegue basura/payload al lookup ni a la RPC.
- **Autoridad server-side:** el cliente NO pasa `establishment_id`; las RPCs derivan tenant de filas reales (confirmado en el run backend). El frontend no abre bypass.

### 2. Injection (identificador → SQLite local)
Sin riesgo: las queries locales son **parametrizadas** (`buildSearchByTagQuery`/`buildSearchByIdvQuery`/`buildLookupTagAcrossFieldsQuery` usan placeholders `?` + `args:[tag]`, `local-reads.ts:791-839`). El substring usa `LIKE ? ESCAPE '\'` con `escapeLike()` neutralizando `% _ \` y el nombre de columna es **whitelist** del service (no input de usuario, `local-reads.ts:848-863`). Sumado a que el término ya es dígito-puro, doble defensa.

### 3. Multi-tenant / IDOR (lado cliente)
- `searchAnimals(establishmentId, …)` scopeado al **establishment ACTIVO** (viene del `RodeoContext`/props, nunca hardcodeado; `LinkCalfPrompt.tsx:70-71,247,262`).
- `lookupByTag` rama 1 scopeada al campo activo; rama cross-campo (`buildLookupTagAcrossFieldsQuery`, sin filtro de `establishment_id`) lee SOLO de la SQLite local = únicamente tenants donde el usuario tiene rol (sync rules / RLS). El modo `transfer` (otro campo) **BLOQUEA el vínculo** con aviso, no vincula (`LinkCalfPrompt.tsx:230-236`).
- `linkCalfToMother`/`registerBirth` mandan SOLO `profileIds` + fecha (+ rodeo/idv opcionales); la RPC deriva el tenant de la fila real de la madre + `has_role_in` y rebota cross-tenant (23503/23514/42501). `events.ts:650-652`.
- Solo se puede vincular un ternero del **campo activo** a una madre del **campo activo** = mismo tenant.

### 4. Rodeo picker
`calfRodeoOptions` = `rodeos.filter(r => motherSystemId != null && r.systemId === motherSystemId)` (`LinkCalfPrompt.tsx:122-125`) — solo rodeos del campo activo del MISMO SISTEMA que la madre. Default = `motherRodeoId`. Aunque un cliente manipulado mandara un `calfRodeoId` ajeno, la RPC re-valida (activo + tenant de la madre + mismo sistema → 23514). El cliente NO asume confianza: comentario explícito en `events.ts:577-579` y `LinkCalfPrompt.tsx:347-348`.

### 5. Offline / outbox — doble-submit e idempotencia
- **`busyRef` (ref síncrono)** chequeado al entrar a `onSearch`/`onConfirmLink`/`onConfirmCreate` (`LinkCalfPrompt.tsx:198,308,330`) y seteado ANTES del `await` → bloquea re-entrada en el mismo tick (más robusto que el state `busy`). Botones además `disabled={busy}`. Backdrop y "Ahora no" ignoran el tap si `busyRef.current` (`:178,587`).
- Tras éxito: `onLinked()` → `finishLinkPrompt` → `linkPromptMotherId=null` → `open=false` → desmonta. Sin ventana de doble-encolado.
- **`client_op_id`** lo inyecta `uploadData` (idempotencia ya auditada en el run backend). FIFO garantizado por el orden de UI (la madre se encola antes que el vínculo).

### 6. Fuga cross-tenant en avisos
Los 3 avisos son **strings estáticos** sin datos de animales: "ya tiene madre" (`:298`), "otro campo" (`:234`, NO nombra el establishment aunque `lookupByTag` lo traiga en el value), "varios" (`:281`). `fetchMother` lee LOCAL (solo tenants del usuario). Cero leak de un tenant donde el usuario no tiene rol.

## Tabla de inputs (campos que el usuario tipea)
| campo | límite | validación | OK? |
|-------|--------|------------|-----|
| Caravana del ternero | dígitos, ≤20 (`sanitizeIdvInput`); clasif. ≥3 y =15/≠15 | server-autoritativa (RPC deriva tenant) + cliente (sanitize+classify) + queries parametrizadas | ✅ |
| Año de nacimiento (opc.) | dígitos, ≤4 (`sanitizeBirthYearInput`) | `validateBirthDate` (rango); no fluye crudo | ✅ |
| Día/mes (opc.) | dígitos, ≤4 → DD/MM (`sanitizeDayMonthInput`) | `validateBirthDate` (rango/calendario) | ✅ |
| Sexo del ternero | enum cerrado `male`/`female` (no tipeable) | requerido inline (`:335`) | ✅ |
| Rodeo del ternero | picker cerrado, filtrado a `motherSystemId` (no tipeable) | RPC re-valida tenant+sistema | ✅ |

## Tabla de rate limits (acciones abusables tocadas por el diff)
| acción | rate limit | keyeo | fail-closed? | nota |
|--------|-----------|-------|--------------|------|
| `lookupByTag`/`searchAnimals` (find-or-create) | n.a. | — | — | lectura LOCAL SQLite (PowerSync), no pega al server; LIMIT 20 en las queries acota el N. Sin vector de abuso server-side. |
| `linkCalfToMother`/`registerBirth` (encolado outbox) | n.a. (en este diff) | per-user/tenant en la RPC al subir | sí (RPC rebota 23503/23514/42501) | offline-first: encola local; el `uploadData` (backend, ya auditado) sube 1 intent por op con `client_op_id`. `busyRef` evita doble-encolado en UI. No es email/SMS/API-externa ni bulk. |

## Cobertura indirecta / no cubierto por la skill
- **PowerSync sync rules / RLS local:** la skill no las inspecciona (no son TS del diff). El aislamiento cross-campo de la rama `transfer` y de las lecturas LOCAL depende de que las sync rules/RLS solo repliquen tenants del usuario — **verificado por inspección manual del flujo** (la SQLite local nunca contiene tenants ajenos por construcción del stack). Sin cambios de sync rules en este run.
- **Deno/Edge Functions:** N/A (no tocadas).

## False positives descartados
- **`setActionError(r.error.message || …)`** (`LinkCalfPrompt.tsx:365`, camino CREATE) — NO es information disclosure (B1). `registerBirth` es offline-first: su `r.error.message` proviene de errores LOCALES (lectura de contexto de la madre en SQLite o fallo de encolado), NO de un mensaje de error crudo del servidor/DB. El rechazo REAL de la RPC (23514/23503/42501) ocurre asíncronamente en `uploadData` (clasificado `permanent_reject`), no en este return. No filtra esquema ni datos cross-tenant. Los otros dos handlers (`onConfirmLink:319`, `onSearch` OFFLINE_LOOKUP_COPY) usan mensajes genéricos. Severidad real: LOW (defense-in-depth) — no se reporta.
- **`user.password` en `animals.spec.ts:220`** — fixture de test (no secreto hardcodeado); el seed de "ya tiene madre" usa la RPC REAL autenticada (`link_calf_to_mother`, `:222`) porque `service_role` no puede insertar `birth_calves` directo (confirma RCAP.6.10). Test code, no se flaggea.
