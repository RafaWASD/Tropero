# Security Code Review (Gate 2, ADR-019) — Delta APTITUD REPRODUCTIVA (spec 02)

**Modo**: `code`. **Baseline**: `0d447cd` (registrado en `progress/impl_02-aptitud-reproductiva.md` línea 1; HEAD == baseline → todo el cambio está en el working tree).
**Skill**: `sentry-skills:security-review` corrida sobre `git diff 0d447cd` + checklist RAFAQ + catálogo de dominios.

## Veredicto: PASS — 0 HIGH, 0 MEDIUM

Superficie = display puro client-side (espejo del badge de estado reproductivo) + 1 fix de aplicabilidad client-side (UX) + 1 escritura (`tacto_vaquillona` del alta) que reusa el camino RLS existente de `addTacto`. **Backend intacto verificado**: `git diff 0d447cd -- supabase/` vacío (cero migración/RLS/trigger/RPC/Edge). El enum/columna `heifer_fitness` (0053) y la RLS+trigger de `reproductive_events` (0077) ya estaban aplicados — solo se LEEN/reusan.

## Findings HIGH de Sentry

Ninguno. La skill no identificó vulnerabilidades de alta confianza en las áreas de foco.

## Findings RAFAQ-SPECIFIC

Ninguno.

## Verificación de los 4 puntos de foco del prompt

### 1. `buildReproBadgeEventsQuery` (local-reads.ts:1013-1027) — sin fuga / sin injection — OK
- **Scoping por `profileIds`**: `WHERE animal_profile_id IN (${placeholders})` donde `placeholders = profileIds.map(() => '?').join(', ')` (línea 1014). El interpolado es la CANTIDAD de `?` (derivada del largo del array), nunca el contenido — los valores van por `args: [...profileIds, ...profileIds]` (parametrizados). No hay interpolación de input en el SQL.
- **`deleted_at IS NULL`**: presente en la rama synced (línea 1018). La rama overlay (`pending_reproductive_events`, local-only, nunca soft-deleteada) no lo filtra — consistente con `buildCategoryMirrorEventsQuery` (línea ~982) y el resto del archivo; el overlay solo porta `birth` optimistas.
- **`event_type IN (...)`**: `REPRO_BADGE_EVENT_TYPES` (línea 1006) es una constante literal de módulo (`'tacto','birth','abortion','service','tacto_vaquillona'`), no input de usuario.
- **Cross-tenant**: lee SQLite local ya scopeado por la sync stream `est_reproductive_events` (has_role_in). Los `profileIds` provienen de lecturas ya scopeadas (`computeReproStatuses` → `females.map(r => r.id)` de `fetchAnimals`/`searchAnimals`/`fetchAnimalDetail`, animals.ts:443/1052). Aun si un id fuera adversarial, la fila cross-tenant no existe en el SQLite local. Sin fuga.

### 2. Escritura del evento de aptitud del alta — mismo camino RLS que `addTacto`, sin bypass — OK
- `buildAddTactoVaquillonaInsert` (local-reads.ts:1515-1529): INSERT parametrizado con columnas `(id, animal_profile_id, event_type, event_date, heifer_fitness, created_at)`. `event_type` = literal `'tacto_vaquillona'`. **NO** setea `created_by`, `establishment_id` ni `session_id` — los FUERZA el trigger server-side 0077 (establishment_id desde el perfil) + `created_by` desde `auth.uid()`. El test (local-reads.test.ts) asserta `assert.doesNotMatch(q.sql, /has_role_in|establishment_id/)`.
- `addTactoVaquillona` (events.ts:386-397): espeja `addTacto` exacto — `runLocalWrite` (1 CrudEntry), sin `.select()`/RETURNING. La RLS `reproductive_events` (`with check has_role_in(establishment_of_profile(...))`) es la barrera real al subir; un rechazo lo maneja `uploadData`. Sin bypass, sin mass assignment (no hay spread de body del cliente).
- `crear-animal.tsx:546-549`: gateado a `showFitness` (vaquillona, línea 239) + `heiferFitness != null`; `fitness` viene del selector CERRADO `FITNESS_OPTIONS` (línea 1445, valores ∈ union `HeiferFitness = 'apta'|'no_apta'|'diferida'`); `eventDate = todayIso()`. Patrón soft-fail (un fallo no pierde el animal). Sin `establishment_id` desde cliente.

### 3. Espejo/badge display-only (cero writes) — OK
- `computeReproStatuses` / `loadReproBadgeEvents` (animals.ts:402-460): solo `runLocalQuery` (SELECT). Fail-safe (lectura fallida → Map vacío → `none`, sin crash). Delegan la decisión a `deriveReproStatus` (puro). No escriben overlay ni reconciliación. `ReproStatusChip` (AnimalRow.tsx) es no-tappable, display.
- `maneuver-applicability.ts` (`case 'inseminacion'`, línea 126-137): predicado PURO de UX (delega a `isReproApt`); cierra el `default: return true` que dejaba inseminar machos. Es barrera de cliente — el gating server-side (capa 2) sigue siendo la barrera real; no escribe nada.

### 4. Input adversarial al módulo puro `repro-status.ts` — sin crash / sin injection — OK
- Sin SQL/eval/red en el módulo. `ageInDaysFromBirthDate` (línea 267): regex `^\d{4}-\d{2}-\d{2}$`, range-check de mes/día, detección de overflow (ej. `2026-02-31` → null), futura → null. `toTimelineItems` (línea 187): un `eventType` fuera de enum cae al `default` ignorado de `deriveCurrentState`; `createdAt` null manejado (null-as-newest). Peor caso de un evento mal formado: se ignora o resuelve a `unknown`/`none` (display-only). Sin impacto de seguridad.

## False positives descartados (skill / scan)

- **`${placeholders}` y `${REPRO_BADGE_EVENT_TYPES}` en template strings de SQL** (local-reads.ts:1018, 1024): patrón `` `...${...}...` `` con keywords SQL → descartado. `placeholders` = secuencia de `?` (count, no contenido); `REPRO_BADGE_EVENT_TYPES` = constante literal de código. Cero input de usuario interpolado.
- **`` `Aptitud ${opt.label}` ``** (crear-animal.tsx:255): es un label de accesibilidad, no SQL.
- **Hits de `establishment_id`/`created_by` en el grep** (events.ts:789/810, local-reads.ts:1029, local-reads.test.ts:887): son COMENTARIOS que documentan "los fuerza el trigger" + una ASERCIÓN de test que verifica que el INSERT NO los contiene. Comportamiento correcto, no finding.
- **Hits de "secret/token/password"**: todos son design tokens de Tamagui (`$white`, `$primary`, `$amber`, `$terracota`), comentarios "cero hardcode: tokens", o notas de progreso. Sin secretos.

## Tabla de inputs (campos nuevos/modificados que el usuario tipea)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| Aptitud reproductiva (alta vaquillona) | selector CERRADO de 3 opciones (`apta`/`diferida`/`no_apta`) — no es texto libre | server: enum `heifer_fitness` (0053) re-valida al subir + RLS `with check has_role_in`; cliente: union `HeiferFitness` + gate `showFitness` | Sí |

No se agregaron campos de texto libre, buscadores ni prompts en este delta. La aptitud es un enum cerrado de 3 valores; `eventDate` es `todayIso()` (no tipeado).

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `addTactoVaquillona` (INSERT local `reproductive_events`) | n.a. | n.a. | n.a. | Escritura local-first (CRUD plano → CrudEntry → `uploadData`). No es Edge Function, no manda email/SMS, no pega a API externa, no es bulk. Mismo perfil de abuso que `addTacto`/`addService` (preexistentes). El sync sube por el connector autenticado; la RLS acota a perfiles del tenant. Sin vector de amplificación nuevo. |

Ninguna acción tocada por el diff manda email/SMS, pega a API externa, ni es bulk → no requiere rate limit propio. `[auth.rate_limit]` de `config.toml` NO se tocó (backend intacto).

## Catálogo de dominios RAFAQ — revisados / excluidos

**Revisados (aplicables):**
- **A1 (service-role bypass)**: no aplica — cero `createAdminClient()` en el diff (backend intacto).
- **A2 (mass assignment)**: OK — el INSERT del alta arma columnas explícitas, no spread de body del cliente.
- **A4 (function-level authz)**: OK — la RLS `reproductive_events` + trigger 0077 (sin cambios) son la barrera; el predicado `inseminacion` es UX de cliente.
- **B1 (information disclosure)**: OK — `addTactoVaquillona` devuelve `{ kind, message }` de un error de SQLite LOCAL (no error de servidor con datos sensibles), idéntico al patrón preexistente de `addTacto`. No expone PII/tenant.
- **B3 (over-fetching column-level)**: OK — `buildReproBadgeEventsQuery` proyecta solo columnas reproductivas no sensibles (sin email/phone).
- **C (offline/sync)**: OK — la escritura es offline-safe (éxito local, RLS al subir); las lecturas son 100% SQLite local ya scopeado por la stream. Sin sync rules nuevas.
- **F1 (PostgREST/SQL filter injection)**: OK — sin input de usuario concatenado en SQL; todo parametrizado o constante de código.

**Excluidos (no tocados por el diff):** A3 (IDOR por FK — sin lecturas de hijos nuevas), B2 (PII en logs — sin `console.*` agregado), D (secretos/supply chain — sin imports nuevos ni service_role), E (abuso a escala — sin endpoints de costo/bulk nuevos), F2/F3 (import/SSRF — sin ingesta de archivos ni `fetch()` a URL de usuario), G (BLE — el alta no toca el canal BLE en este delta), H/I (auth-session/compliance — sin cambios de auth/retención).

## Archivos analizados (diff vs 0d447cd)

- `app/src/utils/repro-status.ts` *(nuevo)* — módulo puro
- `app/src/services/powersync/local-reads.ts` — `buildReproBadgeEventsQuery` + `buildAddTactoVaquillonaInsert` + `is_cut` en LIST_SELECT
- `app/src/services/events.ts` — `addTactoVaquillona`
- `app/src/services/animals.ts` — `computeReproStatuses` / `loadReproBadgeEvents` + cableado SELECT
- `app/app/crear-animal.tsx` — prompt aptitud + write post-create soft-fail + `FITNESS_OPTIONS`
- `app/src/utils/maneuver-applicability.ts` — `case 'inseminacion'` (predicado UX)
- `app/app/maniobra/carga.tsx` — `toApplicabilityInfo` (deriva `aptitude`/`ageDays`)
- `app/app/animal/[id].tsx`, `app/app/(tabs)/animales.tsx`, `app/src/components/AnimalRow.tsx` — display/wiring
- Tests (`*.test.ts`, `e2e/animals.spec.ts`) y `scripts/run-tests.mjs` — excluidos del análisis de vulnerabilidad (regla skill); revisados para confirmar que NO debilitan controles (la aserción anti-`establishment_id` los refuerza).
- `specs/active/02-modelo-animal/tasks-aptitud-reproductiva.md` — doc.

## Cobertura indirecta (advertencia)

La skill de Sentry no cubre nativamente **SQLite local de PowerSync**, **RLS de Postgres** ni **Deno/Edge** — pero este delta NO toca ninguno server-side (backend intacto). La revisión de los query builders SQLite (parametrización, scoping por stream) y del camino RLS reusado se hizo **manualmente** y está cubierta arriba. Las sync rules de PowerSync (C1) no se modificaron en este delta.
