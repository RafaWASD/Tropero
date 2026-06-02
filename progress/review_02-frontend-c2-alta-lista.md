# Review — C2: ALTA find-or-create MANUAL + LISTA DE ANIMALES + ficha basica

Feature: frontend de spec 02 (alta + lista + ficha) foldando la puerta MANUAL de find-or-create de spec 09.
Reviewer: reviewer agent. Fecha: 2026-06-01. Baseline: db9d586 (working tree sin commitear sobre main).

## Veredicto: APPROVED

Trazabilidad completa, todas las tasks en [x], check.mjs verde (182 unit + RLS 17 + Edge 36 + Animal 28 + Maniobras 13 + anti-hardcode 0), Gate 2 PASS. La duplicacion de logica de dominio (computeInitialCategoryCode) es fiel al SQL. No hay scope creep de C3. Una observacion menor no bloqueante (imports muertos) queda registrada.

## Trazabilidad R <-> test (completa)

- R1.1 lista activos scopeada por establishment -> services/animals.ts:fetchAnimals + E2E alta/buscar.
- R1.2 buscador permanente + debounce 250ms + R5 -> animales.tsx (SEARCH_DEBOUNCE_MS=250) + searchAnimals + animal-identifier.test.ts:classifySearchQuery + E2E.
- R1.3 tap en fila -> ficha -> animales.tsx:onOpenAnimal + E2E buscar existente.
- R1.4 no-match -> CTA Dar de alta + heuristica idv/visual -> animal-identifier.ts:classifyIdentifier + .test.ts + animales.tsx:onCreateFromNoMatch + E2E inexistente -> CREATE con id precargado.
- R1.5 filtros rodeo/estado/sin-caravana -> animals.ts:fetchAnimals(filter) + animales.tsx (FilterChip/FilterPopover/onlyNoTag).
- R3 find-or-create manual (match->edit / no-match->create) -> animals.ts:findOrCreateLookup + cobertura via searchAnimals (E2E) + animal-identifier.test.ts.
- R4.2 id precargado read-only -> crear-animal.tsx (FormField editable=false) + E2E (idv read-only con value + ausencia del input editable).
- R4.3 otros 2 ids recomendados -> crear-animal.tsx (render condicional por prefillKind).
- R4.4 selector rodeo 1 fijo / >=2 combo -> crear-animal.tsx (RodeoCombo vs Card fijo).
- R4.5 sexo segmented req + nacimiento/raza/pelaje/peso/lote -> crear-animal.tsx (SexSegmented) + animal-form.test.ts.
- R4.6/R4.7 createAnimal split insert+select; categoria inicial; redirige a ficha -> animals.ts:createAnimal + animal-category.test.ts + E2E.
- R4.8 error accionable, mantiene form -> animals.ts:classifyError + crear-animal.tsx:onSubmit.
- R4.9/R6.5 persistir lastRodeo al cambiar combo -> crear-animal.tsx:onSelectRodeo -> last-rodeo.ts:writeLastRodeo.
- R5 (spec 02) TAG/IDV exacto + visual fuzzy -> animals.ts:searchAnimals + animal-identifier.test.ts + E2E.
- R5 ficha basica (version C2) -> animals.ts:fetchAnimalDetail + animal/[id].tsx + E2E. Timeline/editar/agregar = Proximamente (C3).
- R6.1/R6.2/R6.3/R6.4/R6.6 lastRodeoSelected -> utils/last-rodeo.ts:resolveDefaultRodeoId + last-rodeo.test.ts (6 casos) + services/last-rodeo.ts.
- R10.x / multi-tenant -> queries scopeadas por establishment_id (EstablishmentContext) + RLS spec 02 (barrera real, Gate 2). Sin establishment_id hardcodeado.

Cada R<n> aplicable a C2 tiene >=1 test concreto. OK.

## Verificacion del punto CRITICO — category mirror vs SQL

computeInitialCategoryCode (cliente) vs rama sin-eventos de compute_category (supabase/migrations/0031_category_transitions.sql):
- macho + birth_date conocida y <365d -> ternero; sino -> torito. Coincide (SQL 25-30).
- hembra + (sin partos, sin tacto+) + birth_date <365d -> ternera; sino -> vaquillona. Coincide (SQL 53-57).
- Borde 365 dias: SQL usa (current_date - v_birth_date) < 365; cliente usa ageInDays < 365 (diff entera de dias UTC). Test valida 365 = NO cria -> vaquillona, 364 = ternera. Fiel.
- Categorias ternero/torito/ternera/vaquillona existen en el seed (bovino,cria) de 0015. OK.
- Cliente resuelve category_id por code contra categories_by_system del system del rodeo (no hardcodea UUID); server re-valida via trigger 0021. Doble red. El animal nace con la categoria correcta.

## Tasks completas: SI

Las 10 tasks del plan de impl_02-frontend-c2-alta-lista.md en [x]. La feature 02 esta deferred en feature_list (Fase 3+ pausada formalmente); C2 es un chunk del frontend ejecutado bajo bitacora propia, no las tasks T3.x/T4.x del tasks.md canonico — coherente con el modelo de decomposicion en chunks del context-frontend.md.

## CHECKPOINTS

- C1 harness completo — N/A. check.mjs RC=0. [x]
- C2 estado coherente — [x] una sola feature in_progress (la 01); C2 es working-tree de la 02 (deferred). Observacion: al cerrar/commitear C2 el leader debe definir el estado de la feature 02 para no chocar con one_feature_at_a_time — decision del leader, no bloquea el codigo.
- C3 codigo respeta arquitectura — [x] solo capas previstas; services unica capa con I/O; screens no fetchan directo a supabase; sin establishment_id hardcodeado. Defecto menor: 2 imports muertos (View, InfoNote) en animales.tsx.
- C4 verificacion real — [x] >=1 test por modulo; fixtures reales en E2E (Supabase remoto); runner verde (182 unit + 19/19 E2E).
- C5 sesion cerrada — [ ] pendiente del leader: history.md + commit (C2 sin commitear, esperado para el review).
- C6 SDD — [x] specs presentes; EARS; trazabilidad R<->test completa.
- C7 multi-tenant — [x] consume RLS de spec 02 ya gateada; no agrega tablas.
- C8 offline-first — ver checklist B (online-MVP documentado, PowerSync = C5).

## Checklist RAFAQ-especifico

### A. tablas con establishment_id / RLS — N/A
C2 no crea tablas ni policies nuevas: consume el backend de spec 02 (ya gateado, RLS 0022/0017/0021/0037). Las queries del cliente delegan el scope tenant a esas policies (fail-closed verificado en Gate 2).

### B. carga/edicion de datos en campo (offline-first) — aplica PARCIAL
- [ ] Funciona offline — NO en C2 (documentado y aceptable). Alta/lista/ficha pegan a Supabase directo; offline real (PowerSync) = C5. context-frontend.md mandata online-primero detras de services swappables; los services estan aislados (src/services/*) y delgados. Sin red -> copy accionable (kind:network). Justificado por la decomposicion aprobada.
- [x] Resolucion de conflictos — N/A en C2 (sin cola de sync); last-write-wins llega con PowerSync (C5).
- [x] No hace requests sincronos crudos desde la pantalla — las screens llaman a services/*, no a supabase directo.

### D. UI de campo (manga) — aplica
- [x] Targets grandes: $touchMin en CTAs/combos/segmented; AnimalRow minHeight=$animalRow (>=72px); $chipMin en items de popover.
- [x] Fuente legible: hero de fila $6 (18px); valores de ficha $5; labels $3.
- [x] Una decision por bloque: form agrupado por secciones (identificacion/rodeo/sexo/opcionales/lote), sexo unica decision requerida.
- [x] Loading visible: header de lista, CTA Creando (disabled), Cargando ficha en detalle. Guards de secuencia descartan cargas viejas.

### C (BLE), E (Edge Functions) — N/A (C2 no toca BLE ni Edge Functions).

## Observaciones

1. [MENOR — no bloqueante] Imports muertos en app/app/(tabs)/animales.tsx: View (linea 25, tamagui) e InfoNote (linea 28, @/components) se importan pero no se usan (0 usos JSX, verificado). tsc pasa (sin noUnusedLocals), ESLint sin no-unused-vars, check.mjs verde. Codigo muerto a sacar en el commit de cierre. No alcanza para CHANGES_REQUESTED.

2. [PRE-EXISTENTE — fuera de scope C2] AnimalRow.tsx usa accessibilityLabel/accessibilityRole crudos en su Pressable (linea 160), patron que utils/a11y.ts advierte. NO es regresion de C2: viene del commit 57cafe2 (spec 09 R1), no esta en el working tree de C2. Funciona (E2E con getByRole contra el export sin LogBox; Pressable hoja sin otras props ARIA). Todos los Pressables NUEVOS de C2 (FilterChip, FilterPopover, PrimaryCta, SexOption, RodeoCombo, GroupCombo, back) usan buttonA11y(Platform.OS, ...). Registrar para limpieza del componente.

3. [LOW — Gate 2, registrado] passthrough de error.message de Postgres en rama unknown de classifyError + escapeIlike que reemplaza en vez de escapar. No exploitables (ver security_code_02-frontend-c2-alta-lista.md). Post-MVP.

4. Atomicidad del alta (animal huerfano): si falla el insert de animal_profiles tras insertar animals, queda un animals sin perfil — invisible por RLS, no aparece en listas, no bloquea reintento (salvo TAG ya tomado, visible por duplicate_tag). Documentado en animals.ts y en la autorrevision; transaccion atomica real con PowerSync/RPC (C5). Aceptable para online-MVP.

## Notas de cambios requeridos

Ninguno bloqueante. Recomendado antes del commit de cierre (no condiciona el APPROVED):
- app/app/(tabs)/animales.tsx:25 — quitar View del import de tamagui (sin uso).
- app/app/(tabs)/animales.tsx:28 — quitar InfoNote del import de @/components (sin uso).
