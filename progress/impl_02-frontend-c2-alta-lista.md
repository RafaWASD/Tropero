baseline_commit: db9d5866b39448061efc378219a618a21da1f1d2

# C2 — ALTA (find-or-create MANUAL) + LISTA DE ANIMALES (spec 02 frontend + 09 puerta manual)

Feature: frontend de spec 02 (alta + lista), foldando la puerta MANUAL de find-or-create de spec 09.
Backend de spec 02 está done/deployado. C1 (rodeos) commiteado en `db9d586` (= baseline).
Frontend ONLY. Sin migraciones nuevas (consume primitives de spec 02). PowerSync = C5.

## Plan (tasks) — TODAS ✅

- [x] T1 — `utils/animal-identifier.ts`: heurística pura R1.4 + clasificación de query R5. Tests.
- [x] T2 — `utils/animal-category.ts` (R4.7 espejo cliente) + `utils/animal-form.ts` (validadores). Tests.
- [x] T3 — `services/animals.ts`: createAnimal / fetchAnimals / searchAnimals / findOrCreateLookup / fetchAnimalDetail.
- [x] T4 — `services/last-rodeo.ts` + `utils/last-rodeo.ts` (resolver puro R6.2→R6.4). Tests del resolver.
- [x] T5 — Wirear `app/app/(tabs)/animales.tsx`: datos reales + debounce 250ms + filtros + no-match → CREATE + tap → ficha.
- [x] T6 — `app/app/crear-animal.tsx` (AnimalCreateScreen): precargado read-only + 2 recomendados + selector rodeo + sexo segmented req + nacimiento + atributos + lote + validación + submit → ficha + error accionable.
- [x] T7 — `app/app/animal/[id].tsx` (ficha básica): identidad + atributos read-only + zonas "Próximamente" (C3).
- [x] T8 — Registrar rutas en `_layout.tsx` (crear-animal, animal/[id]) + gating (no de-strand).
- [x] T9 — E2E `app/e2e/animals.spec.ts` (3 specs) + helpers `seedAnimal`/`gotoAnimales`.
- [x] T10 — verificación: check.mjs verde + pnpm e2e verde + autorrevisión.

## Archivos

Nuevos:
- `app/src/utils/animal-identifier.ts` (+ `.test.ts`) — heurística R1.4 / plan de búsqueda R5 (pura).
- `app/src/utils/animal-category.ts` (+ `.test.ts`) — categoría inicial al alta (R4.7, espejo de compute_category sin eventos).
- `app/src/utils/animal-form.ts` (+ `.test.ts`) — validadores del form de alta (sexo req, fechas, peso) (pura).
- `app/src/utils/last-rodeo.ts` (+ `.test.ts`) — resolver puro del rodeo default (R6.2→R6.4).
- `app/src/services/animals.ts` — createAnimal / fetchAnimals / searchAnimals / findOrCreateLookup / fetchAnimalDetail.
- `app/src/services/last-rodeo.ts` — readLastRodeo / writeLastRodeo / queryLastUsedRodeoFromDb (+ re-export del resolver).
- `app/src/services/management-groups.ts` — fetchManagementGroups (solo lectura; CRUD = C4).
- `app/app/crear-animal.tsx` — AnimalCreateScreen (R4).
- `app/app/animal/[id].tsx` — ficha básica (R5 versión C2).
- `app/e2e/animals.spec.ts` — 3 specs E2E.

Modificados:
- `app/app/(tabs)/animales.tsx` — MOCK → datos reales (fetchAnimals/searchAnimals/filtros/navegación).
- `app/app/_layout.tsx` — Stack.Screen de crear-animal + animal/[id] + gating ANIMAL_DESTINATIONS.
- `app/e2e/helpers/admin.ts` — seedAnimal + seedEstablishmentWithRodeo devuelve {establishmentId, rodeoId}.
- `app/e2e/helpers/ui.ts` — gotoAnimales.
- `scripts/run-tests.mjs` — engancha los 4 nuevos test files de unit.

## Mapa R → archivo:test

- **R1.1** (lista activos scopeada por establishment) → `services/animals.ts:fetchAnimals` · `animales.tsx` · E2E `animals.spec.ts` "alta…aparece en la lista" + "buscar existente…lista".
- **R1.2** (buscador permanente + debounce 250ms + R5) → `animales.tsx` (SEARCH_DEBOUNCE_MS) · `services/animals.ts:searchAnimals` · `utils/animal-identifier.test.ts` (classifySearchQuery) · E2E "buscar existente".
- **R1.4** (no-match → CTA "Dar de alta" con id precargado; heurística idv/visual) → `utils/animal-identifier.ts:classifyIdentifier` + `.test.ts` · `animales.tsx:onCreateFromNoMatch` · E2E "buscar inexistente → CREATE con id precargado".
- **R1.5** (filtros rodeo/estado/sin-caravana) → `services/animals.ts:fetchAnimals` (filter) · `animales.tsx` (FilterChip/FilterPopover/onlyNoTag).
- **R3** (motor find-or-create manual: match→edit / no-match→create) → `services/animals.ts:findOrCreateLookup` (primitive, contrato R3 manual; el tab usa searchAnimals+classifyIdentifier directo para mostrar la lista). Cobertura del lookup vía `searchAnimals` (E2E existente/inexistente).
- **R4.2** (id precargado read-only) → `crear-animal.tsx` (FormField editable=false) · E2E "buscar inexistente" (idv read-only con value).
- **R4.3** (otros 2 ids recomendados, no obligatorios) → `crear-animal.tsx` (campos tag/idv/visual editables).
- **R4.4** (selector rodeo: 1 fijo / ≥2 combo) → `crear-animal.tsx` (RodeoCombo vs Card fijo).
- **R4.5** (sexo segmented req + nacimiento + raza/pelaje/peso/lote) → `crear-animal.tsx` (SexSegmented) · `utils/animal-form.test.ts` (sexo req, fechas, peso).
- **R4.6/R4.7** (createAnimal split insert+select; categoría inicial; redirige a ficha) → `services/animals.ts:createAnimal` · `utils/animal-category.test.ts` · E2E "alta…abre la ficha".
- **R4.8** (error accionable, mantiene form) → `services/animals.ts:classifyError` (duplicate_tag/idv/network) · `crear-animal.tsx:onSubmit` (setFormError sin navegar).
- **R4.9/R6.5** (persistir lastRodeo al cambiar) → `crear-animal.tsx:onSelectRodeo` → `services/last-rodeo.ts:writeLastRodeo`.
- **R5** (TAG/IDV exacto + visual fuzzy) → `services/animals.ts:searchAnimals` · `utils/animal-identifier.test.ts` (classifySearchQuery) · E2E "buscar existente".
- **R5 (ficha básica)** → `services/animals.ts:fetchAnimalDetail` · `animal/[id].tsx` · E2E "alta…abre la ficha" + "buscar existente → ficha". Timeline/editar/agregar = "Próximamente" (C3).
- **R6.1/R6.2/R6.3/R6.4/R6.6** (lastRodeoSelected: memoria+storage+fallback DB+primer creado) → `utils/last-rodeo.ts:resolveDefaultRodeoId` + `.test.ts` · `services/last-rodeo.ts:readLastRodeo/queryLastUsedRodeoFromDb` · `crear-animal.tsx` (efecto de resolución).
- **R10.x / multi-tenant** → todas las queries scopeadas por establishment_id (del EstablishmentContext) + RLS de spec 02 R11 (barrera real); category/species resueltos del rodeo (RLS null si ajeno → fail-closed). NUNCA establishment_id hardcodeado.

## Autorrevisión adversarial (paso 8)

Busqué activamente como revisor hostil:

1. **¿El alta persiste y aparece en la lista?** SÍ — E2E end-to-end (crear desde empty → ficha → back → fila en la lista). createAnimal usa split insert+select con UUIDs de cliente (gotcha RLS-on-RETURNING evitado, lección C1).
2. **¿La búsqueda real (exacto+fuzzy) anda?** SÍ — E2E (buscar IDV exacto → resultado → ficha). searchAnimals dispara TAG (15 díg) / IDV (numérico) exacto + visual ilike, deduplicado.
3. **¿El id precargado queda read-only?** SÍ — E2E asierta el FormField read-only con value y la AUSENCIA del input editable de ese campo.
4. **¿Loops de efecto?** Encontré un riesgo: el efecto de resolución del rodeo default dependía de `rodeoIds` (array recreado cada render cuando rodeoState no es active) → potencial loop. CORREGIDO: depende solo de la key string primitiva `rodeoIdsKey`, reconstruyo los ids dentro del efecto (patrón RodeoContext). Resto de efectos: deps primitivas (establishmentId, rodeoFilter, statusFilter, onlyNoTag, debouncedQuery). Guards de secuencia (listSeq/searchSeq) descartan cargas viejas.
5. **¿Controles interactivos rotos en DEV (no solo en el export)?** Todos los Pressables nuevos usan `buttonA11y(Platform.OS,…)` (NUNCA accessibilityLabel crudo sobre Pressable de RN-web → evita el LogBox que tapa la pantalla, lección C1/BUG 2). El `accessibilityLabel` del TextInput del buscador es el mismo patrón pre-existente (RN-web traduce aria-label en inputs; el E2E getByLabel lo prueba).
6. **¿Hardcode?** check-hardcode 0 violaciones.
7. **¿Multi-tenant / RLS como barrera real?** createAnimal lee species/category del rodeo elegido: si el rodeo es de otro tenant, la SELECT del rodeo devuelve null (RLS) → error ANTES del insert (fail-closed). Inserts protegidos por RLS de spec 02 (has_role_in) + triggers (rodeo del establishment, category del system). El cliente no fuerza permisos.
8. **Limpieza adversarial**: quité un `await import()` dinámico de classifyIdentifier en findOrCreateLookup (→ import estático) y un parámetro muerto `_exactFirst` de pushRows.
9. **Edge cases**: birth_date futura/inválida rechazada (validador); entry_date ≥ birth_date; entry_weight > 0 (coma es-AR); categoría inicial borde 365 días testeada; query vacío → sin búsqueda; orphan-animal si falla el insert del perfil documentado (aceptable online-MVP; PowerSync/RPC atómico = C5).

NO reemplaza al reviewer ni al Gate 2 — los precede.

## Verificación

- `node scripts/check.mjs` VERDE: anti-hardcode 0 · client unit **182/182** (154 previos + 28 nuevos) · RLS 17 · Edge 36 · Animal 28 · Maniobras 13.
- `pnpm.cmd --dir app e2e` VERDE: **19/19** (16 previos + 3 nuevos de animals.spec.ts), estable.
- typecheck del cliente OK.

## Notas / diferidos

- `findOrCreateLookup` es el primitive del motor R3 manual (contrato para spec 04 BLE / 09-resto / MODO MANIOBRAS); el tab Animales no lo consume directo (muestra la lista de resultados y deja elegir), usa searchAnimals + classifyIdentifier.
- Lote: solo lectura en C2 (selector del alta); el CRUD de lotes + asignar/agrupar es C4 (`management-groups.ts` T3.7).
- Ficha: timeline + editar + agregar evento + link a madre = C3 (mostrados como "Próximamente").
- Storage de lastRodeo: reusa SecureStore/localStorage (adapter canónico del proyecto), NO @react-native-async-storage (no instalado; evitar dep nueva — R6.1 igual cumplida: memoria + storage local).
- PowerSync (offline real) = C5; en C2 los services pegan a Supabase directo (swappables, design §retrofit).
