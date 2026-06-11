# Spec 02 — C6: espejo client-side de categoría + visibilidad del override — Tasks

> Fases chicas, en orden. Cada task con los `RC6.<n>` que cubre. El implementer marca `[x]`.
> Frontend puro: si una task descubre necesidad de backend → parar y reportar al leader (no improvisar migraciones).

## F1 — Módulo puro + fixtures espejo

- [x] T1.1 — Extender `app/src/utils/animal-category.ts` con `computeCategoryCode` (espejo completo de 0062: ramas macho/hembra, precedencia load-bearing, conteo de partos por evento, tacto+ vigente con tupla `(event_date, created_at)`, tie-break `createdAt null` = más reciente) + tipos `ReproEventInput`/`CategoryMirrorInputs`. Cubre: RC6.1.1, RC6.1.2, RC6.1.3, RC6.1.4.
- [x] T1.2 — Refactor: `computeInitialCategoryCode` y `categoryOverrideFor` delegan en `computeCategoryCode` (sin tercera copia); firmas públicas intactas; tests existentes de `animal-category.test.ts` verdes sin modificarse. Cubre: RC6.1.5.
- [x] T1.3 — Helpers puros `inferIsCastrated(storedCode)` y `deriveDisplayCategory(...)` (override=true → guardada; code irresoluble en catálogo → guardada). Cubre: RC6.2.1, RC6.3.3, RC6.3.4.
- [x] T1.4 — Suite de fixtures espejo de la matriz RT2.x (tabla del design §6: T2.21–T2.26, T2.29, T2.30 + tie-break null + inferencia). Cubre: RC6.1.6, RC6.1.4, RC6.2.1.
- [x] T1.5 — Header del módulo: nota anti-drift ("toda migración que toque compute_category actualiza este espejo + fixtures", referencia 0062) + limitación documentada de la inferencia. Cubre: RC6.5.1, RC6.2.2.

## F2 — Lecturas locales + inyección en service (lista/búsqueda/ficha)

- [x] T2.1 — `local-reads.ts`: nuevo `buildCategoryMirrorEventsQuery(profileIds)` (synced + overlay, filtro de event_type, ORDER BY event_date/created_at) + test del builder. Cubre: RC6.3.6, RC6.3.1.
- [x] T2.2 — `local-reads.ts`: proyectar `category_override`, `animal_birth_date`, `r.system_id` en `LOCAL_LIST_SELECT` + `LOCAL_LIST_SELECT_OVERLAY` (ambas ramas del UNION, mismas columnas); `r.system_id` en `buildAnimalDetailQuery` (ambas ramas). Tests de builders actualizados. Cubre: RC6.3.1, RC6.3.2.
- [x] T2.3 — `animals.ts`: helper interno `computeMirrorOverrides(rows)` (batch eventos + catálogo code→name por system_id + núcleo PURO `computeDisplayOverrides` + swap en memoria) cableado en `fetchAnimals`, búsqueda y `fetchAnimalDetail`. Shapes públicos sin cambios; con override=true o derivada irresoluble → guardada. Cubre: RC6.3.1, RC6.3.2, RC6.3.3, RC6.3.4, RC6.3.5.
- [x] T2.4 — Verificación display-only: el núcleo `computeDisplayOverrides` es PURO (no puede escribir, propiedad estructural) + test que asserta que los builders del path de display son SELECT puros (cero INSERT/UPDATE/DELETE). El único write del chunk es `buildRevertCategoryOverrideUpdate` (acción "Quitar fijación", RC6.4.3), fuera del path de display. Cubre: RC6.3.5.

## F3 — Badge de override + quitar fijación (D2)

- [x] T3.1 — Ficha `[id].tsx`: indicador "Categoría fijada manualmente" (CategoryOverrideCard) cuando `detail.categoryOverride` (bajo el hero; el CategoryBadge conserva su punto). Cubre: RC6.4.1.
- [x] T3.2 — `local-reads.ts`: `buildRevertCategoryOverrideUpdate(profileId, categoryId)` (UPDATE único de ambas columnas, `deleted_at IS NULL`) + test del builder. Cubre: RC6.4.3.
- [x] T3.3 — `animals.ts`: `revertCategoryOverride(profileId)` — computa derivada con el espejo (`isCastrated=false`, documentado), resuelve id por `buildCategoryIdByCodeQuery`, irresoluble → error es-AR sin write, ejecuta el UPDATE local. Cubre: RC6.4.3, RC6.4.5, RC6.4.4.
- [x] T3.4 — Ficha: acción "Quitar fijación" con confirmación inline, gating (activo + cualquier rol activo, patrón Lote), reload post-revert (la ficha muestra override=false + derivada al instante, también offline). Cubre: RC6.4.2, RC6.4.4.

## F4 — E2E + cierre

- [x] T4.1 — E2E: extender `events.spec.ts` — 2 tests C6: (a) tacto+ sobre vaquillona ⇒ el hero muestra "Vaquillona preñada" derivado localmente sin sync-down; (b) badge override + quitar fijación ⇒ tras el revert el hero pasa a la derivada. Ambos VERDES. Cubre: RC6.3.1, RC6.4.1, RC6.4.2, RC6.4.3.
- [x] T4.2 — Re-verificados los e2e dependientes del gap. ANTES (HEAD, clean): events.spec.ts con 4 rojos (tests 4 `tacto→transición`, 5 `parto mellizos→transición`, 7 `parto preñada→Vacía`, 10 `timeline order 0069`). DESPUÉS (C6): los 2 de transición (4, 5) VERDES — el badge se deriva localmente. Tests 7 y 10 siguen rojos pero **NO son el gap del badge**: 7 falla en la fila "Estado reproductivo → Vacía" (`deriveCurrentState`, UUID-tiebreak con `created_at` null offline — bug pre-existente, otro módulo, fuera de C6; el BADGE de 7 sí transiciona a "Vaca segundo servicio" con C6) y 10 es el orden de timeline (bug 0069). Antes/después en `progress/impl_02-c6-categoria-espejo.md`. Cubre: RC6.3.1.
- [x] T4.3 — Cobertura offline: unit (F1 fixtures con `createdAt null` + caso tacto/aborto mismo día offline) + e2e (el test C6 del espejo carga el tacto offline-capable y ve la derivada sin sync-down). Cubre: RC6.3.6, RC6.4.4.
- [x] T4.4 — Nota aditiva anti-drift en `design-tier2-categorias.md` §3.1 (apunta al módulo espejo + fixtures). Cubre: RC6.5.2.
- [x] T4.5 — Suite completa verde (`node scripts/check.mjs` exit 0: unit app + builders + GUARD de schema + suites backend; lint anti-hardcode 0 violaciones) + reconciliación specs↔as-built hecha (design §1/§2/§4/§5/§6, requirements RC6.1.4 — notas de reconciliación 2026-06-11).
