# impl 10 — frontend Fase 3 (services + hooks) — T-CL.8 … T-CL.13

baseline_commit: 95e3177be928ea40165443f16bd9c0cdadf212e9

> Feature: spec 10 (operaciones-rodeo). Chunk: **SOLO Fase 3** (services + hooks PowerSync as-built de
> spec 15). El backend (Fase 1, 0084/0085/0086) y la Fase 2 (utils puros, T-CL.1…T-CL.7) ya están
> done+gateado (Fase 1 commiteado; Fase 2 en working tree, esperando reviewer). NO se toca Fase 4 (UI).
>
> El baseline_commit es el MISMO que la corrida de Fase 2 (feature multi-sesión; el SHA previo a la
> primera task de la feature-frontend; NO se sobreescribe — feature 10 es spec_ready con Puerta 1
> aprobada, Gate 1 PASS, delta backend ≥0084 aplicado; el leader coordina el pipeline multi-sesión).

## Estado: FASE 3 COMPLETA (T-CL.8…T-CL.13) — esperando reviewer + Gate 2. NO marqué la feature done.

## Plan (tasks de esta corrida)

Fase 3 — services + hooks (PowerSync as-built; tests = builders puros + planner puro):
- [x] T-CL.8 `bulk-operations.ts` — genera/encola N mutaciones locales en batches; castración = 2 CrudEntries/animal
- [x] T-CL.9 `bulk-operations.ts` — progreso "X de N" + rechazos por animal (canal status/error de uploadData)
- [x] T-CL.10 test — fallo de sync a mitad ⇒ exitosas persisten, fallidas reportadas; re-intento NO duplica
- [x] T-CL.11 `animals.ts` — setCastrated (+future_bull=0 + observación simétrica) + setFutureBull (sin obs)
- [x] T-CL.12 `powersync/schema.ts` — declarar is_castrated + future_bull en animal_profiles local; completar cableado T-CL.7
- [x] T-CL.13 tests de la observación automática (simétrica, sin author_id, N obs + N updates, setFutureBull sin obs)

## Arquitectura (split as-built: puro testeable + thin service)

Los services (`bulk-operations.ts`, las funciones nuevas de `animals.ts`) importan el SDK (vía
`local-query`→`database`) + `react-native` (`InteractionManager`) → NO pueden correr bajo `node:test`. Por
eso la LÓGICA load-bearing vive en módulos PUROS testeables y el service es un wrapper de I/O — mismo
patrón canónico del repo (`event-timeline.ts`↔`events.ts`, `upload.ts`↔`connector.ts`):
- `app/src/utils/bulk-operations-plan.ts` (NUEVO): `planVaccination`/`planWeaning`/`planCastration`
  (decide qué statements por animal: 1 evento / 2 castración, idempotencia, batches) + `drainBulkPlan`
  (drenado independiente con writer + yield INYECTADOS, progreso + rechazos por animal).
- `app/src/utils/castration-copy.ts` (NUEVO): fuente única del copy simétrico R13.7.
- Builders nuevos en `local-reads.ts` (todos PUROS, testeados): `buildAddVaccinationInsert`,
  `buildAddWeaningInsert`, `buildSetCastratedUpdate`, `buildSetFutureBullUpdate`,
  `buildExisting{Vaccination,Weaning}IdsQuery`, `buildProfileEstablishment{,s}Query`.

## Archivos tocados

NUEVOS:
- `app/src/utils/bulk-operations-plan.ts` + `.test.ts` (planner + drenado puro; 17 tests)
- `app/src/utils/castration-copy.ts` + `.test.ts` (copy simétrico; 3 tests)
- `app/src/services/bulk-operations.ts` (service: 3 ops + drainPlan, wrapper de I/O — NO en node:test)

EDIT:
- `app/src/services/powersync/schema.ts` — `is_castrated` + `future_bull` en `animal_profiles` (T-CL.12).
- `app/src/services/powersync/local-reads.ts` — 8 builders nuevos + proyección de `is_castrated`/
  `future_bull` en `LOCAL_LIST_SELECT`/`LOCAL_LIST_SELECT_OVERLAY`/detail (synced+overlay).
- `app/src/services/powersync/local-reads.test.ts` — +14 tests (builders nuevos, ejecución real SQLite,
  author_id omitido, proyección de columnas en lista/detalle).
- `app/src/services/powersync/schema.test.ts` — GUARD `animal_profiles` += is_castrated/future_bull + test dedicado.
- `app/src/services/animals.ts` — `setCastrated`/`setFutureBull` (T-CL.11); `AnimalDetail.isCastrated`/
  `futureBull`; cableado del `is_castrated` REAL en `computeMirrorOverrides` (T-CL.12 completa T-CL.7).
- `scripts/run-tests.mjs` — engancha `bulk-operations-plan.test.ts` + `castration-copy.test.ts`.
- `specs/active/10-operaciones-rodeo/{tasks,design}.md` — T-CL.8..13 `[x]` + notas AS-BUILT + reconciliación.

## Mapa R<n> → archivo:test

| R<n> | test concreto |
|---|---|
| R3.1 (vacunación = 1 INSERT/animal, id UUIDv5, pre-config) | `bulk-operations-plan.test.ts` → "R3.1/R6.1: vacunación = 1 INSERT…" + `local-reads.test.ts` → "T-CL.8 / R3.1: buildAddVaccinationInsert…" |
| R3.2 / R3.5 (destete = 1 weaning/ternero, mellizos c/u) | `bulk-operations-plan.test.ts` → "R3.2/R3.5: destete…" + `local-reads.test.ts` → "T-CL.8 / R3.2: buildAddWeaningInsert…" |
| R3.3 / R3.4 (castración = N UPDATEs estado, 2 CrudEntries) | `bulk-operations-plan.test.ts` → "R3.3/R13.7: castración = SIEMPRE 2 statements…" |
| R6.1 (id UUIDv5 evento; castración semántica) | `bulk-operations-plan.test.ts` → "R3.1/R6.1…" + "castración: re-aplicar NO duplica por SEMÁNTICA…" |
| R6.3 (re-ejecución no duplica) | `bulk-operations-plan.test.ts` → "R6.3: re-ejecutar… ⇒ 0 nuevas" + "T-CL.10 / R6.3: …drenado vacío" + `local-reads.test.ts` → "buildExisting{Vaccination,Weaning}IdsQuery" |
| R10.2 (independientes, sin rollback) | `bulk-operations-plan.test.ts` → "T-CL.10 / R10.2: fallo a mitad…" + "…la observación (2da CrudEntry) falla…" |
| R10.3 (rechazo por animal) | `bulk-operations-plan.test.ts` → "T-CL.10 / R10.2: …se reporta POR ANIMAL" (drenado local; el de sync = uploadData as-built) |
| R10.4 (progreso X de N) | `bulk-operations-plan.test.ts` → "T-CL.9 / R10.4: el progreso reporta X de N" |
| R10.5 (batches sin bloquear UI) | `bulk-operations-plan.test.ts` → "R10.5: el plan se parte en batches…" + "batchSize default = ~100" |
| R10.6 / R13.6 (espejo con is_castrated real offline) | `animal-category.test.ts` (T-CL.7, 75/75) + el cableado de `computeMirrorOverrides` (T-CL.12) proyecta el real → precedencia |
| R12.1 / R13.3 (columnas declaradas) | `schema.test.ts` → "spec 10 (T-CL.12…): animal_profiles declara is_castrated + future_bull" + GUARD |
| R12.2 (setFutureBull, sin obs) | `local-reads.test.ts` → "T-CL.11 / R12.2: buildSetFutureBullUpdate — solo future_bull, sin is_castrated" |
| R12.4 (auto-clear future_bull al castrar) | `local-reads.test.ts` → "T-CL.11 / R3.3+R12.4: buildSetCastratedUpdate(true) — is_castrated=1 Y future_bull=0" + SQLite exec |
| R13.1 / R13.4 (setCastrated ficha, statements) | `local-reads.test.ts` → "T-CL.11 / R13.4: buildSetCastratedUpdate(false) — solo is_castrated=0" + SQLite exec |
| R13.7 (a) (observación "Castrado", sin author_id, establishment del perfil) | `castration-copy.test.ts` → "castrar ⇒ Castrado" + `local-reads.test.ts` → "T-CL.13 / R13.7: …NUNCA manda author_id" + `bulk-operations-plan.test.ts` → "T-CL.13 (d): …" (author_id NULL, est del perfil) |
| R13.7 (b) (revert simétrico) | `castration-copy.test.ts` → "revertir ⇒ Corrección…" + "textos DISTINTOS" |
| R13.7 (c) (observación en timeline local offline) | `bulk-operations-plan.test.ts` → "T-CL.13 (d): …N observaciones queryables (animal_events)" (misma tabla que `buildTimelineQuery`/`fetchTimeline`, `deleted_at IS NULL`) |
| R13.7 (d) (masiva N ⇒ N obs + N updates) | `bulk-operations-plan.test.ts` → "T-CL.13 (d): masiva de N ⇒ exactamente N UPDATEs + N observaciones" |
| R13.7 (e) (setFutureBull NO observación) | `local-reads.test.ts` → "T-CL.11 / R12.2: …sin is_castrated" (no toca animal_events; el service setFutureBull = 1 solo runLocalWrite) |

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre mi propio trabajo. Qué busqué y qué encontré:

1. **author_id NUNCA en el payload (invariante de seguridad DURA, SEC-SPEC-03).** Verificado en el SQL
   real: `buildAddObservationInsert` = `INSERT INTO animal_events (id, animal_profile_id,
   establishment_id, event_type, text)` — sin `author_id`. Es el ÚNICO builder de la observación, usado
   por `setCastrated` Y `applyBulkCastration`. Test explícito (`local-reads.test.ts`) + aserción
   `author_id IS NULL` contra SQLite en la masiva de N (`bulk-operations-plan.test.ts`). También chequeé
   vacunación/destete: tampoco mandan author_id/created_by/establishment_id (los fuerza el trigger). ✓
2. **establishment_id de la observación = el del PERFIL (no inventado).** `setCastrated` lo resuelve por
   `buildProfileEstablishmentQuery(profileId)`; la masiva por `buildProfileEstablishmentsQuery` (batched).
   NUNCA del contexto activo. El planner OMITE un perfil cuyo establishment no resuelve (defensivo —
   evita un 23514 al subir). Tests: "est del perfil p-1=est-A, p-2=est-B" + "perfil sin establishment se
   OMITE". ✓
3. **Castración SIEMPRE 2 CrudEntries (UPDATE + observación).** `planCastration` empuja
   `[buildCastration, buildObservation]` por animal; `totalStatements == 2×N`. `setCastrated` hace 2
   `runLocalWrite`. Tests: "= SIEMPRE 2 statements" + "totalStatements = 2/animal × 150 = 300". ✓
4. **Revert genera la observación simétrica.** `setCastrated(false)` encadena la observación con
   `castrationObservationText(false)` = "Corrección: marcado como no castrado". (La masiva nunca revierte
   — `planCastration` hardcodea value=true; el revert es ficha-only, correcto por design.) Tests del copy
   simétrico. ✓
5. **setFutureBull NO genera observación.** El service hace UN solo `runLocalWrite(buildSetFutureBullUpdate)`
   — no toca `animal_events` ni `is_castrated`. Test: el statement solo menciona `future_bull`. ✓
6. **is_castrated=true ⇒ future_bull=0 (auto-clear, R12.4); revert NO toca future_bull (R13.4).**
   `buildSetCastratedUpdate(true)` = `SET is_castrated=1, future_bull=0`; `(false)` = `SET is_castrated=0`
   (sin future_bull). Verificado con ejecución REAL contra SQLite in-memory (no solo string-match): castrar
   ⇒ 1/0, re-castrar ⇒ no-op (sigue 1), revertir ⇒ 0. ✓
7. **El schema declara las 2 columnas y el espejo de T-CL.7 ahora resuelve con el REAL.** Declaradas en
   `schema.ts`; GUARD actualizado (sin esto, PowerSync no las materializa → "no such column" en vivo —
   el bug que el GUARD justamente previene). `computeMirrorOverrides` pasa `r.is_castrated == null ?
   undefined : toBool(r.is_castrated)` → un `false` REAL (animal entero) tiene precedencia sobre la
   inferencia; solo una fila que no proyecte la columna cae al fallback. Revisé los 3 call-sites
   (`fetchAnimals`/`searchAnimals`/`fetchAnimalDetail`) — TODOS proyectan `is_castrated` ahora (lista,
   búsqueda vía `buildSearchUnion`→`LOCAL_LIST_SELECT`, detalle). Cero fila se queda sin el real por
   accidente. Los 75/75 tests C6 de `animal-category.test.ts` siguen verdes (precedencia + fallback). ✓
8. **Idempotencia evita duplicados en re-ejecución.** `planEventOperation` filtra las claves ya presentes
   (`filterNewEventKeys` contra `buildExisting*IdsQuery` local) → re-ejecutar con los ids presentes ⇒ plan
   vacío ⇒ drenado sin writes. Tests: "0 nuevas" + "drenado vacío (0 writes)" + "uno ya aplicado ⇒ solo el
   otro". La castración no usa idempotencia de evento (estado absoluto; los ya castrados ni son candidatos
   — bulk-candidates; el guard IS DISTINCT FROM hace el re-UPDATE no-op server-side). ✓
9. **NO toqué el connector.** Verifiqué `connector.ts`: `PATCH` (UPDATE de `animal_profiles`) →
   `supabase.from(table).update(opData).eq('id', op.id)`; `PUT` (INSERT de `animal_events`) →
   `upsert`. Ambos son CRUD plano de tablas SINCRONIZADAS → CrudEntry plana → suben sin cambios. La
   castración NO necesita op_type nuevo (no es RPC-bound). El connector quedó intacto. ✓
10. **Fallo de sync a mitad / independencia (R10.2).** `drainBulkPlan` con writer que falla en p-2 ⇒ p-1/p-3
    encolan (sin rollback), p-2 reportado por animal. Castración con la observación (2da CrudEntry)
    fallando ⇒ el UPDATE NO se re-ejecuta (break) + animal reportado. (El fallo de SYNC real es el camino
    as-built de uploadData, ya testeado en spec 15 — Fase 3 solo devuelve el plan para mapear el rechazo
    al animal en la UI de Fase 4.) ✓
11. **Tests que pasan por la razón equivocada.** Revisé que el SQLite-backed test de castración ejerza el
    path real (INSERT a `animal_events` con la MISMA forma de columnas que `buildAddObservationInsert`, sin
    author_id) y verifique la columna, no solo que "no crashea". El test de fallo-a-mitad discrimina por
    `args[1]` (el profileId real del statement) — falla si la independencia se rompe. ✓

Nada quedó abierto: todo lo que encontré ya estaba cubierto o lo cerré antes de reportar.

## Reconciliación de specs (paso 9)

El as-built sigue el design en lo esencial. Precisiones de implementación reconciliadas en
`tasks.md` (notas AS-BUILT bajo cada T-CL) + `design.md`:

1. **Split planner puro / thin service** (`bulk-operations-plan.ts` + `castration-copy.ts` NUEVOS):
   el design §1.1 nombraba `bulk-operations.ts` como el service; el as-built extrae la lógica
   load-bearing a módulos PUROS (testeables sin SDK — el service importa `react-native`/SDK y no corre en
   `node:test`). Mismo patrón canónico del repo. Reconciliado en `design.md §1.1` (2 filas AS-BUILT) +
   `tasks.md` T-CL.8. NO cambia el *qué* de ningún R<n> — es el reparto puro/I-O del propio diseño.
2. **Builders en `local-reads.ts`** (vacunación/destete/castración/futuro-torito/existing-ids/establishment):
   el design ya decía "eventos vía patrón `events.ts`" — el patrón as-built es que la sentencia SQL vive en
   un builder puro de `local-reads.ts` y el service la ejecuta con `runLocalWrite`. Reconciliado en `tasks.md`.
3. **T-CL.12 proyección + cableado**: el design §4.4 pedía "declarar las columnas" + "pasar el is_castrated
   real al espejo". As-built: además de declararlas, los SELECT de lista/detalle/búsqueda las PROYECTAN
   (sin esto la columna se materializa pero los builders no la leen) y `AnimalDetail` las expone (para la
   ficha de Fase 4). Reconciliado en `design.md §4.4` (nota AS-BUILT). No cambia el *qué*.

No hay contradicción spec↔código pendiente.

## Verificación

- `cd app && pnpm.cmd typecheck` → VERDE (0 errores).
- `node scripts/check.mjs` → **exit 0**. Todas las suites verdes: typecheck + client unit (192 tests, con
  las 2 suites nuevas + local-reads/schema/animal-category tocadas) + RLS + Edge + Animal + Maneuvers +
  user_private + Import + Sync-streams + **Operaciones-rodeo Fase 1 (22/22)** — sin flake en esta corrida.
- Suites nuevas/tocadas: bulk-operations-plan 17/17, castration-copy 3/3, local-reads (+14 nuevos),
  schema (+1 dedicado + GUARD), animal-category 75/75 (C6 intacto).

## Confirmación de invariantes de seguridad (para Gate 2)

- **author_id NUNCA en el payload del cliente** — `buildAddObservationInsert` (único builder de la
  observación) no lo incluye; lo fuerza el trigger 0034 al subir. Verificado en string + ejecución SQLite.
- **establishment_id de la observación = el del PERFIL** — resuelto por `buildProfileEstablishment{,s}Query`,
  nunca del contexto activo; el planner omite el perfil que no lo resuelve (evita 23514).
- **2 CrudEntries por animal en castración** (UPDATE animal_profiles + INSERT animal_events), INDEPENDIENTES
  (sin transacción, R10.2). El connector NO se tocó (CRUD plano as-built; PATCH/PUT genéricos).
- **`is_castrated` editable, no forzado** — el UPDATE es el write-path offline (0084 §4.2 hace el
  write-through server-side); el cliente nunca escribe `animals` directo.

## Riesgos / notas para el reviewer

- **Tests del service `bulk-operations.ts` + `setCastrated`/`setFutureBull` son INDIRECTOS** (importan
  SDK/RN → no `node:test`). La cobertura es: el planner puro (`drainBulkPlan` + plan*) + los builders
  puros (`local-reads`) + el copy puro. El service es un wrapper delgado y determinístico sobre esas
  piezas (resolver ids/establishments → plan → drain). Si el reviewer quiere cobertura del wrapper, el
  E2E de Fase 4 (T-UI.9/10/11, Playwright) lo ejercita end-to-end contra la DB beta.
- **`InteractionManager.runAfterInteractions` entre batches**: en web/test resuelve en el próximo tick;
  `yieldToUi` es tolerante (si InteractionManager no está, resuelve igual). No bloquea ni cuelga.
- **Pendiente Fase 4 (UI)** — NO en este chunk: pantallas de selección/preview/progreso, ficha
  "Castrado Sí/No" + toggle ⭐, vista de grupo, E2E. Los services/utils de Fase 3 son los que la UI
  CONSUME. La estética + el design system pasan por el skill design-review (ADR-023).
