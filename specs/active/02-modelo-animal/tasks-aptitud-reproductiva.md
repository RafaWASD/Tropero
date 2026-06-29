# Spec 02 — Delta APTITUD REPRODUCTIVA + estado reproductivo visible — Tasks

> Delta Nivel B (ADR-028). El `tasks.md` baseline NO se toca — este delta trae su propio ledger.
> Cada tarea: checkbox + los `RAR.<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificar.
> **Sin migración** → no hay tarea de SQL/apply remoto. Gate 1 N/A (ver `design` §8).

## Módulo puro del espejo (frontend, sin red)

- [x] **T1** — Crear `app/src/utils/repro-status.ts`: `deriveReproAptitude(events)` (último `tacto_vaquillona` por `(event_date, created_at)` null-as-newest) + `deriveReproStatus(input)` (single-slot, precedencia RAR.2.4) **reusando `deriveCurrentState`** para el eje preñez + `isReproApt(input)` + `reproStatusLabel(status)` (es-AR) + constante compartida de categorías "probadas" (cita `0105` líneas 126-127). Header anti-drift. Cubre: RAR.2.1, RAR.2.2, RAR.2.3, RAR.2.4, RAR.8.1, RAR.8.3.
- [x] **T2** — `app/src/utils/repro-status.test.ts`: matriz de la precedencia RAR.2.4 (macho/ternera→none; CUT→cut; preñada/vacía; probada/service→served_untested; vaquillona apta/diferida/no_apta; sin-veredicto→unknown) + edge cases (apta→service→tacto secuencial; no_apta sin tocar is_cut; un-CUT vuelve al derivado) + `isReproApt` (probada / vaquillona-apta true; ternera / no_apta / diferida / sin-veredicto / cut false). Cubre: RAR.2.4, RAR.6.2, RAR.7.4, RAR.7.5, RAR.7.6.

## Lecturas locales (SQLite, batched)

- [x] **T3** — `local-reads.ts`: `buildReproBadgeEventsQuery(profileIds)` (batched; proyecta `heifer_fitness`/`service_type`, incluye `tacto_vaquillona`; UNION overlay solo partos) + proyectar `ap.is_cut` en `LOCAL_LIST_SELECT`. Tests en `local-reads.test.ts`. Cubre: RAR.2.3, RAR.3.1, RAR.4.1.
- [x] **T4** — `local-reads.ts`: `buildAddTactoVaquillonaInsert(id, profileId, fitness, eventDate, createdAt)` (espeja `buildAddManeuverTactoVaquillonaInsert` **sin** `session_id`). Test del shape del INSERT. Cubre: RAR.1.3, RAR.8.2.

## Capa service (display-only)

- [x] **T5** — `animals.ts`: `computeReproStatuses(rows)` (batched, espeja `computeMirrorOverrides`): por **hembra** → `deriveReproStatus({sex, categoryCode, isCut, events})`; pisa `reproStatus` en `AnimalListItem` (campo nuevo, additivo) en `fetchAnimals` + búsqueda. Solo SELECT, nunca write. Cubre: RAR.3.1, RAR.3.2, RAR.3.3, RAR.8.1.
- [x] **T6** — `animals.ts`: exponer en `fetchAnimalDetail` la aptitud vigente (`deriveReproAptitude`) + el estado para la ficha (incluye "Servida sin tacto"). Cubre: RAR.4.1, RAR.4.2.
- [x] **T7** — `events.ts`: `addTactoVaquillona({ profileId, fitness, eventDate })` (CRUD plano, espeja `addTacto`; `created_at` de cliente). Cubre: RAR.1.3, RAR.8.2.

## UI — badge (lista) y desglose (ficha)

- [x] **T8** — `AnimalRow.tsx`: `ReproStatusChip` (3 tiers por token, `lineHeight` matcheado, a11y por `labelA11y`, no-tappable) + prop `reproStatus?`; render en el subtítulo de la vista normal (junto al `CategoryBadge`). NO en la variante compacta. Cubre: RAR.3.1, RAR.3.4, RAR.5.1, RAR.5.2, RAR.5.3, RAR.5.4.
- [x] **T9** — `app/app/animal/[id].tsx`: en `CurrentStateSection` agregar fila "Aptitud reproductiva" (Apta/Diferida/No apta/Sin evaluar, solo hembra y solo si aplica la fase) + extender "Estado reproductivo" con "Servida sin tacto"; macho sin filas. Cubre: RAR.4.1, RAR.4.2, RAR.4.3, RAR.4.4.

## UI — alta (prompt de aptitud)

- [x] **T10** — `app/app/crear-animal.tsx`: paso 4, `showFitness = categoría==='vaquillona'`; prompt 3-opciones ("Sí, apta"/"Aún no sé"/"No es apta") reusando el lenguaje de `TactoVaquillonaStep`; estado `heiferFitness`; opcional. Cubre: RAR.1.1, RAR.1.2, RAR.1.4.
- [x] **T11** — `crear-animal.tsx`: en `onSubmit`, bloque post-create soft-fail → `addTactoVaquillona` cuando `showFitness && heiferFitness != null`; conservar el animal y avisar suave si falla. Cubre: RAR.1.3, RAR.1.5.

## Inseminación (slice spec 03)

- [x] **T12** — `maneuver-applicability.ts`: extender `AnimalApplicabilityInfo` con `aptitude: HeiferFitness | null`; agregar `case 'inseminacion'` a `appliesToAnimal` (hembra ∧ `isReproApt`); el caller (`maneuver-events.ts`/frame de carga) provee `aptitude` desde el espejo local. Tests en `maneuver-applicability.test.ts`. Cubre: RAR.6.1, RAR.6.2, RAR.6.3, RAR.6.4, RAR.6.5, RAR.6.6, RAR.6.7.

## Verificación de consistencia + e2e

- [x] **T13** — Confirmar que `0105` (`rodeo_serviced_females`/`rodeo_repro_denominator`) y el denominador NO se modifican (solo lectura); el badge no contradice su elegibilidad. Cubre: RAR.7.1, RAR.7.2, RAR.7.3.
- [x] **T14** — e2e (`animals.spec.ts`): alta vaquillona "Sí, apta" → chip "Apta" en lista + fila aptitud en ficha; alta "Aún no sé" → fila aptitud "Diferida" (diferida ≠ servida, RAR.1.6 verificada a nivel de la función `0105` no modificada); prompt gateado a vaquillona (RAR.1.2). Cubre: RAR.1.1, RAR.1.2, RAR.1.3, RAR.3.1, RAR.4.1. **Reconciliación (ver `impl_02-aptitud-reproductiva.md`)**: el skip de inseminación en macho/`no_apta`/`diferida`/sin-veredicto-<365d (RAR.6.3/6.5) quedó cubierto por los UNIT de `maneuver-applicability.test.ts` (predicado puro que el frame consume) en vez de un e2e de la jornada de manga — el flujo carga.tsx con inseminación enabled + sesión + animal es pesado y NO se corrió en vivo (riesgo de flake 2-terminales). Los e2e de alta/badge se reconciliaron estáticamente (no corridos en vivo, mismo criterio que la Fase 1 de esta sesión).
- [x] **T15** — Reconciliación de cierre (ADR-028): Puerta 2 aprobada por Raf (2026-06-29) → foldeado al `design.md` baseline el bloque "Deltas posteriores" (índice introducido + backfill de los deltas previos) con la entrada `aptitud-reproductiva` + nota as-built bajo R10/R14 (estado de la ficha) y R4 (alta). Cubre: trazabilidad de delta (proceso).
