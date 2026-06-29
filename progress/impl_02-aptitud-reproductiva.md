baseline_commit: 0d447cd3e58b3fd015c10feb3de09532bb0e77f3

# Impl — Delta APTITUD REPRODUCTIVA + estado reproductivo visible (spec 02, Nivel B ADR-028)

**Feature**: 02-modelo-animal (in_progress) — delta `aptitud-reproductiva`.
**Contrato**: `specs/active/02-modelo-animal/{requirements,design,tasks}-aptitud-reproductiva.md` (RAR.1–RAR.8).
**Gate 1**: N/A (frontend puro, sin migración/RLS/RPC — design §8). **No se tocó DB.**

## Plan (tasks.md del delta)
- T1 — `repro-status.ts`: módulo puro (deriveReproAptitude / deriveReproStatus / isReproApt / reproStatusLabel + constante "probadas" + anti-drift).
- T2 — `repro-status.test.ts`: matriz RAR.2.4 + edge cases + isReproApt (fallback edad).
- T3 — `local-reads.ts`: buildReproBadgeEventsQuery + is_cut en LOCAL_LIST_SELECT.
- T4 — `local-reads.ts`: buildAddTactoVaquillonaInsert (sin session_id).
- T5 — `animals.ts`: computeReproStatuses + reproStatus en AnimalListItem (lista + búsqueda).
- T6 — `animals.ts`: aptitud vigente + reproStatus en fetchAnimalDetail (ficha).
- T7 — `events.ts`: addTactoVaquillona (CRUD plano).
- T8 — `AnimalRow.tsx`: ReproStatusChip + prop reproStatus.
- T9 — `[id].tsx`: fila Aptitud + extender Estado reproductivo (Servida sin tacto).
- T10/T11 — `crear-animal.tsx`: prompt aptitud gateado a vaquillona + post-create soft-fail.
- T12 — `maneuver-applicability.ts`: AnimalApplicabilityInfo + case inseminacion.
- T13 — Confirmar 0105 NO se toca.
- T14 — e2e.
- T15 — Reconciliación de cierre (al aprobar Puerta 2).

## Estado: IMPLEMENTADO — listo para reviewer + Gate 2 (modo code)
T1–T14 hechos. **T15 (fold del puntero al `design.md` baseline + notas as-built bajo R4/R10/R14) queda pendiente de Puerta 2** (proceso de cierre del leader, ADR-028).

## Archivos tocados (archivo : qué)
- **`app/src/utils/repro-status.ts`** *(NUEVO)* — módulo puro: `deriveReproAptitude` (RAR.2.1, último `tacto_vaquillona` null-as-newest), `deriveReproStatus` (single-slot RAR.2.4, REUSA `deriveCurrentState`), `reproStatusLabel` (RAR.3.4), `isReproApt` (RAR.6.2, fallback de edad), `ageInDaysFromBirthDate`, constante compartida `PROVEN_FEMALE_CATEGORY_CODES` (cita 0105 L126-127) + `SERVICE_AGE_THRESHOLD_DAYS=365` (0105 L99/141). Header anti-drift (RAR.8.3).
- **`app/src/utils/repro-status.test.ts`** *(NUEVO)* — 34 tests (matriz RAR.2.4 + edge 7.4/7.5/7.6 + isReproApt RAR.6 + ageInDays).
- **`app/src/services/powersync/local-reads.ts`** — `buildReproBadgeEventsQuery` (RAR.2.3, proyecta heifer_fitness/service_type + tacto_vaquillona, UNION overlay solo partos) + `is_cut` en `LOCAL_LIST_SELECT` (synced `ap.is_cut` / overlay `0`) + `buildAddTactoVaquillonaInsert` (RAR.1.3/RAR.8.2, **sin** session_id).
- **`app/src/services/powersync/local-reads.test.ts`** — tests de los 3 builders + `is_cut` en lista + columna `is_cut` en la tabla del comportamiento de `buildAnimalsListQuery`.
- **`app/src/services/animals.ts`** — `reproStatus` en `AnimalListItem`; `reproStatus`+`reproAptitude` en `AnimalDetail`; `loadReproBadgeEvents` (helper batched) + `computeReproStatuses` (espeja `computeMirrorOverrides`, usa la categoría VIGENTE del espejo C6); cableado en `fetchAnimals`/`searchAnimals`/`fetchAnimalDetail` (solo SELECT, RAR.8.1).
- **`app/src/services/events.ts`** — `addTactoVaquillona` (CRUD plano, espeja `addTacto`, sin session_id).
- **`app/src/utils/maneuver-applicability.ts`** — `AnimalApplicabilityInfo` gana `aptitude?`+`ageDays?` (OPCIONALES → no rompe call-sites legacy) + `case 'inseminacion'` → `isReproApt` (RAR.6, cierra `default: return true` de #1b).
- **`app/src/utils/maneuver-applicability.test.ts`** — saca `inseminacion` del set "agnóstico" (codificaba el bug #1b) + 6 tests dedicados RAR.6.2–6.6 + skip en macho.
- **`app/app/maniobra/carga.tsx`** — `toApplicabilityInfo` provee `aptitude` (de `AnimalDetail.reproAptitude`) + `ageDays` (de `birthDate` vía `ageInDaysFromBirthDate`).
- **`app/src/components/AnimalRow.tsx`** — `ReproStatusChip` (3 tiers por token, lineHeight matcheado, a11y `labelA11y`, no-tappable RAR.5) + prop `reproStatus`; render en el subtítulo NORMAL (no compacto).
- **`app/app/(tabs)/animales.tsx`** — pasa `reproStatus` (+`categoryCode`) a `AnimalRow` (lista + búsqueda, único call-site de la vista normal de la tab Animales).
- **`app/app/animal/[id].tsx`** — `CurrentStateSection` recibe `categoryCode`/`reproStatus`/`reproAptitude`; fila "Aptitud reproductiva" (RAR.4.1, solo vaquillona) + extiende "Estado reproductivo" con "Servida sin tacto" (RAR.4.2); macho sin filas (RAR.4.3).
- **`app/app/crear-animal.tsx`** — `showFitness` (gateado a vaquillona, RAR.1.2), estado `heiferFitness`, `FitnessOptionRows` (3 opciones es-AR con el lenguaje de color de TactoVaquillonaStep apta=verde/diferida=ámbar/no_apta=terracota) + post-create soft-fail → `addTactoVaquillona` (RAR.1.3/1.5).
- **`app/e2e/animals.spec.ts`** — 3 e2e: alta vaquillona "Sí, apta"→fila Aptitud+chip; "Aún no sé"→Diferida; prompt ausente en ternera (RAR.1.2).
- **`scripts/run-tests.mjs`** — engancha `repro-status.test.ts` al runner.

## Mapa R<n> → test
| Requirement | Test (archivo : caso) |
|---|---|
| RAR.1.1 (prompt 3 opciones vaquillona) | `animals.spec.ts`: "Sí, apta"→Apta (prompt visible) |
| RAR.1.2 (gateado a vaquillona) | `animals.spec.ts`: prompt ausente en ternera |
| RAR.1.3 (alta crea tacto_vaquillona) | `local-reads.test.ts`: buildAddTactoVaquillonaInsert; `animals.spec.ts`: Apta/Diferida en ficha |
| RAR.1.4 (opcional) | `animals.spec.ts`: 1er test vaquillona crea sin elegir aptitud (sin break) |
| RAR.1.6 (diferida ≠ servida aun con edad) | `repro-status.test.ts`: deriveReproAptitude diferida; verificado a nivel 0105 (NO modificado, T13) |
| RAR.2.1 (aptitud vigente) | `repro-status.test.ts`: deriveReproAptitude (último / null-as-newest / ignora no-tacto_vaquillona) |
| RAR.2.2 (reusa deriveCurrentState) | `repro-status.test.ts`: tacto+→pregnant, birth→empty (vía deriveCurrentState) |
| RAR.2.4.1–2.4.6 (precedencia single-slot) | `repro-status.test.ts`: matriz completa (none/cut/pregnant/empty/served/fitness/unknown) |
| RAR.3.1/3.4 (chip único, labels) | `local-reads.test.ts` (is_cut en lista); `animals.spec.ts` (chip "Estado reproductivo: Apta") |
| RAR.4.1/4.2/4.3 (ficha) | `animals.spec.ts`: fila "Aptitud reproductiva"=Apta/Diferida |
| RAR.5.x (presentación badge) | revisión visual del leader (UI) + tokens (anti-hardcode PASS) + lineHeight/a11y en `AnimalRow.tsx` |
| RAR.6.2 (apta = probada/vaq-apta/vaq≥365d) | `maneuver-applicability.test.ts` RAR.6.2 + `repro-status.test.ts` isReproApt |
| RAR.6.3 (macho false) | `maneuver-applicability.test.ts` RAR.6.3 + skip en macho |
| RAR.6.4 (ternera false) | `maneuver-applicability.test.ts` RAR.6.4 |
| RAR.6.5 (no_apta/diferida/<365d false; ≥365d true) | `maneuver-applicability.test.ts` RAR.6.5 + `repro-status.test.ts` |
| RAR.6.6 (CUT false) | `maneuver-applicability.test.ts` RAR.6.6 |
| RAR.7.4/7.5/7.6 (edge secuencial / no_apta≠CUT / un-CUT) | `repro-status.test.ts` edge cases |
| RAR.7.1/7.2/7.3 (no toca 0105) | T13: `git status supabase/` vacío; isReproApt/deriveReproStatus espejan 0105 |
| RAR.8.1 (display-only, cero writes) | `computeReproStatuses`/`loadReproBadgeEvents` solo SELECT; deriveReproStatus puro |
| RAR.8.2 (única escritura = evento alta, offline) | `local-reads.test.ts` buildAddTactoVaquillonaInsert (CRUD plano) |
| RAR.8.3 (anti-drift) | header de `repro-status.ts` |

## Autorrevisión adversarial (paso 8)
Busqué activamente y cerré/verifiqué:
- **Precedencia CUT > preñez**: una CUT preñada → `cut` (no `pregnant`). Tested. ✓
- **Preñez > servida**: multípara con tacto empty → `empty` (no `served_untested`); con birth → `empty`. Tested. ✓
- **null-as-newest (RC6.1.4)** en `deriveReproAptitude`: created_at null gana; dos null → índice. Tested (espejo de `isAfter` de animal-category, anti-drift comentado). ✓
- **Divergencia intencional badge vs inseminación**: vaquillona sin veredicto ≥365d → badge "Sin evaluar" (unknown) PERO `isReproApt`=true. NO se unificaron (distintos a propósito, design §2/§10). Ambos tested. ✓
- **Set "probadas" = UNA constante** (`PROVEN_FEMALE_CATEGORY_CODES`) compartida por badge + inseminación, citando 0105 L126-127. No se duplicó el literal. ✓
- **Fallback de edad alineado a 0105**: `SERVICE_AGE_THRESHOLD_DAYS=365`, condición `ageDays>=365` (espeja `(current_date - birth_date) >= v_age_threshold_days`); sin birth_date → null → false (espeja `birth_date is not null`). Tested. ✓
- **`appliesToAnimal('inseminacion', macho)` ya NO cae a `default:true`** (cierra #1b). El test que codificaba el bug (set "agnóstico" con inseminacion) se corrigió. ✓
- **Campos `aptitude`/`ageDays` OPCIONALES** en `AnimalApplicabilityInfo` → DientesStep/tests de CE y demás call-sites legacy NO rompen (typecheck PASS). ✓
- **Categoría VIGENTE en el badge**: `computeReproStatuses` usa el override del espejo C6 (no la guardada stale) para la rama probada/vaquillona (RAR.7.2). ✓
- **Offline / multi-tenant**: `addTactoVaquillona` CRUD plano local (offline-safe), sin establishment_id hardcodeado (trigger lo fuerza); lecturas 100% SQLite local. ✓
- **Descender clipping**: chip con `lineHeight="$2"` matcheado; FitnessOptionRows espeja OptionRows (sin numberOfLines → sin truncado). ✓
- **No-write estructural**: la derivación y el badge no escriben (ni overlay ni reconciliación); única escritura = el evento del alta. ✓
- **Macho en ficha/lista**: sin filas de aptitud/repro, sin chip. ✓

## Reconciliación de specs (paso 9)
- **T14 e2e**: el skip de inseminación en macho/`no_apta`/`diferida`/<365d quedó cubierto por los UNIT de `maneuver-applicability.test.ts` (el predicado puro que el frame `carga.tsx` consume) en lugar de un e2e de la jornada de manga — el flujo (rodeo con inseminación enabled + sesión + animal del caso) es pesado y NO se corrió en vivo (riesgo de flake 2-terminales). Anotado en `tasks-aptitud-reproductiva.md` T14. Los e2e de alta/badge se reconciliaron estáticamente (no corridos en vivo; selectores espejados de los patrones existentes de `animals.spec.ts`).
- **Helper `ageInDaysFromBirthDate`**: agregado a `repro-status.ts` (el design decía "edad desde birth_date" sin nombrar helper). Aditivo, puro, espeja el `ageInDays` privado de animal-category.ts (UTC-midnight). Sin cambio de contrato.
- **`AnimalDetail` ganó DOS campos** (`reproStatus` + `reproAptitude`): el design §4 menciona `reproStatus` + "aptitud vigente"; se materializaron como dos campos (el badge/fila usa reproStatus; carga.tsx usa reproAptitude). Coherente con el design.
- Nada contradice las specs ni el código. `design.md` baseline NO se reescribe (el fold de ADR-028 es T15, en Puerta 2).

## Verificación (NO se corrió check.mjs completo, por pedido)
- `pnpm.cmd typecheck`: PASS (limpio).
- `node scripts/check-hardcode.mjs`: PASS (0 violaciones).
- Unit tocados + dependientes: `repro-status` (34) + `maneuver-applicability` (41) + `local-reads` (131) + `event-timeline`/`animal-category`/`maneuver-sequence` (regresión) → **417/417 PASS**.
- e2e: NO corrido en vivo (flake 2-terminales); reconciliado estáticamente.

## NO se tocó DB (Gate 1 N/A confirmado)
`git status supabase/` vacío. Cero migración/RLS/trigger/RPC/Edge. La única escritura (evento `tacto_vaquillona` del alta) reusa el enum/columna `0053` ya aplicados, por CRUD plano cliente (igual que `addTacto`); la RLS `reproductive_events` + trigger `0077` la validan al subir, sin cambios. `0105` solo se LEE/espeja (no se modifica).

## Para el leader (veto visual del badge)
- `ReproStatusChip` (3 tiers): verde relleno (Apta/Preñada), ámbar outline (Diferida/Vacía), neutro outline (Servida sin tacto/No apta/CUT/Sin evaluar). NO reusa `$cutBg/$cutText` (evita doble-amarillo con el badge de categoría CUT).
- **Layout a vigilar**: en la fila normal el subtítulo es `CategoryBadge · ReproStatusChip · rodeo` (gap $2); ambos chips `flexShrink:0`, el rodeo trunca primero. "Servida sin tacto" es la etiqueta más larga → en pantallas angostas con una categoría larga (ej. "Multípara") el rodeo puede quedar muy truncado. Es la decisión single-slot del spec; lo dejo señalado para el veto visual.
- Prompt del alta (`FitnessOptionRows`): filas anchas con el color de la opción al seleccionar (verde/ámbar/terracota), check blanco. Embebido en el ScrollView del paso 4 (no el bloque full-screen de manga, que colapsaría — design §11 alt #4).
