# Spec 02 — Tasks

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25

Plan de implementación paso a paso. Cada tarea tiene su criterio de aceptación y los `R<n>` que cubre. El orden importa: dependencias hacia adelante.

**Fases sugeridas para esta feature**:

- **Fase 1 — Schema + triggers + RLS**: migrations `0012..0032`. Backend puro.
- **Fase 2 — Tests reales contra DB remota**: extensiones del runner `supabase/tests/rls/` y un nuevo `supabase/tests/animal/` para triggers de transición y ternero al pie.
- **Fase 3+ — Cliente**: hooks, contextos, pantallas, PowerSync, tests Detox.

Igual que con spec 01, la feature se puede cerrar tras Fase 1+2 y **diferir Fase 3+** hasta que Raf retome el frontend con el stack del `ADR-013`. Los tests de Fase 2 demuestran que el modelo es operativo end-to-end vía Supabase.

## Fase 1 — Schema, triggers y RLS

### T1.1 Verificar prerequisitos
- Confirmar que la extension `pg_trgm` está habilitada en el proyecto remoto: `select * from pg_extension where extname = 'pg_trgm';` (Supabase la incluye por default desde Postgres 13).
- Confirmar que el patrón de migrations posterior a `0011` no rompe el estado actual: `supabase db push` corriendo en seco contra el remoto sin pending changes.
- **Aceptación**: `pg_trgm` está habilitada (o se habilita en `0012_species.sql` con `create extension if not exists pg_trgm`). `node scripts/check.mjs` verde antes de empezar.

### T1.2 Migration `0012_species.sql`
- Crear tabla `public.species` con `(id, code, name, icon, active, created_at, updated_at)`.
- Seed: `bovino` (`active=true`), `equino` y `porcino` (`active=false`).
- `enable RLS` + policy `species_select` para `authenticated`. `grant select` solamente.
- **Aceptación**: `select * from species` desde cliente anon-key retorna las 3 filas; no se puede insert/update.
- **Cubre**: R1.1, R1.4, R1.5.

### T1.3 Migration `0013_systems_by_species.sql`
- Crear tabla con `(id, species_id, code, name, active, created_at, updated_at)` y unique `(species_id, code)`.
- Seed para bovino: `cria` (active=true), resto inactive.
- RLS + grant select.
- **Aceptación**: cliente lee `(bovino, cria, active=true)`; otras combinaciones existen pero `active=false`.
- **Cubre**: R1.2, R1.4, R1.5.

### T1.4 Migration `0014_categories_by_system.sql`
- Crear tabla con todos los campos del design.
- Seed de las 10 categorías de `(bovino, cria)` listadas en R1.3.
- RLS + grant select.
- **Aceptación**: las 10 categorías del seed presentes y legibles; insert desde cliente authenticated falla por falta de policy.
- **Cubre**: R1.3, R1.4, R1.5.

### T1.5 Migration `0015_rodeos.sql`
- Crear tabla `public.rodeos` con campos del design.
- Trigger `tg_rodeos_validate_species_system` (BEFORE INSERT OR UPDATE): rechaza si `(species_id, system_id)` no existe o `active=false`.
- Trigger `rodeos_set_updated_at` reusando `tg_set_updated_at_generic` (definir el helper si no existe — está en `0017`).
- RLS: `select` con `has_role_in(establishment_id)`, `insert/update` con `is_owner_of(establishment_id)`. `grant select, insert, update` to authenticated. No grant delete (soft via update).
- **Aceptación**: owner crea rodeo OK; field_operator falla con 42501; combinación `(bovino, invernada)` (system inactive) falla con 23514.
- **Cubre**: R2.1, R2.2, R2.3, R2.4.

### T1.6 Migration `0016_default_rodeo_on_establishment.sql`
- Crear función `handle_new_establishment_default_rodeo` (security definer): busca `(bovino, cria)` y hace insert en `rodeos` con `name = 'Rodeo principal'`.
- Crear trigger `on_establishment_created_default_rodeo` AFTER INSERT sobre `establishments`.
- Grant execute a `authenticated`.
- **Aceptación**: signup + creación de establishment dispara creación de rodeo default, visible vía `select * from rodeos`.
- **Cubre**: R2.6.

### T1.7 Migration `0017_generic_updated_at.sql`
- Crear (o consolidar) función `tg_set_updated_at_generic`.
- Si ya existía con otro nombre en spec 01 (`tg_establishments_set_updated_at` es específica de `establishments`), agregar la genérica acá.
- **Aceptación**: función creable; reusable desde T1.5 y futuras.
- **Cubre**: utilidad para R2, R3, R4.

### T1.8 Migration `0018_animals.sql`
- Crear tabla `public.animals` con campos del design.
- Unique index parcial `animals_tag_unique` sobre `(tag_electronic) where tag_electronic is not null and deleted_at is null`.
- Trigger `tg_animals_validate_species` BEFORE INSERT/UPDATE: rechaza species_id inactiva.
- Trigger updated_at.
- `enable RLS` + grants. Policies de SELECT/INSERT/UPDATE se definen en `0021_rls_animals_and_profiles.sql` (la SELECT depende de animal_profiles, que se crea en `0019`).
- **Aceptación**: insert con `species_id` de bovino activo OK; con `equino` (inactivo) falla con 23514; dos animals con mismo tag fallan por unique.
- **Cubre**: R3.1, R3.2, R3.3, R3.4.

### T1.9 Migration `0019_animal_profiles.sql`
- Crear enum `animal_status` y `teeth_state_enum`.
- Crear tabla `public.animal_profiles` con todos los campos del design.
- Indexes: `animal_profiles_idv_unique` (parcial), `animal_profiles_active_animal_unique` (parcial), `animal_profiles_visual_alt_trgm` (GIN trgm), `animal_profiles_by_est`, `animal_profiles_by_rodeo`, `animal_profiles_by_animal`.
- Trigger updated_at.
- `enable RLS` + grants. Policies en `0021`.
- **Aceptación**: insert válido OK; insert con `(establishment_id, idv)` duplicado falla por unique; dos perfiles activos para el mismo `animal_id` falla por unique parcial.
- **Cubre**: R4.1, R4.3, R4.4, R4.11.

### T1.10 Migration `0020_animal_profiles_validations.sql`
- Triggers:
  - `tg_animal_profiles_identity_check` (R4.2): rechaza si los 3 identificadores están vacíos mirando `animals.tag_electronic`.
  - `tg_animal_profiles_rodeo_check` (R4.5): rechaza si rodeo no es del establishment o está inactivo/soft-deleted.
  - `tg_animal_profiles_category_check` (R4.6): rechaza si `category_id` no pertenece al system del rodeo.
  - `tg_animal_profiles_set_override_on_manual` (R4.8): si UPDATE de `category_id` y GUC `rafaq.is_auto_transition` no está `on`, setea `category_override = true`.
- **Aceptación**: 4 escenarios cubiertos por tests T2.x:
  - animal sin tag + perfil sin idv ni visual_alt → falla.
  - rodeo de otro establishment → falla.
  - category de otro sistema → falla.
  - UPDATE manual de categoría → `category_override` queda en true.
- **Cubre**: R4.2, R4.5, R4.6, R4.8.

### T1.11 Migration `0021_rls_animals_and_profiles.sql`
- Policies de `animal_profiles`: `select` (`has_role_in + deleted_at is null`), `insert` (`has_role_in`), `update` (`has_role_in`).
- Policies de `animals`: `select` (derivado de existencia de animal_profile con has_role_in), `insert` (autenticado), `update` (derivado).
- Aplicar grants ya hechos en `0018` y `0019` (idempotente).
- **Aceptación**: userA con perfil en estA puede ver el animal globalmente; userB sin rol en estA no lo ve (tests RLS reales).
- **Cubre**: R3.5, R11.1, R11.2, R11.3, R11.5.

### T1.12 Migration `0022_event_helpers.sql`
- Crear función `establishment_of_profile(profile_id uuid) returns uuid` security definer stable.
- Grant execute a authenticated.
- **Aceptación**: la función retorna el `establishment_id` correcto para un `animal_profile_id` dado.
- **Cubre**: utilidad para R11.2.

### T1.13 Migration `0023_event_created_by_helper.sql`
- Función trigger `tg_set_created_by_auth_uid` que llena `created_by` con `auth.uid()` si vino null.
- **Aceptación**: helper invocable desde triggers de eventos.
- **Cubre**: R6.7.

### T1.14 Migration `0024_weight_events.sql`
- Enum `event_source`.
- Tabla `weight_events` con campos del design + check `weight_kg > 0`.
- Index `(animal_profile_id, weight_date desc) where deleted_at is null`.
- Trigger `tg_set_created_by_auth_uid` BEFORE INSERT.
- RLS: select (`has_role_in(establishment_of_profile(...))`), insert (idem), update (`is_owner_of OR created_by = auth.uid()`).
- Grants.
- **Aceptación**: insert válido OK; userB sin rol no ve el evento; field_operator que cargó edita; otro field_operator que no lo cargó no edita.
- **Cubre**: R6.1, R6.6, R6.7, R6.8 (parte).

### T1.15 Migration `0025_reproductive_events.sql`
- Enums: `repro_event_type`, `service_type_enum`, `pregnancy_status_enum`.
- Tabla auxiliar `semen_registry` (campos del design + RLS).
- Tabla `reproductive_events` con todos los campos del design, incluyendo `calf_tag_electronic`.
- Index por `(animal_profile_id, event_date desc)`.
- Trigger created_by.
- RLS misma estructura que `weight_events`.
- **Aceptación**: insert válido OK; check de `calf_sex in ('male','female')` enforce.
- **Cubre**: R6.2, R6.6, R6.7, R6.8 (parte).

### T1.16 Migration `0026_sanitary_events.sql`
- Enums `sanitary_event_type`, `sanitary_route`.
- Tabla `sanitary_events` con campos del design.
- Index por `(animal_profile_id, event_date desc)`.
- Trigger created_by + RLS.
- Nota: el `campaign_id` queda como `uuid` sin FK por ahora (la tabla `sanitary_campaigns` viene en feature posterior). Documentar el TODO con un comment SQL.
- **Aceptación**: insert válido OK; RLS aislado.
- **Cubre**: R6.3, R6.6, R6.7, R6.8 (parte).

### T1.17 Migration `0027_condition_score_events.sql`
- Tabla `condition_score_events` con CHECK explícito sobre los 17 valores discretos de score.
- Index, trigger, RLS.
- **Aceptación**: insert con `score = 3.10` falla; con `3.00` OK.
- **Cubre**: R6.4, R6.6, R6.7, R6.8 (parte).

### T1.18 Migration `0028_lab_samples.sql`
- Enum `lab_sample_type`.
- Tabla `lab_samples` con campos del design.
- Indexes: por profile+fecha y por `tube_number`.
- Trigger created_by + RLS.
- **Aceptación**: insert válido OK; búsqueda por `tube_number` usa el index.
- **Cubre**: R6.5, R6.6, R6.7, R6.8 (parte).

### T1.19 Migration `0029_animal_category_history.sql`
- Enum `category_change_reason`.
- Tabla `animal_category_history` con campos del design.
- Trigger `tg_animal_profiles_record_category_change`:
  - AFTER INSERT en `animal_profiles` → reason `'initial'`.
  - AFTER UPDATE OF `category_id` en `animal_profiles` → reason según GUC y `category_override` previo.
- RLS: select con `has_role_in(establishment_of_profile(...))`. Insert solo vía trigger (no grant insert al cliente).
- **Aceptación**: crear un animal graba fila inicial; cambiar categoría manual graba `manual_override`; trigger automático graba `auto_transition` (validado en T1.20).
- **Cubre**: R10.3, R12.4.

### T1.20 Migration `0030_category_transitions.sql`
- Función `compute_category(profile_id uuid) returns uuid` security definer stable, con la lógica del design (sex + edad + conteo de partos + tacto positivo).
- Función `apply_auto_transition(profile_id uuid, target_category_id uuid)`: setea GUC `rafaq.is_auto_transition = 'on'`, UPDATE, GUC `'off'`.
- Trigger `tg_reproductive_events_apply_transition` AFTER INSERT en `reproductive_events`:
  - Si `category_override = true` → return.
  - Si `event_type = 'tacto'` con `pregnancy_status != 'empty'` y categoría actual `vaquillona` → target `vaquillona_prenada`.
  - Si `event_type = 'birth'` y categoría actual `vaquillona_prenada` → `vaca_segundo_servicio`.
  - Si `event_type = 'birth'` y categoría actual `vaca_segundo_servicio` → `multipara`.
  - Si target no existe → `raise warning` y retornar sin error (R7.5).
  - Si aplica → `apply_auto_transition`.
- Grants execute a authenticated.
- **Aceptación**: insertar tacto positivo sobre vaquillona cambia categoría; sobre vaquillona con `category_override=true` no cambia; insert de parto incrementa categoría; insert de birth sobre `multipara` no la cambia.
- **Cubre**: R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R4.9.

### T1.21 Migration `0031_calf_creation.sql`
- Función trigger `tg_reproductive_events_create_calf` BEFORE INSERT sobre `reproductive_events`:
  - Skip si `event_type != 'birth'` o `calf_id IS NOT NULL` o `calf_sex IS NULL`.
  - Crear `animals` (con TAG opcional desde `calf_tag_electronic`).
  - Crear `animal_profiles` con categoría inicial según sexo (`ternero | ternera`), `entry_origin = 'born_here'`, `visual_id_alt = 'recién nacido — pendiente de caravana'` solo si no hay TAG.
  - Setear `new.calf_id` = nuevo profile.id.
  - Cualquier exception rollbackea la transacción (R9.4).
- **Aceptación**: insertar parto con `calf_sex='female', calf_weight=35` crea automáticamente ternera con perfil y linkea; insertar parto con `calf_tag_electronic` duplicado falla y NO crea ni evento ni ternero.
- **Cubre**: R9.1, R9.2, R9.3, R9.4.

### T1.22 Migration `0032_animal_timeline.sql`
- Función `animal_timeline(profile_id uuid)` que retorna set unificado de eventos con `(event_kind, event_id, event_date, payload)`.
- Incluye 5 tablas de eventos + `animal_category_history`.
- Cada SELECT chequea `has_role_in(establishment_of_profile(profile_id))` (defensa adicional, las tablas ya tienen RLS).
- Order by `event_date desc`.
- Grant execute a authenticated.
- **Aceptación**: llamar la función para un animal con eventos retorna todos en orden cronológico; llamarla para un animal de otro establishment retorna 0 filas (RLS).
- **Cubre**: R10.1, R10.2.

### T1.23 Migration `0033_check_grants.sql` (housekeeping)
- Revisar y consolidar grants de todas las tablas/funciones nuevas.
- Cualquier permission que se haya escapado al rol `authenticated` queda fijada acá (sigue el patrón establecido por `0010_grants_fix.sql` de spec 01).
- **Aceptación**: `node scripts/check.mjs` verde; `select` desde cliente authenticated sobre cada tabla con RLS funciona end-to-end.
- **Cubre**: housekeeping.

## Fase 2 — Tests reales contra DB remota

Patrón heredado de spec 01: tests Node nativo en `supabase/tests/`, login con users de prueba, ejercen las policies y triggers, y limpian al final.

### T2.1 Suite `supabase/tests/animal/run.cjs` (esqueleto)
- Crear runner Node nativo siguiendo el patrón de `supabase/tests/rls/run.cjs`.
- Setup: crear `userA` (owner de `estA`) y `userB` (owner de `estB`) via service role; verificar que `estA` y `estB` reciben rodeo default automáticamente.
- Helper para crear animales rápido: `createAnimal(client, { tag?, idv?, visualAlt?, sex, birthDate?, rodeoId? })` que hace insert en `animals` + `animal_profiles` con el patrón split (sin `.select()` + select separado).
- **Aceptación**: skeleton corre con 0 tests y termina limpio.

### T2.2 Tests: identificación flexible (R4.2)
- Caso 1: animal con solo TAG → OK.
- Caso 2: animal con solo IDV → OK.
- Caso 3: animal con solo `visual_id_alt` → OK.
- Caso 4: animal sin ninguno → falla con código `23514`.
- Caso 5: TAG duplicado entre dos campos → falla con unique violation.
- Caso 6: IDV duplicado dentro del mismo campo → falla; IDV duplicado entre dos campos → OK.
- **Aceptación**: 6 tests verdes.
- **Cubre**: R4.2, R3.2, R4.3.

### T2.3 Tests: categoría auto-calculada al alta (R4.7)
- Hembra con `birth_date = hoy - 6 meses` → categoría `ternera`.
- Hembra con `birth_date = hoy - 18 meses` y sin eventos previos → `vaquillona`.
- Macho con `birth_date = hoy - 6 meses` → `ternero`.
- Macho sin `birth_date` → `torito` (default conservador).
- **Aceptación**: 4 tests verdes.
- **Cubre**: R4.7.

### T2.4 Tests: transiciones automáticas (R7.1..R7.5)
- Vaquillona + tacto positivo (`pregnancy_status = 'medium'`) → categoría pasa a `vaquillona_prenada` y `category_override` queda `false`.
- Vaquillona preñada + evento `birth` → `vaca_segundo_servicio`.
- Vaca segundo servicio + segundo `birth` → `multipara`.
- Multípara + tercer `birth` → categoría no cambia (no hay transición desde `multipara`).
- Vaquillona con `category_override = true` + tacto positivo → categoría NO cambia.
- Vaquillona + tacto con `pregnancy_status = 'empty'` → categoría NO cambia.
- `animal_category_history` registra cada cambio con `reason = 'auto_transition'`.
- **Aceptación**: 7 tests verdes.
- **Cubre**: R7.1, R7.2, R7.3, R7.4, R7.5, R4.9, R10.3, R12.4.

### T2.5 Tests: override manual y revert (R4.8, R4.10)
- UPDATE manual de `category_id` desde cliente → trigger pone `category_override = true` y `animal_category_history.reason = 'manual_override'`.
- UPDATE de `category_override = false` + UPDATE de `category_id = compute_category(id)` → categoría se recalcula y `animal_category_history.reason = 'revert_to_auto'`.
- **Aceptación**: 2 tests verdes.
- **Cubre**: R4.8, R4.10, R7.6.

### T2.6 Tests: CUT manual (R8)
- Update directo de `is_cut = true` + `category_id = (cut)` + `category_override = true` desde la ficha → OK.
- Verificar que las policies permiten el update a field_operator y veterinarian (R11.5).
- Test del prompt automático queda como **manual test guideline** (es UX cliente, no SQL).
- **Aceptación**: 2 tests verdes (los manuales se documentan en `progress/impl_02-modelo-animal.md`).
- **Cubre**: R8.4, R8.5.

### T2.7 Tests: ternero al pie (R9)
- Insertar `reproductive_events` con `event_type='birth', calf_sex='female', calf_weight=35` sobre una vaquillona preñada.
  - Verifica: `calf_id` no es null tras el insert; `animal_profiles` del ternero existe con `category.code = 'ternera'`, `entry_origin = 'born_here'`, `visual_id_alt = 'recién nacido — pendiente de caravana'`.
  - Verifica que la madre transicionó a `vaca_segundo_servicio` (transición AFTER INSERT corre después del BEFORE INSERT que creó al ternero).
- Insertar parto con `calf_tag_electronic` provisto → ternero creado con TAG y SIN fallback en `visual_id_alt`.
- Insertar parto con `calf_tag_electronic` duplicado → falla; `select` posterior confirma que ni el evento ni el ternero quedaron persistidos (rollback transaccional, R9.4).
- **Aceptación**: 3 tests verdes.
- **Cubre**: R9.1, R9.2, R9.3, R9.4.

### T2.8 Tests: RLS de animales y eventos (R11)
- userA crea animal en estA; userB intenta `select` → 0 filas.
- userA crea evento; userB no lo ve.
- userA es field_operator en estA, userB es veterinarian. Ambos pueden insertar eventos sobre animales de estA.
- userA crea evento; userB con rol de owner en estA puede `update`; userB sin ser owner ni creador no puede.
- field_operator intenta crear un rodeo en estA → falla; owner OK.
- userA con perfil en estA puede leer el animal global; userB sin rol no.
- **Aceptación**: 6 tests verdes.
- **Cubre**: R11.1, R11.2, R11.3, R11.4, R11.5, R6.8.

### T2.9 Tests: rodeo default + validaciones (R2)
- Crear establishment → verificar fila en `rodeos` con `(bovino, cria, name='Rodeo principal')`.
- Owner intenta crear rodeo `(bovino, invernada)` → falla por system inactive (23514).
- Owner soft-deletes rodeo con animales activos → falla con error explícito.
- **Aceptación**: 3 tests verdes.
- **Cubre**: R2.2, R2.4, R2.5, R2.6.

### T2.10 Tests: cronología (R10)
- Animal con 1 peso + 1 tacto + 1 sanitario → `animal_timeline(profile_id)` retorna 3 eventos + 1 `category_change` (el initial). Total 4 filas.
- Otro user sin rol → 0 filas.
- Orden por `event_date desc` verificable.
- **Aceptación**: 3 tests verdes.
- **Cubre**: R10.1, R10.2.

### T2.11 Tests: búsqueda fuzzy (R5)
- Crear animal con `visual_id_alt = 'vaca blanca mancha pata izquierda'`.
- Búsqueda con `'vaca blanca'` → encuentra (similarity ≥ 0.3).
- Búsqueda con `'toro negro'` → no encuentra.
- Búsqueda por TAG exacto → encuentra; mismo TAG buscado por userB sin rol → 0 filas (RLS).
- **Aceptación**: 4 tests verdes.
- **Cubre**: R5.1, R5.2, R5.3, R5.4.

### T2.12 Hook al runner global
- Agregar la suite `animal/run.cjs` al runner `scripts/run-tests.mjs` (heredado de spec 01).
- `node scripts/check.mjs` debe ejecutar y reportar verde el nuevo set de tests.
- **Aceptación**: `check.mjs` corre Fase 2 entera y queda verde.
- **Cubre**: housekeeping.

## Fase 3 — Cliente: contextos y servicios base

> **Estado**: pausado intencionalmente hasta que Raf retome el frontend con el stack del `ADR-013`. Las tareas quedan documentadas y listas para retomarse después.

### T3.1 `RodeoContext`
- `app/src/contexts/RodeoContext.tsx` con estado loading/no_rodeos/active.
- Auto-select del único rodeo activo del establishment cuando hay uno solo.
- Persistencia del rodeo activo en `expo-secure-store` por establishment.
- **Aceptación**: `useRodeo()` retorna el rodeo activo del establishment activo; cambia con `switchRodeo`.
- **Cubre**: pre-requisito UI de R2, R4.

### T3.2 Servicio `app/src/services/animals.ts`
- Funciones (sin tocar UI):
  - `createAnimal(form): Promise<AnimalProfile>` con patrón split insert + select (`ADR-012`).
  - `fetchAnimals(filter): Promise<AnimalListItem[]>`.
  - `fetchAnimalDetail(profileId): Promise<AnimalDetail>` (incluye `animals.*` joined).
  - `fetchAnimalTimeline(profileId): Promise<TimelineEvent[]>` llamando a `animal_timeline(...)`.
  - `searchByTag / searchByIdv / searchByVisualAlt`.
  - `updateAnimalCategory(profileId, categoryId)` (marca override por trigger).
  - `revertCategoryOverride(profileId)` (set override=false + recompute).
  - `markCut(profileId)`.
- Todas las funciones tipadas, sin `any`, errores `Result<T, AppError>`.
- **Aceptación**: unit tests con cliente Supabase mock + integración liviana.
- **Cubre**: R3.5, R4.*, R5.*, R10, soporte de R14.

### T3.3 Servicio `app/src/services/events.ts`
- `createWeightEvent`, `createReproductiveEvent`, `createSanitaryEvent`, `createConditionScoreEvent`, `createLabSample`.
- `softDeleteEvent(kind, eventId)`.
- **Aceptación**: cada función inserta correctamente con `created_by = auth.uid()` (asignado por trigger).
- **Cubre**: R6, R10 (datos para timeline).

### T3.4 Módulo TypeScript de transiciones
- `app/src/services/category/transitions.ts` con `computeCategory(input)` espejado del SQL.
- `previewTransition(profile, newEvent)` para preview offline.
- Tests unitarios cubren los caminos de R7.
- **Aceptación**: misma lógica que el trigger SQL — verificado con tabla de casos.
- **Cubre**: R13.4 (preview offline).

### T3.5 Hooks (`useAnimals`, `useAnimal`, `useAnimalTimeline`, `useSearchAnimal`, `useCategories`)
- Cada hook orquesta el service correspondiente y expone estado de loading/error/data.
- **Aceptación**: cobertura de los flujos del cliente vía RTL component-tests donde el hook se usa.
- **Cubre**: soporte de R14, R15.

## Fase 4 — Cliente: pantallas

### T4.1 `AnimalListScreen` (tab Animales)
- Lista paginada de `animal_profiles` activos del establishment activo, filtrable por rodeo y estado.
- Tap → `AnimalDetailScreen`.
- CTA "Buscar / Crear" → `AnimalSearchScreen`.
- **Aceptación**: 50 animales se cargan sin lag perceptible (PowerSync local).
- **Cubre**: R14.1 (parcial).

### T4.2 `AnimalSearchScreen` (R5, R15.1)
- Tres inputs (TAG, IDV, visual_alt) + botón "Buscar".
- Orden de búsqueda según R5.
- Si no encuentra → CTA "Crear este animal" con pre-poblado.
- **Aceptación**: búsqueda por cada uno de los tres campos retorna el animal correcto; "no encontrado" lleva al alta.
- **Cubre**: R5.1, R5.2, R5.3, R5.4, R15.1.

### T4.3 `AnimalCreateScreen` (R15.3, R15.4)
- Form con identificadores, sex, birth_date opcional, rodeo (default único), breed, coat_color, entry_*.
- Validación local R13.3 (al menos uno de tres identificadores) — botón "Crear" deshabilitado si no.
- Preview de categoría calculada (R4.7) read-only con toggle para override.
- Submit → service.createAnimal.
- **Aceptación**: alta funciona offline + online; constraint local impide envío inválido.
- **Cubre**: R4.7, R13.3, R15.3, R15.4, R15.5.

### T4.4 `AnimalDetailScreen` — ficha del animal (R14)
- Cabecera con campos del R14.2.
- Sección "Categoría" con valor actual + toggle de override (R14.5).
- Botón "Marcar como CUT" con confirmación (R14.6, R8.5).
- Cronología renderizada desde `useAnimalTimeline` (R10), componente por tipo (R14.3).
- Si es ternero/ternera: link a la ficha de la madre (R14.7) — query inversa: `select * from reproductive_events where calf_id = profile_id` y navegar a `animal_profile_id` resultado.
- Editar/borrar evento solo si owner o creador (R14.4).
- **Aceptación**: ficha muestra >= 3 tipos de eventos en orden; toggle de override funciona; CUT actualiza la categoría visible.
- **Cubre**: R10, R14.

### T4.5 `RodeosScreen` (Settings, owner-only)
- Lista de rodeos del establishment con estado.
- Solo owner ve los botones de crear / soft-delete.
- Form de crear rodeo: name + species + system, con dropdowns filtrados a combinaciones activas (en MVP solo `(bovino, cria)`).
- **Aceptación**: field_operator ve la lista read-only; owner crea y soft-deletes.
- **Cubre**: R2.2, R2.3, R2.5.

### T4.6 Prompt CUT automático al cargar dientes (R8.4)
- Cuando el form de "actualizar dientes" del animal cierra con value en `('1/2','1/4','sin_dientes')` y `is_cut = false`, mostrar modal con dos botones explícitos.
- Si confirma → llamar `service.markCut`.
- No mostrar el prompt para terneros/terneras (R8.3).
- **Aceptación**: prompt aparece exactamente en los 3 valores; no aparece para terneros.
- **Cubre**: R8.1, R8.2, R8.3, R8.4.

## Fase 5 — PowerSync

### T5.1 Sync rules para tablas de este spec
- Definir buckets del `design.md` (`est_rodeos`, `est_animal_profiles`, `est_animals_local`, `est_*_events`, `est_animal_category_history`, `est_semen_registry`, `config_global`).
- **Aceptación**: cliente PowerSync sincroniza solo datos del establishment activo + globals.
- **Cubre**: R13.1.

### T5.2 Operaciones offline para alta y eventos
- Verificar que `createAnimal` y `createWeightEvent` (y resto) funcionan con red apagada.
- Encolar offline, sincronizar al volver.
- **Aceptación**: end-to-end test manual: airplane mode, alta + evento, vuelve red, todo sincroniza sin error.
- **Cubre**: R13.2.

### T5.3 Preview offline de transiciones
- Integrar `transitions.ts` (T3.4) en el flujo: cuando se carga un evento offline, mostrar la categoría preview en la UI con un badge "(preview)".
- Al sincronizar, refrescar el dato del server.
- **Aceptación**: cargar tacto positivo offline muestra preview `vaquillona_prenada`; al sincronizar coincide con el server.
- **Cubre**: R13.4.

### T5.4 Refresh de tablas de configuración
- Forzar refresh de `species`, `systems_by_species`, `categories_by_system` al primer login del día.
- **Aceptación**: cambios en seed (futuro) llegan al cliente sin reinstall.
- **Cubre**: R13.5.

## Fase 6 — QA y cierre

### T6.1 Suite Detox / Maestro (heredada del `ADR-013`)
- Flujos end-to-end: crear animal, registrar tacto positivo, ver transición en la ficha, registrar parto, ver ternero creado.
- **Aceptación**: 4 flujos pasan en CI.

### T6.2 Auditoría de RLS manual
- `psql` con JWT de userA intenta accionar sobre datos de userB → cero acceso confirmado.
- Repetir para cada tabla nueva.
- **Aceptación**: cero leaks documentados.

### T6.3 Documentación de cierre
- Actualizar `CONTEXT/07-pendientes.md` con preguntas que hayan surgido durante implementación.
- Si hubo decisiones nuevas → ADRs.
- Mover spec de `specs/active/` a `specs/completed/` si se cierra completa, o mantener si solo se cierra backend (mismo patrón que spec 01).
- **Aceptación**: docs reflejan el estado real al cerrar; `feature_list.json` actualizado.

## Resumen de dependencias críticas

```
T1.1 → T1.2..T1.7 (config + rodeos + helper)
                     ↓
                   T1.8..T1.11 (animals + profiles + RLS)
                     ↓
                   T1.12..T1.18 (helpers + tablas de eventos)
                     ↓
                   T1.19 (category_history)
                     ↓
                   T1.20 (transitions) ← requiere T1.19 para grabar historial
                     ↓
                   T1.21 (calf creation) ← BEFORE INSERT corre antes que T1.20 AFTER INSERT
                     ↓
                   T1.22 (timeline) ← requiere todas las tablas de eventos
                     ↓
                   T1.23 (grants housekeeping)
                     ↓
                   Fase 2 (T2.1..T2.12)
                     ↓
                   ⏸ PUERTA: opcional cerrar acá si frontend sigue diferido
                     ↓
                   Fase 3+ (cuando se retome el frontend)
```

## Trazabilidad R<n> → tasks

| Requirement | Tasks |
|---|---|
| R1.1 | T1.2 |
| R1.2 | T1.3 |
| R1.3 | T1.4 |
| R1.4, R1.5 | T1.2, T1.3, T1.4 |
| R2.1, R2.2, R2.3, R2.4 | T1.5 |
| R2.5 | T1.5 (constraint), T2.9 |
| R2.6 | T1.6, T2.9 |
| R3.1..R3.4 | T1.8 |
| R3.5 | T1.11, T2.8 |
| R4.1 | T1.9 |
| R4.2 | T1.10, T2.2 |
| R4.3 | T1.9, T2.2 |
| R4.4 | T1.9 (index trgm), T2.11 |
| R4.5 | T1.10 |
| R4.6 | T1.10 |
| R4.7 | T1.20 (compute_category), T2.3 |
| R4.8 | T1.10, T2.5 |
| R4.9 | T1.20, T2.4 |
| R4.10 | T1.20 (compute_category), T2.5 |
| R4.11 | T1.9 (unique index), T2.2 |
| R4.12 | T1.9 (status enum + filtro lógico) |
| R5.1, R5.2, R5.3, R5.4 | T1.9 (índices), T4.2, T2.11 |
| R6.1..R6.5 | T1.14..T1.18 |
| R6.6 | T1.14..T1.18 (FK constraints) |
| R6.7 | T1.13, T1.14..T1.18 |
| R6.8 | T1.14..T1.18 (policies), T2.8 |
| R7.1..R7.5 | T1.20, T2.4 |
| R7.6 | T1.20, T2.5 |
| R8.1, R8.2 | T1.9 (teeth_state enum) |
| R8.3 | T4.6 |
| R8.4, R8.5 | T4.6, T2.6 |
| R9.1..R9.4 | T1.21, T2.7 |
| R10.1, R10.2 | T1.22, T2.10 |
| R10.3 | T1.19, T2.4 |
| R11.1..R11.5 | T1.11, T1.14..T1.18 (policies), T2.8 |
| R12.1..R12.3 | T1.8, T1.9, T1.14..T1.18 (campos deleted_at) |
| R12.4 | T1.19, T2.4 |
| R13.1 | T5.1 |
| R13.2 | T5.2 |
| R13.3 | T4.3 |
| R13.4 | T3.4, T5.3 |
| R13.5 | T5.4 |
| R14.1..R14.7 | T4.1, T4.4 |
| R15.1..R15.5 | T4.2, T4.3 |

## Notas de ejecución

- Cada migration termina con commit en español, presente, descriptivo (`agrega ...`, `crea ...`, `enforce ...`).
- Si una tarea descubre algo que cambia la arquitectura → crear ADR antes de seguir.
- Si una tarea expone una pregunta nueva al vet socio → registrarla en `CONTEXT/07-pendientes.md`.
- Patrón **split insert + select** (`ADR-012`) sigue siendo la norma para inserts que disparan triggers (animal_profiles, reproductive_events).
- Tests Fase 2 corren contra DB remota — requieren `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`. El runner saltea con warning si no está, no rompe `check.mjs`.
- Si en revisión del spec se decide que el bulk-edit de animales hace falta en MVP, agregar Edge Function `bulk_edit_animals` en una T1.24 entre T1.22 y T1.23.
- Las tareas Fase 3+ están **listas para diferirse**: cerrar Fase 1+2 alcanza para declarar el backend completo, replicando el patrón de spec 01.
