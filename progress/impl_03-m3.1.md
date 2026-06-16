baseline_commit: 638679fa61672e884fc75b3ae94a855bf9853642

# impl — spec 03 (MODO MANIOBRAS) — chunk M3.1 (orquestador de escritura de eventos generalizado + aplicabilidad per-animal)

> Frontend puro sobre backend done (incl. `0091` ya APLICADA que gatea `deworming`/`treatment`). Gate 1 N/A.
> Solo la CAPA DE ESCRITURA + el mapeo + los "kinds" del dispatcher. NO se construyen las pantallas de paso (eso es M3.2).
> **NO marco done** — espera reviewer + Gate 2.

## Estado: DONE (técnico) — check.mjs RC=0

Feature 03 `in_progress`, spec aprobado (Puerta 1). M3.1 implementado y verde.

## Plan (T1..T8) — todas cerradas

- [x] T1 — `StepValue` (maneuver-sequence.ts) extendido a las 12 + `describeStepValue` es-AR.
- [x] T2 — builders SQL en `local-reads.ts` (write-paths nuevos + UPDATE de corrección) + tests node:sqlite.
- [x] T3 — `buildManeuverEventQueries` (array de writes, ramifica por `value.kind`, INSERT vs UPDATE).
- [x] T4 — `stepKindFor` con el StepKind real de cada maniobra (define kinds, NO componentes).
- [x] T5 — `MANEUVER_DATA_KEY_REQS` con `match` all/any (antiparasitario OR) + `antibiotico`.
- [x] T6 — `maneuver-applicability.ts` (R6.12 raspado solo machos + R6.8 CUT no terneros), puro.
- [x] T7 — orquestador `maneuver-events.ts` corre el array de writes (multi-write).
- [x] T8 — check.mjs RC=0; autorrevisión; reconciliación design/tasks; mapas abajo.

## baseline Gate 2
`638679fa61672e884fc75b3ae94a855bf9853642` (SHA previo a la 1ra task de M3.1).

## Archivos tocados
- `app/src/utils/maneuver-gating.ts` — `ManeuverKind` 10→12; `MANEUVER_DATA_KEY_REQS` (mapeo con `match` all/any); `MANEUVER_DATA_KEYS` derivado; `resolveManeuverGating` respeta all/any.
- `app/src/utils/maneuver-step-kind.ts` — `StepKind` real por maniobra (sin `placeholder`); `stepPersists`→true.
- `app/src/utils/maneuver-sequence.ts` — `StepValue` (unión discriminada de las 12) + `describeStepValue` es-AR.
- `app/src/utils/maneuver-event-query.ts` — `buildManeuverEventQueries` (array de writes) + compat `buildManeuverEventQuery`.
- `app/src/services/maneuver-events.ts` — `persistManeuverEvent` corre el array de writes (multi-write).
- `app/src/utils/maneuver-applicability.ts` — **NUEVO**, aplicabilidad per-animal pura (R6.12 + R6.8).
- `app/src/services/powersync/local-reads.ts` — 14 builders nuevos (INSERT con session_id + UPDATE de corrección + dientes/CUT).
- `app/src/utils/maneuver-wizard.ts` — 2 labels nuevos (Antiparasitario/Antibiótico).
- Tests: `maneuver-gating.test.ts`, `maneuver-step-kind.test.ts`, `maneuver-sequence.test.ts`, `maneuver-event-query.test.ts`, `maneuver-applicability.test.ts` (nuevo), `local-reads.test.ts`, `maneuver-wizard.test.ts` (comentario), `scripts/run-tests.mjs` (engancha el nuevo test).
- Specs reconciliadas: `tasks.md` (M3.1 `[x]` as-built + diferido a M3.2), `design.md` (§3 mapeo con `match`).
- `app/app/maniobra/carga.tsx` — M2.2: el dispatcher saca `case 'placeholder':` (StepKind retirado); las maniobras de StepKind real sin pantalla aún caen al PlaceholderStep por `default`.

## Mapa maniobra → tabla/evento → StepKind
| Maniobra | Tabla / evento (spec 02) | `session_id` | StepKind (M3.2 renderiza) | Writes |
|---|---|---|---|---|
| tacto | `reproductive_events` `tacto` + pregnancy_status | sí | `tacto` | 1 |
| tacto_vaquillona | `reproductive_events` `tacto_vaquillona` + heifer_fitness (0053) | sí | `vaquillona` | 1 |
| sangrado | `lab_samples` `blood` + tube_number | sí | `lab_single` | 1 |
| vacunacion | `sanitary_events` `vaccination` (N, una por vacuna) | sí | `silent_multi` | N |
| inseminacion | `reproductive_events` `service` `ai` (pajuela en notes) | sí | `inseminacion` | 1 |
| condicion_corporal | `condition_score_events` (1.00–5.00 step 0.25) | sí | `score` | 1 |
| dientes | **propiedad** `animal_profiles.teeth_state` (+ CUT) | NO (propiedad) | `dientes` | 1–2 |
| pesaje | `weight_events` | sí | `pesaje` | 1 |
| pesaje_ternero | `weight_events` | sí | `pesaje` | 1 |
| raspado | `lab_samples` ×2 (`scrape_tricho` + `scrape_campylo`) | sí | `lab_double` | 2 |
| **antiparasitario** | `sanitary_events` `deworming` (SIN route, D10) | sí | `silent_single` | 1 |
| **antibiotico** | `sanitary_events` `treatment` | sí | `silent_single` | 1 |

Gating capa 1 (R5.4): todas `match:'all'` salvo **antiparasitario = `match:'any'`** (OR de `antiparasitario_interno`/`antiparasitario_externo`, D10). Espeja la capa 2 (0091, `assert_any_data_key_enabled`).

## Servicios de spec 02 reusados vs creados
- **Reusados (camino CRUD-plano de spec 02 + M2.2):** `buildAddWeightInsert`/`buildAddTactoInsert` + sus `buildUpdateManeuver*` (M2.2, con session_id ya soportado); patrón de `buildAddConditionScoreInsert`/`buildAddServiceInsert`/`buildAddVaccinationInsert` (events.ts/spec 10) como molde; `runLocalWrite` (powersync). El espejo de categoría (`computeCategoryCode`/`resolveCastrationTargetCategory`, animal-category.ts) lo usará M3.2 para el preview offline (R8.4) + el category_id de CUT/revert — M3.1 NO lo invoca (deja el `cutCategoryId` como parámetro que M3.2 resuelve del catálogo).
- **Creados (no había builder as-built con session_id):** `buildAddManeuverSanitaryInsert`/`buildUpdateManeuverSanitary` (deworming/treatment), `buildAddManeuverVaccinationInsert` (vacunación de manga con session_id — el `buildAddVaccinationInsert` de spec 10 NO lleva session_id), `buildAddManeuverConditionScoreInsert`/`buildUpdateManeuverConditionScore`, `buildAddManeuverTactoVaquillonaInsert`/`buildUpdateManeuverTactoVaquillona`, `buildAddManeuverInseminationInsert`/`buildUpdateManeuverInsemination`, `buildAddManeuverLabSampleInsert`/`buildUpdateManeuverLabSample`, `buildSetTeethStateUpdate`, `buildSetCutUpdate`/`buildUnsetCutUpdate`. + módulo nuevo `maneuver-applicability.ts`.
- **Por qué builders nuevos (no reusar los de spec 02/10 tal cual):** los de la ficha (events.ts) y los de la masiva (spec 10) NO inyectan `session_id` (R5.11) y/o tienen otra firma; agregar el session_id a TODOS rompería sus call-sites. Los de manga son builders dedicados, mismo idiom CRUD-plano, con session_id en el INSERT.

## Mapa test → R
| R | Test(s) |
|---|---|
| R5.4 (mapeo) | maneuver-gating.test: "el mapeo MANEUVER_DATA_KEYS cubre las 12 maniobras" |
| R5.5 (omitir no-aplica) / R5.6 (required) | maneuver-gating.test: single-key/multi-key applies; required de enabled |
| R5.8/R5.11 (persiste con session_id) | maneuver-event-query.test: "toda 1ra captura de EVENTO lleva session_id"; cada rama; local-reads.test: cada builder con session_id |
| R5.9 (corrección no duplica) | maneuver-event-query.test: CORRECCIÓN → UPDATE mismo id (todas las ramas); local-reads.test node:sqlite: corrección score = 1 fila |
| R6.1 (vacunación multi) | maneuver-event-query.test: "vacunación 2 vacunas → 2 INSERT" + filtra vacíos |
| R6.2 (tacto) | maneuver-event-query.test: tacto vacía/preñada/corrección (M2.2, conservados) |
| R6.3/R5.13 (tacto vaquillona + heifer_fitness) | maneuver-event-query.test + local-reads.test: tacto_vaquillona + heifer_fitness |
| R6.4 (sangrado blood) | maneuver-event-query.test + local-reads.test: lab_samples blood |
| R6.5 (inseminación service ai) | maneuver-event-query.test + local-reads.test: service ai, pajuela en notes |
| R6.6 (condición corporal) | maneuver-event-query.test + local-reads.test: condition_score_events |
| R6.7 (dientes propiedad, NO evento) | maneuver-event-query.test: "dientes (sin CUT) → 1 UPDATE animal_profiles, SIN session_id, NO INSERT"; local-reads.test: buildSetTeethStateUpdate |
| R6.8 (prompt CUT + revert + no terneros) | maneuver-event-query.test: CUT/revert UPDATE; maneuver-applicability.test: shouldOfferCutPrompt (umbral + no terneros + null) |
| R6.9/R6.10 (pesaje) | maneuver-event-query.test: pesaje + pesaje_ternero (M2.2) |
| R6.11 (raspado 2 samples) | maneuver-event-query.test: "raspado → 2 INSERT lab_samples scrape_*" |
| R6.12 (raspado solo machos) | maneuver-applicability.test: appliesToAnimal/filterByAnimalApplicability (macho/hembra/sexo desconocido) |
| R6.13/R6.14 (antiparasitario deworming, OR, SIN route) | maneuver-event-query.test (deworming SIN route) + maneuver-gating.test (OR interno/externo) + node:sqlite (route NULL) |
| R6.15 (antibiótico treatment) | maneuver-event-query.test + maneuver-gating.test (single-key) |
| StepKind (dispatcher M3.2) | maneuver-step-kind.test: mapeo completo de las 12 + exhaustivo |
| describeStepValue es-AR (R5.9 resumen) | maneuver-sequence.test: vaquillona/score/sanitary/vaccination/inseminacion/lab/lab_double/dientes |

## Qué dejé EXPLÍCITO para M3.2 (las pantallas)
- Los **componentes** de cada StepKind: `silent_single` (1 producto + autocompletar), `silent_multi` (vacuna multi-chip), `lab_single`/`lab_double` (1/2 nº de tubo), `score` (selector 1.00–5.00 step 0.25), `vaquillona` (apta/no_apta/diferida), `inseminacion` (1 vs >1 pajuela, R6.5), `dientes` (selector + prompt CUT UI). El SEAM: `stepKindFor(maneuver)` → componente; el componente captura un `StepValue` → `persistManeuverEvent(...)`.
- **Tacto 2-pasos UI** (R6.2, design §6.bis.2) — el write-path ya produce un único evento; la UI de los 2 pasos es M3.2 (M2.2 ya tiene `TactoStep`).
- **Secuencia en orden de `config.maniobras`** (R5.14) + **omitir no-aplica por rodeo** (R5.5, ya en `buildSequence`) + **saltar por atributo** (R6.12, usar `appliesToAnimal`/`filterByAnimalApplicability` al armar la secuencia del animal).
- **`cutCategoryId`**: M3.2 resuelve el `category_id` de CUT (set) / la categoría derivada (revert) del catálogo local (`computeCategoryCode` + lookup code→id) y lo pasa a `persistManeuverEvent` en el `dientes` value; M3.1 dejó el parámetro y el fail-safe (sin id → solo teeth_state).
- **pesaje_ternero autocompletar categoría** (R6.10) vía `fetchMother`/`birth_calves` — UI/flujo de M3.2 (el write-path es weight_events).
- **Preview de transición offline** (R8.4) con `computeCategoryCode`/`resolveCastrationTargetCategory`.
- **Lote opcional** (R9.1/R9.2/R9.3) vía `assignAnimalToGroup` desde el wizard.
- **Label del timeline** (`humanizeSanitaryEventType`, event-timeline.ts): hoy `deworming`→"Desparasitación", `treatment`→"Tratamiento" (no rompe, el evento aparece en el timeline). Ajustar a "Antiparasitario"/"Antibiótico" si Raf lo prefiere — M3.2 (tied a la pantalla).
- **Correcciones multi-write** (vacunación multi / raspado): M3.2 las re-captura borrando+recargando (no hay UPDATE in-place de un set de N filas); el orquestador con `isCorrection` solo cubre las maniobras de 1 evento.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
- **(a) R no cubierto / a medias**: revisé R6.1–R6.15 + R5.4/5.5/5.6/5.8/5.9/5.11/5.12 contra el código → cada uno con write-path + test. R8.1/8.2/8.3 (transición por tacto) las dispara el trigger server-side del tacto reusado (M2.2) — nada que cablear en M3.1. R6.5 "1 vs >1 pajuela" y R6.6 "selector 1.00–5.00" son UI (M3.2); el write-path soporta cualquier valor del selector cerrado.
- **(b) edge cases / NULL / vacío / orden**: vacunación filtra productos vacíos (test); inseminación/lab `cleanNote` (vacío→null); `describeStepValue` tolera productos vacíos ("Aplicado"/"Aplicada"); dientes con `cut:true` SIN `cutCategoryId` → solo teeth_state (fail-safe, no fija categoría inválida — test); raspado/vacunación con ids derivados defensivos.
- **(c) seguridad**: `created_by`/`establishment_id` NUNCA en el payload (los fuerza el trigger); `session_id` del caller (no hardcodeado); gating capa 2 (0054+0091) + tenant-check (0056) re-validan al subir (verificado por la suite backend T2.4c verde). `assert_any_data_key_enabled` (0091) tiene EXECUTE revocado (no es trabajo de M3.1, backend done). dientes/CUT: el set (is_cut false→true) lo gatea el trigger; el revert (true→false) NO se gatea (D8) — coherente con `buildUnsetCutUpdate`.
- **(d) multi-tenant / offline**: CRUD-plano local → CrudEntry → upload; todo offline-first; el caller pasa profileId+sessionId del contexto. NUNCA establishment_id hardcodeado (anti-hardcode lint verde).
- **(e) tests que pasan por la razón equivocada**: 2 tests de EJECUCIÓN real con node:sqlite (no solo string-match): (1) el INSERT de deworming persiste con route NULL (prueba D10 de verdad); (2) corrección de score = 1 sola fila con el valor corregido (prueba que el split INSERT/UPDATE NO duplica, R5.9). El binding antiparasitario OR vs AND se prueba contrastándolo con el tacto multi-key (con UNO enabled la OR aplica, el AND no).
- **HALLAZGO cerrado**: al cambiar `StepKind` (quité `placeholder`), `carga.tsx` (M2.2) dejaba de typechequear (`case 'placeholder':`). Cerrado: el dispatcher de carga ahora cae al `default` (PlaceholderStep) para los StepKind sin pantalla. typecheck verde.
- **HALLAZGO cerrado**: `MANEUVER_DATA_KEYS` plano con `['antiparasitario_interno','antiparasitario_externo']` + el `.every()` de `resolveManeuverGating` habría dado AND (exigir ambos) = incorrecto (D10 = OR). Cerrado con el modo `match:'any'` y el `.some()` correspondiente; test dedicado contrasta OR vs AND.

## Reconciliación de specs (paso 9)
- `tasks.md`: M3.1 marcada `[x]` con bloque AS-BUILT (piezas + diferido a M3.2); el detalle original del plan se conservó como referencia. M3.2/M4 sin tocar.
- `design.md` §3: el bloque de `MANEUVER_DATA_KEYS` se reconcilió al as-built `MANEUVER_DATA_KEY_REQS` con `match` all/any (la nota previa "regla dedicada / shape lo cierra el implementer en M3" quedó resuelta = el modo `match`). El resto del design (§4/§4.bis/§6.bis) ya describía el comportamiento as-built (deworming OR, dientes/CUT, tacto 2-pasos) — no contradecía el código.
- requirements.md: sin cambios de *qué* (no se reconcilió ningún EARS — la implementación honra R6.1–R6.15 tal como están).

## check.mjs
RC=0 (run limpio): typecheck client + anti-hardcode (0 violaciones) + 207 unit de maniobras verdes (incl. los nuevos) + RLS/Edge/Animal/**Maneuvers `T2.4c` deworming/treatment**/operaciones-rodeo backend verdes. No hubo flake de rate-limit ni desalineamiento spec-12 en este run.

## NO done
Espera reviewer + Gate 2 (security code). M3.2 (las pantallas) es el siguiente chunk.
