# Security Code Review (Gate 2) — Delta PARTO: RODEO + CARAVANA VISUAL DEL TERNERO (#4/#1a) — spec 02

**Modo**: `code` · **Baseline**: `e178851ba994759edb055aae2bd708a8ab423791` (uncommitted working tree) · **Fecha**: 2026-06-30

## Veredicto: PASS

No se identificaron findings HIGH-confidence. El delta es frontend-only, aditivo, y respeta el modelo de confianza server-autoritativo del RPC `register_birth` (ya deployado por #15). El cliente NO asume confianza: la UI filtra por tenant y el servidor re-valida.

---

## Alcance del diff (git diff desde baseline)

- `app/app/agregar-evento.tsx` — picker de rodeo del parto + campo idv single-calf + wiring a `registerBirth`.
- `app/app/animal/[id].tsx` — `goToAddEvent` agrega params `rodeoId`/`rodeoName` (seed/fallback del nombre).
- `app/src/services/events.ts` — **compartido con #15**: agrega `fetchMotherRodeoContext` (read local). `registerBirth` INTACTO.
- `app/src/utils/calf-birth.ts` (+`.test.ts`) — 5 helpers puros (sin RN, sin red).
- `app/e2e/*`, `scripts/run-tests.mjs` — tests/registro (fuera de superficie de ataque).

**`git diff supabase/` = vacío** (verificado committed + uncommitted). Frontend-only confirmado → **Gate 1 N/A este run**.

---

## Findings HIGH de Sentry

Ninguno. La skill `sentry-skills:security-review` corrió sobre el diff; tras trazar data flow + verificar exploitability, no hay patrón vulnerable con input attacker-controlled que llegue a un sink peligroso.

## Findings RAFAQ-SPECIFIC

Ninguno HIGH. Ver "Dominios revisados" abajo para la trazabilidad de cada control confirmado.

---

## Foco de seguridad del leader — resolución punto por punto

### 1. Multi-tenant / IDOR del rodeo del ternero — OK (defensa en profundidad correcta)

Cadena de confianza verificada de punta a punta:

- **UI solo ofrece rodeos del tenant activo**: `eligibleCalfRodeos(availableRodeos, motherSystemId)` filtra sobre `useRodeo().available` (`agregar-evento.tsx:236,262`). `RodeoContext` deriva `available` del establishment activo (`RodeoContext.tsx:65`), cuyo set sale de `auth.uid()` vía RLS (`EstablishmentContext.tsx:12`). El picker NO puede mostrar rodeos de otro tenant.
- **`system_id` global NO abre fuga**: el filtro por sistema (catálogo global) por sí solo no aislaría a la madre de otro campo; el guard `canEditCalfRodeo(eligible, motherRodeoId)` (`calf-birth.ts:59-62`) exige que el rodeo de la madre FIGURE entre los elegibles del campo activo. Madre de otro campo → `canEdit=false` → trigger estático no-editable (RPRC.1.8), sin ofrecer opciones. Testeado explícito (`calf-birth.test.ts`: "madre de OTRO campo → NO editable").
- **Servidor es la autoridad**: aun crafteando la llamada (bypass de UI), `effectiveCalfRodeoId` viaja como `p_calf_rodeo_id` y el RPC `register_birth` deriva el tenant de la fila REAL de la madre y rechaza cross-tenant/inactivo/otro-sistema con `23514`. El cliente no re-implementa esta validación — correcto.
- **Read local NO cruza tenants**: `fetchMotherRodeoContext` (`events.ts:279-289`) usa `buildBirthOverlayContextQuery` sobre `animal_profiles` (`local-reads.ts:453-462`), tabla cuyo scoping de tenant (`has_role_in`) ya lo aplicó la sync rule de PowerSync al sincronizar (`local-reads.ts:474-477`). Un `profileId` arbitrario de otro tenant NO está en la SQLite local → devuelve `null` → UI cae al fallback no-editable. Sin fuga.

Nota de defensa en profundidad (no-finding): el parto NORMAL ahora pasa `p_calf_rodeo_id = motherRodeoId` (antes lo omitía), por lo que el RPC lo valida con `23514` donde antes lo derivaba solo. Es comportamiento MÁS estricto y seguro, no una regresión. El overlay optimista offline refleja el rodeo pasado localmente en el device del propio usuario; un rechazo `23514` al subir hace rollback permanente (as-built `upload-classify`). No hay persistencia ni fuga cross-tenant.

### 2. Input del idv (caravana visual) — OK (límite + sanitización + validación server)

- **Límite + charset**: `sanitizeIdvInput` (`animal-input.ts:40-42`) filtra a solo dígitos (`\D` → ‘’) y acota a `IDV_MAX_LENGTH = 20`. Aplicado en vivo en `onChangeText` (`agregar-evento.tsx: onCalfIdv={(t) => setCalfIdv(sanitizeIdvInput(t))}`).
- **No llega crudo a nada peligroso**: el valor va como `p_calf_idv` a `registerBirth` → params de RPC vía PostgREST `rpc()` (parametrizado, no concatenado a SQL). No se interpola en `.or()/.filter()/ilike`, ni en prompt LLM, ni en HTML. Sin sink de inyección.
- **Autoridad server**: unicidad/inmutabilidad las valida `register_birth` con `23505`. El sanitizador cliente es UX (bypasseable), pero la validación autoritativa está server-side — correcto.

### 3. `events.ts` compartido — OK (aditivo, no debilita #15)

`git diff` sobre `events.ts` muestra SOLO la adición de `fetchMotherRodeoContext` (read-only, reusa el query existente, `emptyIsSyncing:false` = ausencia tolerable, no degrade). La firma y el cuerpo de `registerBirth`, `linkCalfToMother` y la idempotencia (`p_client_op_id`) quedan **idénticos**. Los params `p_calf_rodeo_id`/`p_calf_idv` siguen incluyéndose SOLO cuando se proveen (`events.ts:658-659`) → intents del parto normal/mellizos compatibles con lo ya encolado. Sin debilitamiento.

### 4. Offline / outbox — OK

Sin intent nuevo: reusa `register_birth` por la outbox. `calfRodeoId`/`calfIdv` viajan en el payload existente. Doble-submit cubierto por el guard `busyRef`/`useBusyWhileMounted` pre-existente del form (el delta no toca el gating del submit). El rechazo permanente offline (`23514`/`23505`) lo clasifica el `upload-classify` as-built.

### 5. Fuga de datos en leyenda/labels — OK

Labels del picker = nombres de rodeo de `useRodeo().available` (tenant activo, RLS-scoped) ?? `paramRodeoName` (rodeo propio de la madre que el usuario YA está viendo en su ficha) ?? "—". La leyenda "(Mismo rodeo que la madre)" no expone datos. Sin revelación cross-tenant.

---

## Tabla de inputs (campos que el usuario tipea, nuevos/modificados)

| campo | límite | validación | OK? |
|---|---|---|---|
| `calfIdv` (caravana visual del ternero, single-calf) | solo dígitos, máx 20 (`IDV_MAX_LENGTH`) vía `sanitizeIdvInput` en vivo | **server autoritativa** (`register_birth` → 23505 único/inmutable) + sanitizador cliente (UX) | Sí |
| `calfRodeoId` (selección del picker — NO texto libre) | enum cerrado = `eligibleRodeos` (tenant activo, mismo sistema) | **server autoritativa** (`register_birth` → 23514 activo/tenant/sistema) + guard UI `canEditCalfRodeo` | Sí |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `registerBirth` (submit parto) | n.a. | n.a. | n.a. | reusa intent existente por outbox; NO manda email/SMS, NO pega a API externa, NO es bulk. Doble-submit cubierto por `busyRef` (pre-existente). Sin superficie de abuso nueva. |
| `fetchMotherRodeoContext` | n.a. | n.a. | n.a. | read LOCAL de SQLite (offline), sin red. No hay endpoint remoto que rate-limitear. |

---

## False positives descartados (trazabilidad)

- **"Parto normal ahora manda `p_calf_rodeo_id` (antes lo omitía) → posible IDOR/DoS"**: descartado. El RPC re-valida el rodeo contra el tenant real de la madre (`23514`). Comportamiento más estricto, no un hueco. Fallo posible = la operación del propio usuario en su device, no un cruce de tenant ni una amplificación.
- **"`fetchMotherRodeoContext` con `profileId` arbitrario → IDOR read cross-tenant"**: descartado. La SQLite local solo contiene filas de tenants donde el user tiene rol (sync rules PowerSync). Un id foráneo devuelve `null`.
- **"`err.message` crudo en `fetchMotherRodeoContext` → information disclosure"**: descartado. Es un `ServiceResult` de un read LOCAL surfaceado en la MISMA app del usuario, no una respuesta a otro cliente. No cruza frontera de tenant.

---

## Archivos analizados

- `app/app/agregar-evento.tsx` (diff completo)
- `app/app/animal/[id].tsx` (diff completo)
- `app/src/services/events.ts` (diff + `registerBirth` full body :535-670)
- `app/src/utils/calf-birth.ts` (full)
- `app/src/services/powersync/local-reads.ts:453-483` (query + nota de scoping)
- `app/src/utils/animal-input.ts:14-42` (sanitizeIdvInput + topes)
- `app/src/contexts/RodeoContext.tsx` / `EstablishmentContext.tsx` (scoping de `available`)

## Dominios revisados (catálogo RAFAQ)

- **A. Authz de objeto/función**: A3 IDOR por FK (rodeo del ternero) — OK (UI tenant-scoped + RPC 23514). A2 mass assignment — OK (`params` armado campo-por-campo, whitelist; sin spread de body).
- **B. Exposición de datos**: B1 information disclosure — OK (read local, no cross-cliente). B3 over-fetching — OK (labels de rodeo del tenant activo).
- **C. Offline/sync**: C1 sync rules / read local — OK (SQLite solo con datos del tenant sincronizado). C4 stale-auth en replay — OK (RPC re-autoriza al subir; overlay optimista con rollback permanente).
- **F. Inyección/ingesta**: F1 filter injection — OK (idv va como param de RPC parametrizado, no a `.or()/ilike`).

## Dominios excluidos (justificación)

- **A1 service-role / A4 BFLA**: sin Edge Functions ni `createAdminClient()` en el diff (frontend-only).
- **D/E/G/H/I** (secretos, abuso a escala, BLE, sesión, compliance): sin cambios en esas superficies (sin secrets nuevos, sin nuevo endpoint costoso/bulk, sin BLE, sin auth/sesión, sin borrado/retención).

## Cobertura indirecta (advertencia)

La skill Sentry no cubre nativamente RLS/PowerSync sync rules ni la validación server del RPC `register_birth` (que vive en Postgres, fuera del diff frontend). Esos controles se verificaron **manualmente** por trazabilidad de código (scoping local + comentarios de sync + contrato del RPC documentado en `events.ts`/impl). El RPC `register_birth` 6-arg ya fue auditado/deployado en #15 y no cambia acá.
