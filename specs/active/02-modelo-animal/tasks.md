# Spec 02 — Tasks

**Status**: Aprobada 2026-05-26 · refundida 2026-05-28 (incorpora ADR-020 lote + ADR-021 plantilla de datos).
**Fecha original**: 2026-05-25

> El historial de refinamientos vive en el **Changelog** al final de este documento.

Plan de implementación paso a paso. Cada tarea tiene su criterio de aceptación y los `R<n>` que cubre. El orden importa: dependencias hacia adelante.

**Fases sugeridas para esta feature**:

- **Fase 1 — Schema + triggers + RLS**: migrations `0012..0037`. Backend puro.
- **Fase 2 — Tests reales contra DB remota**: extensiones del runner `supabase/tests/rls/` y un nuevo `supabase/tests/animal/` para triggers de transición, plantilla, lote y ternero al pie.
- **Fase 3+ — Cliente**: hooks, contextos, pantallas, PowerSync, tests Detox.

Igual que con spec 01, la feature se puede cerrar tras Fase 1+2 y **diferir Fase 3+** hasta que Raf retome el frontend con el stack del `ADR-013`. Los tests de Fase 2 demuestran que el modelo es operativo end-to-end vía Supabase.

## Fase 1 — Schema, triggers y RLS

### [x] T1.1 Verificar prerequisitos
- Confirmar que la extension `pg_trgm` está habilitada en el proyecto remoto: `select * from pg_extension where extname = 'pg_trgm';` (Supabase la incluye por default desde Postgres 13).
- Confirmar que el patrón de migrations posterior a `0011` no rompe el estado actual: `supabase db push` corriendo en seco contra el remoto sin pending changes.
- **Aceptación**: `pg_trgm` está habilitada (o se habilita en `0012_species.sql` con `create extension if not exists pg_trgm`). `node scripts/check.mjs` verde antes de empezar.

### [x] T1.2 Migration `0012_species.sql`
- Crear tabla `public.species` con `(id, code, name, icon, active, created_at, updated_at)`.
- Seed: `bovino` (`active=true`), `equino` y `porcino` (`active=false`).
- `enable RLS` + policy `species_select` para `authenticated`. `grant select` solamente.
- **Aceptación**: `select * from species` desde cliente anon-key retorna las 3 filas; no se puede insert/update.
- **Cubre**: R1.1, R1.4, R1.5.

### [x] T1.3 Migration `0013_systems_by_species.sql`
- Crear tabla con `(id, species_id, code, name, active, created_at, updated_at)` y unique `(species_id, code)`.
- Seed para bovino: `cria` (active=true), resto (`tambo`, `cabana`, `invernada`, `feedlot`) inactive.
- RLS + grant select.
- **Aceptación**: cliente lee `(bovino, cria, active=true)`; otras combinaciones existen pero `active=false`.
- **Cubre**: R1.2, R1.4, R1.5.

### [x] T1.4 Migration `0014_categories_by_system.sql`
- Crear tabla con todos los campos del design.
- Seed de las 10 categorías de `(bovino, cria)` listadas en R1.3.
- RLS + grant select.
- **Aceptación**: las 10 categorías del seed presentes y legibles; insert desde cliente authenticated falla por falta de policy.
- **Cubre**: R1.3, R1.4, R1.5.

### [x] T1.5 Migration `0015_rodeos.sql`
- Crear tabla `public.rodeos` con campos del design.
- Trigger `tg_rodeos_validate_species_system` (BEFORE INSERT OR UPDATE): rechaza si `(species_id, system_id)` no existe o `active=false`.
- Trigger `rodeos_set_updated_at` reusando `tg_set_updated_at_generic` (helper de spec 01 / consolidado en `0017`).
- RLS: `select` con `has_role_in(establishment_id)`, `insert/update` con `is_owner_of(establishment_id)`. `grant select, insert, update` to authenticated. No grant delete (soft via update).
- **Aceptación**: owner crea rodeo OK; field_operator falla con 42501; combinación `(bovino, invernada)` (system inactive) falla con 23514.
- **Cubre**: R2.1, R2.2, R2.3, R2.4.

### [x] T1.6 Migration `0016_field_template_and_rodeo_config.sql` — plantilla de datos (ADR-021)
> Tres tablas de la plantilla de datos en una sola migration (unidad lógica). Reemplaza el modelo buggeado `system_data_templates` por-sistema. Ver design.md § "Plantilla de datos".

- **Tabla `field_definitions`** (catálogo GLOBAL): `(id, data_key unique, label, description, category, data_type, ui_component, config_schema jsonb, schema_version, active, created_at, updated_at)` + index `(category) where active`.
- **Seed de `field_definitions`**: 26 fields de cría según ADR-021 (reproductivo, productivo, sanitario, manejo, comercial). data_keys ASCII (`prenez`, `tamano_prenez`, `condicion_corporal`, etc.). **TENTATIVO** hasta validar con Facundo.
- **Tabla `system_default_fields`**: `(id, system_id FK, field_definition_id FK, default_enabled, required_for_system, sort_order)` + `unique(system_id, field_definition_id)` + index `(system_id, sort_order)`.
- **Seed de `system_default_fields`** para `(bovino, cría)`: las 26 filas, con `default_enabled = false` para `inseminacion`, `peso_nacimiento`, `tuberculosis` y `true` para las 23 restantes. `required_for_system = false` en todas (cría MVP).
- **Tabla `rodeo_data_config`**: `(rodeo_id FK ON DELETE CASCADE, field_definition_id FK, enabled, custom_config jsonb, created_at, updated_at)` + PK `(rodeo_id, field_definition_id)` + index `(rodeo_id) where enabled` + index `(field_definition_id) where enabled`.
- Trigger `tg_rodeos_seed_data_config` (AFTER INSERT en `rodeos`, security definer): pre-popula `rodeo_data_config` con una fila por cada `system_default_fields` del `system_id` del rodeo, copiando `default_enabled` → `enabled`. **No** hay trigger de validación contra el sistema (el FK a `field_definitions` basta; se permite habilitar fields no-default).
- Triggers `updated_at` en las tres tablas usando `tg_set_updated_at_generic`.
- RLS: `field_definitions` y `system_default_fields` read-only (`select` a `authenticated`, sin INSERT/UPDATE/DELETE). `rodeo_data_config`: `select` con `has_role_in(rodeos.establishment_id)` vía join; `insert` y `update` con `is_owner_of(rodeos.establishment_id)` vía join (INSERT habilita field no-default — caso "tambo + preñez"); **no** policy DELETE.
- Grants: `select` sobre catálogos; `select, insert, update` sobre `rodeo_data_config`.
- **Aceptación**:
  - `select count(*) from field_definitions where active` = 26.
  - `select count(*) from system_default_fields sdf join systems_by_species s on s.id = sdf.system_id ... where (bovino,cría)` = 26; de esas, 23 con `default_enabled = true`.
  - Cliente authenticated intenta `insert into field_definitions` → falla (no policy). Idem `system_default_fields`.
  - Owner crea rodeo `(bovino, cría)` → `select count(*) from rodeo_data_config where rodeo_id = ?` = 26; 23 con `enabled = true`.
  - Owner toggles `update rodeo_data_config set enabled = false` sobre un field existente → OK. `field_operator` intenta el mismo UPDATE → falla por RLS.
  - **Caso tambo + preñez**: en un rodeo cuyo sistema NO tiene `prenez` como default, el owner hace `insert into rodeo_data_config (rodeo_id, field_definition_id, enabled) values (?, (id de prenez), true)` → **OK** (el field existe en el catálogo global). En MVP esto se prueba con cría (que sí lo tiene como default); el caso real se valida cuando se active tambo, pero el INSERT owner de un field arbitrario del catálogo debe funcionar ya.
- **Cubre**: R2.6 (no rodeo default — no hay trigger de auto-creación), R2.8, R2.9, R2.10, R2.11, R2.12, R2.13.

### [x] T1.7 Migration `0017_generic_updated_at.sql`
- Crear (o consolidar) función `tg_set_updated_at_generic`.
- Si ya existía con otro nombre en spec 01 (`tg_establishments_set_updated_at` es específica de `establishments`), agregar la genérica acá.
- **Aceptación**: función creable; reusable desde T1.5, T1.6 y futuras.
- **Cubre**: utilidad para R2, R3, R4.

### [x] T1.8 Migration `0018_animals.sql`
- Crear tabla `public.animals` con campos del design.
- Unique index parcial `animals_tag_unique` sobre `(tag_electronic) where tag_electronic is not null and deleted_at is null`.
- Trigger `tg_animals_validate_species` BEFORE INSERT/UPDATE: rechaza species_id inactiva.
- Trigger updated_at.
- `enable RLS` + grants. Policies de SELECT/INSERT/UPDATE se definen en `0021_rls_animals_and_profiles.sql` (la SELECT depende de animal_profiles, que se crea en `0019`).
- **Aceptación**: insert con `species_id` de bovino activo OK; con `equino` (inactivo) falla con 23514; dos animals con mismo tag fallan por unique.
- **Cubre**: R3.1, R3.2, R3.3, R3.4.

### [x] T1.9 Migration `0019_animal_profiles.sql`
- Crear enum `animal_status` y `teeth_state_enum`.
- Crear tabla `public.animal_profiles` con todos los campos del design. **No** incluye `management_group_id` todavía (se agrega vía ALTER en `0036`, porque `management_groups` se crea ahí).
- Indexes: `animal_profiles_idv_unique` (parcial), `animal_profiles_active_animal_unique` (parcial), `animal_profiles_visual_alt_trgm` (GIN trgm), `animal_profiles_by_est`, `animal_profiles_by_rodeo`, `animal_profiles_by_animal`.
- Trigger updated_at.
- `enable RLS` + grants. Policies en `0021`.
- **Aceptación**: insert válido OK; insert con `(establishment_id, idv)` duplicado falla por unique; dos perfiles activos para el mismo `animal_id` falla por unique parcial.
- **Cubre**: R4.1 (parcial — la columna `management_group_id` la cubre T1.27), R4.3, R4.4, R4.11.

### [x] T1.10 Migration `0020_animal_profiles_validations.sql`
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

### [x] T1.11 Migration `0021_rls_animals_and_profiles.sql`
- Policies de `animal_profiles`: `select` (`has_role_in + deleted_at is null`), `insert` (`has_role_in`), `update` (`has_role_in`). El UPDATE de `management_group_id` (asignar lote) queda cubierto por esta misma policy de update (cualquier rol operativo, R11.5).
- Policies de `animals`: `select` (derivado de existencia de animal_profile con has_role_in), `insert` (autenticado), `update` (derivado).
- Aplicar grants ya hechos en `0018` y `0019` (idempotente).
- **Aceptación**: userA con perfil en estA puede ver el animal globalmente; userB sin rol en estA no lo ve (tests RLS reales).
- **Cubre**: R3.5, R11.1, R11.2, R11.3, R11.5.

### [x] T1.12 Migration `0022_event_helpers.sql`
- Crear función `establishment_of_profile(profile_id uuid) returns uuid` security definer stable.
- Grant execute a authenticated.
- **Aceptación**: la función retorna el `establishment_id` correcto para un `animal_profile_id` dado.
- **Cubre**: utilidad para R11.2.

### [x] T1.13 Migration `0023_event_created_by_helper.sql`
- Función trigger `tg_set_created_by_auth_uid` que llena `created_by` con `auth.uid()` si vino null.
- **Aceptación**: helper invocable desde triggers de eventos.
- **Cubre**: R6.7.

### [x] T1.14 Migration `0024_weight_events.sql`
- Enum `event_source`.
- Tabla `weight_events` con campos del design + check `weight_kg > 0`.
- Index `(animal_profile_id, weight_date desc) where deleted_at is null`.
- Trigger `tg_set_created_by_auth_uid` BEFORE INSERT.
- RLS: select (`has_role_in(establishment_of_profile(...))`), insert (idem), update (`is_owner_of OR created_by = auth.uid()`).
- Grants.
- **Aceptación**: insert válido OK; userB sin rol no ve el evento; field_operator que cargó edita; otro field_operator que no lo cargó no edita.
- **Cubre**: R6.1, R6.6, R6.7, R6.8 (parte).

### [x] T1.15 Migration `0025_reproductive_events.sql`
- Enums: `repro_event_type`, `service_type_enum`, `pregnancy_status_enum`.
- Tabla auxiliar `semen_registry` (campos del design + RLS).
- Tabla `reproductive_events` con todos los campos del design, incluyendo `calf_tag_electronic`.
- Index por `(animal_profile_id, event_date desc)`.
- Trigger created_by.
- RLS misma estructura que `weight_events`.
- **Aceptación**: insert válido OK; check de `calf_sex in ('male','female')` enforce.
- **Cubre**: R6.2, R6.6, R6.7, R6.8 (parte).

### [x] T1.16 Migration `0026_sanitary_events.sql`
- Enums `sanitary_event_type`, `sanitary_route`.
- Tabla `sanitary_events` con campos del design.
- Index por `(animal_profile_id, event_date desc)`.
- Trigger created_by + RLS.
- Nota: el `campaign_id` queda como `uuid` sin FK por ahora (la tabla `sanitary_campaigns` viene en feature posterior). Documentar el TODO con un comment SQL.
- **Aceptación**: insert válido OK; RLS aislado.
- **Cubre**: R6.3, R6.6, R6.7, R6.8 (parte).

### [x] T1.17 Migration `0027_condition_score_events.sql`
- Tabla `condition_score_events` con CHECK explícito sobre los 17 valores discretos de score.
- Index, trigger, RLS.
- **Aceptación**: insert con `score = 3.10` falla; con `3.00` OK.
- **Cubre**: R6.4, R6.6, R6.7, R6.8 (parte).

### [x] T1.18 Migration `0028_lab_samples.sql`
- Enum `lab_sample_type`.
- Tabla `lab_samples` con campos del design.
- Indexes: por profile+fecha y por `tube_number`.
- Trigger created_by + RLS.
- **Aceptación**: insert válido OK; búsqueda por `tube_number` usa el index.
- **Cubre**: R6.5, R6.6, R6.7, R6.8 (parte).

### [x] T1.19 Migration `0029_animal_category_history.sql`
- Enum `category_change_reason`.
- Tabla `animal_category_history` con campos del design.
- Trigger `tg_animal_profiles_record_category_change`:
  - AFTER INSERT en `animal_profiles` → reason `'initial'`.
  - AFTER UPDATE OF `category_id` en `animal_profiles` → reason según GUC y `category_override` previo.
- RLS: select con `has_role_in(establishment_of_profile(...))`. Insert solo vía trigger (no grant insert al cliente).
- **Aceptación**: crear un animal graba fila inicial; cambiar categoría manual graba `manual_override`; trigger automático graba `auto_transition` (validado en T1.20).
- **Cubre**: R10.3, R12.4.

### [x] T1.20 Migration `0030_category_transitions.sql`
- Función `compute_category(profile_id uuid) returns uuid` security definer stable, con la lógica del design (sex + edad + conteo de partos + tacto positivo).
- Función `apply_auto_transition(profile_id uuid, target_category_id uuid)`: setea GUC `rafaq.is_auto_transition = 'on'`, UPDATE de **solo** `category_id`, GUC `'off'`. **No** toca `rodeo_id` ni `management_group_id` (ortogonalidad, R7.7).
- Trigger `tg_reproductive_events_apply_transition` AFTER INSERT en `reproductive_events`:
  - Si `category_override = true` → return.
  - Si `event_type = 'tacto'` con `pregnancy_status != 'empty'` y categoría actual `vaquillona` → target `vaquillona_prenada`.
  - Si `event_type = 'birth'` y categoría actual `vaquillona_prenada` → `vaca_segundo_servicio`.
  - Si `event_type = 'birth'` y categoría actual `vaca_segundo_servicio` → `multipara`.
  - Si target no existe → `raise warning` y retornar sin error (R7.5).
  - Si aplica → `apply_auto_transition`.
- Grants execute a authenticated.
- **Aceptación**: insertar tacto positivo sobre vaquillona cambia categoría; sobre vaquillona con `category_override=true` no cambia; insert de parto incrementa categoría; insert de birth sobre `multipara` no la cambia.
- **Cubre**: R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R7.7, R4.9.

### [x] T1.21 Migration `0031_calf_creation.sql`
- Función trigger `tg_reproductive_events_create_calf` BEFORE INSERT sobre `reproductive_events`:
  - Skip si `event_type != 'birth'` o `calf_id IS NOT NULL` o `calf_sex IS NULL`.
  - Crear `animals` (con TAG opcional desde `calf_tag_electronic`).
  - Crear `animal_profiles` con categoría inicial según sexo (`ternero | ternera`), `entry_origin = 'born_here'`, `visual_id_alt = 'recién nacido — pendiente de caravana'` solo si no hay TAG. (El ternero nace con `management_group_id = NULL` — columna agregada en 0036; al correr el trigger post-0036 el default es NULL, R9.1.)
  - Setear `new.calf_id` = nuevo profile.id.
  - Cualquier exception rollbackea la transacción (R9.4).
- **Aceptación**: insertar parto con `calf_sex='female', calf_weight=35` crea automáticamente ternera con perfil y linkea; insertar parto con `calf_tag_electronic` duplicado falla y NO crea ni evento ni ternero.
- **Cubre**: R9.1, R9.2, R9.3, R9.4.

### [x] T1.22 Migration `0032_animal_timeline.sql`
- Función `animal_timeline(profile_id uuid)` que retorna set unificado de eventos con `(event_kind, event_id, event_date, payload)`.
- Incluye 5 tablas de eventos + `animal_category_history`.
- Cada SELECT chequea `has_role_in(establishment_of_profile(profile_id))` (defensa adicional, las tablas ya tienen RLS).
- Order by `event_date desc`.
- Grant execute a authenticated.
- **Aceptación**: llamar la función para un animal con eventos retorna todos en orden cronológico; llamarla para un animal de otro establishment retorna 0 filas (RLS).
- **Cubre**: R10.1, R10.2.

### [x] T1.24 Migration `0033_animal_events.sql` (modelo Híbrido)
- Crear tabla `public.animal_events` con `(id, animal_profile_id, establishment_id, author_id, created_at, event_type, text, structured_payload, edit_window_until, deleted_at)`.
- CHECK constraint `event_type in ('observacion','otro')` — alcance acotado por modelo Híbrido (no se admiten los otros tipos del ADR-017 original).
- Default `edit_window_until = now() + interval '15 minutes'`.
- Indexes: `(animal_profile_id, created_at desc) where deleted_at is null`, `(establishment_id, created_at desc) where deleted_at is null`, `(author_id, created_at desc)`.
- Función + trigger `tg_set_author_id_auth_uid` (BEFORE INSERT): autollenar `author_id = auth.uid()` si vino null.
- Trigger `tg_animal_events_validate_est` (BEFORE INSERT): verificar que `establishment_id` coincide con `animal_profiles.establishment_id`.
- Trigger `tg_animal_events_enforce_edit_window` (BEFORE UPDATE): rechazar cambio de `text/structured_payload/event_type` pasada `edit_window_until`; rechazar siempre cambio de `author_id/animal_profile_id/establishment_id/created_at/edit_window_until` (inmutables).
- RLS:
  - `select`: `has_role_in(establishment_id) and deleted_at is null`.
  - `insert`: `has_role_in(establishment_id)`.
  - `update`: `has_role_in(establishment_id) and (author_id = auth.uid() or is_owner_of(establishment_id))` (el trigger enforce qué columnas son tocables).
- `grant select, insert, update` to `authenticated`.
- **Aceptación**: insert con `event_type='salud'` falla con `23514` (CHECK); insert OK con `'observacion'`; update de `text` dentro de los 15 min OK; update de `text` pasadas 15 min falla; soft-delete (`update set deleted_at = now()`) permitido siempre por author/owner; userB sin rol no ve ni puede insertar; otro author no puede editar texto ajeno.
- **Cubre**: R6.10, R6.11, R6.12, R6.13.

### [x] T1.25 Migration `0034_animal_timeline_v2.sql` (timeline con séptimo origen)
- Reemplazar (`create or replace function`) `animal_timeline(profile_id uuid)` para incluir el UNION ALL con `animal_events` como `event_kind = 'observacion'`.
- Payload del nuevo origen: `{ event_type, text, structured_payload, author_id, edit_window_until }`.
- `event_date` del nuevo origen = `created_at` de `animal_events`.
- Mantener `order by event_date desc` total.
- **Aceptación**: animal con 1 weight + 1 observation → `animal_timeline` retorna 3 filas (weight + observation + category_change initial); cuenta correcta de los 7 orígenes posibles; userB sin rol → 0 filas (RLS).
- **Cubre**: R10.1 (extendido a 7 orígenes).

### [x] T1.26 Migration `0035_immutability_identifiers.sql` (R4.13)
- Función + trigger `tg_animals_block_tag_change` (BEFORE UPDATE OF `tag_electronic`): permitir `NULL → valor`; rechazar `valor → otro valor` y `valor → NULL`.
- Función + trigger `tg_animal_profiles_block_idv_change` (BEFORE UPDATE OF `idv`): misma política post-completitud.
- Explícitamente **no** bloquear `visual_id_alt` — sigue editable.
- **Aceptación**: insert de animal con `tag_electronic=NULL`, luego `update set tag_electronic='ARG001'` → **OK** (completar info). Luego `update set tag_electronic='ARG002'` → falla con `23514`. `update set tag_electronic=NULL` → falla. `update set visual_id_alt='nuevo'` → OK. Idem para `idv`.
- **Cubre**: R4.13.

### [x] T1.27 Migration `0036_management_groups.sql` (lote — ADR-020)
> Tercer eje de organización. Tabla `management_groups` (scope establishment) + columna `animal_profiles.management_group_id` vía ALTER (la tabla y la columna no podían crearse antes porque `animal_profiles` recién existe en 0019 y `management_groups` se modela acá).

- Crear tabla `public.management_groups` con `(id, establishment_id FK ON DELETE CASCADE, name, active, created_at, updated_at, deleted_at)` + check `name` no vacío + index `(establishment_id) where deleted_at is null`.
- Trigger `updated_at`.
- `ALTER TABLE animal_profiles ADD COLUMN management_group_id uuid references management_groups(id)` (nullable, sin default) + index `(management_group_id) where deleted_at is null`.
- Trigger `tg_animal_profiles_management_group_check` (BEFORE INSERT/UPDATE OF `management_group_id`): si no es NULL, valida que el lote exista, no esté soft-deleted, y pertenezca al mismo `establishment_id` que el perfil. Rechaza con `23514` si es de otro establishment, `23503` si no existe.
- RLS de `management_groups`: `select` con `has_role_in(establishment_id) and deleted_at is null`; `insert/update` con `is_owner_of(establishment_id)`. (Asignar un animal a un lote = UPDATE de `animal_profiles.management_group_id`, cubierto por la policy de update de `animal_profiles` — cualquier rol operativo, R2.17/R11.5.)
- Grants: `select, insert, update` sobre `management_groups`.
- **Aceptación**:
  - Owner crea un `management_group` "Otoño 2026" → OK; `field_operator` intenta crear → falla por RLS.
  - `field_operator` con rol activo asigna un animal a ese lote (`update animal_profiles set management_group_id = ?`) → OK.
  - Asignar un animal a un lote de OTRO establishment → falla con `23514`.
  - Soft-delete del lote (`update management_groups set deleted_at = now()`) por owner → OK; deja de aparecer en `select` (RLS).
  - `userB` sin rol en el establishment no ve el lote (0 filas).
- **Cubre**: R2.14, R2.15, R2.16 (sustrato), R2.17, R2.18 (FK simple, sin auto-asignación), R4.1 (columna), R7.7 (la columna no la tocan los triggers de transición).

### [x] T1.28 Migration `0037_check_grants.sql` (housekeeping)
- Revisar y consolidar grants de todas las tablas/funciones nuevas (incluye `field_definitions`, `system_default_fields`, `rodeo_data_config`, `management_groups`, `animal_events`).
- Cualquier permission que se haya escapado al rol `authenticated` queda fijada acá (sigue el patrón establecido por `0010_grants_fix.sql` de spec 01).
- **Aceptación**: `node scripts/check.mjs` verde; `select` desde cliente authenticated sobre cada tabla con RLS funciona end-to-end.
- **Cubre**: housekeeping.

## Fase 2 — Tests reales contra DB remota

Patrón heredado de spec 01: tests Node nativo en `supabase/tests/`, login con users de prueba, ejercen las policies y triggers, y limpian al final.

### [x] T2.1 Suite `supabase/tests/animal/run.cjs` (esqueleto)
- Crear runner Node nativo siguiendo el patrón de `supabase/tests/rls/run.cjs`.
- Setup: crear `userA` (owner de `estA`) y `userB` (owner de `estB`) via service role. Los rodeos **no se crean automáticamente** — el setup crea manualmente un rodeo `(bovino, cría, name='Rodeo principal')` en cada establishment para que las suites siguientes tengan dónde meter animales. El trigger `tg_rodeos_seed_data_config` pre-puebla `rodeo_data_config` (26 filas, 23 enabled) al insertarse el rodeo.
- Helper `createAnimal(client, { tag?, idv?, visualAlt?, sex, birthDate?, rodeoId? })`: insert en `animals` + `animal_profiles` con patrón split (sin `.select()` + select separado).
- Helper `createRodeo(client, { establishmentId, name, systemCode='cria' })`: lookup de `species_id` / `system_id` por `code` e insert en `rodeos`.
- Helper `createManagementGroup(client, { establishmentId, name })`: insert en `management_groups`.
- **Aceptación**: skeleton corre con 0 tests y termina limpio; cada establishment de setup tiene 1 rodeo `(bovino, cría)` creado manualmente y 26 filas en `rodeo_data_config` (23 enabled).

### [x] T2.2 Tests: identificación flexible (R4.2)
- Caso 1: animal con solo TAG → OK.
- Caso 2: animal con solo IDV → OK.
- Caso 3: animal con solo `visual_id_alt` → OK.
- Caso 4: animal sin ninguno → falla con código `23514`.
- Caso 5: TAG duplicado entre dos campos → falla con unique violation.
- Caso 6: IDV duplicado dentro del mismo campo → falla; IDV duplicado entre dos campos → OK.
- **Aceptación**: 6 tests verdes.
- **Cubre**: R4.2, R3.2, R4.3.

### [x] T2.3 Tests: categoría auto-calculada al alta (R4.7)
- Hembra con `birth_date = hoy - 6 meses` → categoría `ternera`.
- Hembra con `birth_date = hoy - 18 meses` y sin eventos previos → `vaquillona`.
- Macho con `birth_date = hoy - 6 meses` → `ternero`.
- Macho sin `birth_date` → `torito` (default conservador).
- **Aceptación**: 4 tests verdes.
- **Cubre**: R4.7.

### [x] T2.4 Tests: transiciones automáticas (R7.1..R7.5, R7.7)
- Vaquillona + tacto positivo (`pregnancy_status = 'medium'`) → categoría pasa a `vaquillona_prenada` y `category_override` queda `false`.
- Vaquillona preñada + evento `birth` → `vaca_segundo_servicio`.
- Vaca segundo servicio + segundo `birth` → `multipara`.
- Multípara + tercer `birth` → categoría no cambia (no hay transición desde `multipara`).
- Vaquillona con `category_override = true` + tacto positivo → categoría NO cambia.
- Vaquillona + tacto con `pregnancy_status = 'empty'` → categoría NO cambia.
- **Ortogonalidad (R7.7)**: un animal con `rodeo_id = R` y `management_group_id = G` que transiciona de categoría por un parto → tras la transición sigue con el mismo `rodeo_id = R` y `management_group_id = G` (la transición no los tocó).
- `animal_category_history` registra cada cambio con `reason = 'auto_transition'`.
- **Aceptación**: 8 tests verdes.
- **Cubre**: R7.1, R7.2, R7.3, R7.4, R7.5, R7.7, R4.9, R10.3, R12.4.

### [x] T2.5 Tests: override manual y revert (R4.8, R4.10)
- UPDATE manual de `category_id` desde cliente → trigger pone `category_override = true` y `animal_category_history.reason = 'manual_override'`.
- UPDATE de `category_override = false` + UPDATE de `category_id = compute_category(id)` → categoría se recalcula y `animal_category_history.reason = 'revert_to_auto'`.
- **Aceptación**: 2 tests verdes.
- **Cubre**: R4.8, R4.10, R7.6.

### [x] T2.6 Tests: CUT manual (R8)
- Update directo de `is_cut = true` + `category_id = (cut)` + `category_override = true` desde la ficha → OK.
- Verificar que las policies permiten el update a field_operator y veterinarian (R11.5).
- Test del prompt automático queda como **manual test guideline** (es UX cliente, no SQL).
- **Aceptación**: 2 tests verdes (los manuales se documentan en `progress/impl_02-modelo-animal.md`).
- **Cubre**: R8.4, R8.5.

### [x] T2.7 Tests: ternero al pie (R9)
- Insertar `reproductive_events` con `event_type='birth', calf_sex='female', calf_weight=35` sobre una vaquillona preñada.
  - Verifica: `calf_id` no es null tras el insert; `animal_profiles` del ternero existe con `category.code = 'ternera'`, `entry_origin = 'born_here'`, `visual_id_alt = 'recién nacido — pendiente de caravana'`, `management_group_id IS NULL`.
  - Verifica que la madre transicionó a `vaca_segundo_servicio` (transición AFTER INSERT corre después del BEFORE INSERT que creó al ternero).
- Insertar parto con `calf_tag_electronic` provisto → ternero creado con TAG y SIN fallback en `visual_id_alt`.
- Insertar parto con `calf_tag_electronic` duplicado → falla; `select` posterior confirma que ni el evento ni el ternero quedaron persistidos (rollback transaccional, R9.4).
- **Aceptación**: 3 tests verdes.
- **Cubre**: R9.1, R9.2, R9.3, R9.4.

### [x] T2.8 Tests: RLS de animales y eventos (R11)
- userA crea animal en estA; userB intenta `select` → 0 filas.
- userA crea evento; userB no lo ve.
- userA es field_operator en estA, userB es veterinarian. Ambos pueden insertar eventos sobre animales de estA.
- userA crea evento; userB con rol de owner en estA puede `update`; userB sin ser owner ni creador no puede.
- field_operator intenta crear un rodeo en estA → falla; owner OK.
- userA con perfil en estA puede leer el animal global; userB sin rol no.
- **Aceptación**: 6 tests verdes.
- **Cubre**: R11.1, R11.2, R11.3, R11.4, R11.5, R6.8.

### [x] T2.9 Tests: creación manual de rodeo + validaciones (R2)
- Crear establishment → verificar `select count(*) from rodeos where establishment_id = ?` = **0** (no más default).
- Owner crea rodeo `(bovino, cría, name='Rodeo principal')` manualmente vía INSERT → OK; verificar que el trigger pre-pobló **26 filas** en `rodeo_data_config` para ese `rodeo_id` (23 con `enabled = true`).
- Owner intenta crear rodeo `(bovino, invernada)` → falla por system inactive (23514).
- `field_operator` con rol activo en el establishment intenta crear un rodeo → falla por RLS (R2.3).
- Owner soft-deletes (UPDATE `deleted_at = now()`) rodeo con animales activos → falla con error explícito (R2.5).
- Owner soft-deletes rodeo sin animales activos → OK.
- **Aceptación**: 6 tests verdes.
- **Cubre**: R2.2, R2.3, R2.4, R2.5, R2.6 (no default), R2.11 (trigger pre-populate, indirecto).

### [x] T2.10 Tests: cronología (R10)
- Animal con 1 peso + 1 tacto + 1 sanitario → `animal_timeline(profile_id)` retorna 3 eventos + 1 `category_change` (el initial). Total 4 filas.
- Otro user sin rol → 0 filas.
- Orden por `event_date desc` verificable.
- **Aceptación**: 3 tests verdes.
- **Cubre**: R10.1, R10.2.

### [x] T2.11 Tests: búsqueda fuzzy (R5)
- Crear animal con `visual_id_alt = 'vaca blanca mancha pata izquierda'`.
- Búsqueda con `'vaca blanca'` → encuentra (similarity ≥ 0.3).
- Búsqueda con `'toro negro'` → no encuentra.
- Búsqueda por TAG exacto → encuentra; mismo TAG buscado por userB sin rol → 0 filas (RLS).
- **Aceptación**: 4 tests verdes.
- **Cubre**: R5.1, R5.2, R5.3, R5.4.

### [x] T2.12 Hook al runner global
- Agregar la suite `animal/run.cjs` al runner `scripts/run-tests.mjs` (heredado de spec 01).
- `node scripts/check.mjs` debe ejecutar y reportar verde el nuevo set de tests.
- **Aceptación**: `check.mjs` corre Fase 2 entera y queda verde.
- **Cubre**: housekeeping.

### [x] T2.13 Tests: `animal_events` (modelo Híbrido, R6.10..R6.13)
- Caso 1: insert con `event_type='observacion'` + `text='vio cojera leve'` → OK; `author_id` queda con `auth.uid()` del cliente; `edit_window_until ≈ now() + 15 min`.
- Caso 2: insert con `event_type='salud'` → falla con CHECK (`23514`). Solo `'observacion'` y `'otro'` son válidos.
- Caso 3: insert con `establishment_id` que no coincide con `animal_profiles.establishment_id` del `animal_profile_id` provisto → falla.
- Caso 4: update de `text` dentro de los 15 min por el author → OK.
- Caso 5: update de `text` pasada la ventana (mock con `update animal_events set edit_window_until = now() - interval '1 min' where id = ...` previo) → falla con `23514`.
- Caso 6: update de `author_id` / `animal_profile_id` / `establishment_id` / `created_at` / `edit_window_until` → falla siempre (inmutables).
- Caso 7: soft-delete (`update set deleted_at = now()`) por author dentro de la ventana → OK; por author fuera de la ventana → OK (soft-delete no está atado al edit_window).
- Caso 8: userB sin rol en estA intenta `select * from animal_events where ...` → 0 filas (RLS).
- Caso 9: userB con rol `field_operator` en estA intenta editar evento creado por userA → falla (no es author ni owner).
- Caso 10: userB con rol `owner` en estA edita evento de userA → OK (excepción administrativa).
- **Aceptación**: 10 tests verdes.
- **Cubre**: R6.10, R6.11, R6.12, R6.13.

### [x] T2.14 Tests: inmutabilidad de identificadores post-completitud (R4.13)
- Caso 1: crear animal con `tag_electronic='ARG001'`, luego `update set tag_electronic='ARG002'` → falla con `23514`.
- Caso 2: crear profile con `idv='001'`, luego `update set idv='002'` → falla con `23514`.
- Caso 3: `update set visual_id_alt='vaca blanca corregida'` → OK (no está bloqueado).
- Caso 4 (caso permitido): crear animal con `tag_electronic=NULL`, luego `update set tag_electronic='ARG003'` → **OK** (completar info que faltaba).
- Caso 5 (defensivo): crear animal con `tag_electronic='ARG004'`, luego `update set tag_electronic=NULL` → falla con `23514`.
- **Aceptación**: 5 tests verdes.
- **Cubre**: R4.13.

### [x] T2.15 Tests: cronología v2 con 7 orígenes (extensión de T2.10)
- Animal con 1 peso + 1 tacto + 1 sanitario + 1 observation + 1 condition score → `animal_timeline(profile_id)` retorna 6 filas (5 eventos + 1 `category_change` initial). Verificar que `event_kind = 'observacion'` aparece en el resultado.
- Borrar (soft-delete) la observation → ya no aparece en el timeline.
- Otro user sin rol en el establishment del animal → 0 filas para todos los orígenes incluido `observacion`.
- **Aceptación**: 3 tests verdes.
- **Cubre**: R10.1 (séptimo origen).

### [x] T2.16 Tests: plantilla de datos — catálogo global + defaults + toggle (R2.8..R2.13)
> Tests del modelo de 3 tablas de ADR-021. Reemplaza la versión que testeaba el modelo por-sistema buggeado.

- Caso 1 (catálogo global seedeado): `select count(*) from field_definitions where active` = 26. Verificar columnas `label`, `category`, `data_type`, `ui_component` pobladas. `data_key` único (sin duplicados).
- Caso 2 (defaults por sistema): `select count(*) from system_default_fields` para `(bovino, cría)` = 26; 23 con `default_enabled = true`, 3 false (`inseminacion`, `peso_nacimiento`, `tuberculosis`).
- Caso 3 (catálogos read-only): cliente authenticated intenta `insert/update/delete` en `field_definitions` y en `system_default_fields` → falla (no policy).
- Caso 4 (pre-populate al crear rodeo): owner crea rodeo `(bovino, cría)` → `select count(*) from rodeo_data_config where rodeo_id = ?` = 26; 23 con `enabled = true`.
- Caso 5 (toggle owner-only): owner hace `update rodeo_data_config set enabled = false` sobre un field existente → OK; `field_operator` intenta el mismo UPDATE → falla por RLS.
- Caso 6 (habilitar field no-default — caso "tambo + preñez"): owner hace `insert into rodeo_data_config (rodeo_id, field_definition_id, enabled) values (?, (id de un field que NO está en system_default_fields del sistema del rodeo), true)` → **OK** (el field existe en el catálogo global). `field_operator` intenta el mismo INSERT → falla por RLS.
- Caso 7 (no DELETE desde cliente): owner intenta `delete from rodeo_data_config where ...` → falla (no policy DELETE).
- Caso 8 (CASCADE hard-delete): hard `delete from rodeos where id = ?` (vía service_role) → filas de `rodeo_data_config` de ese rodeo desaparecen por CASCADE.
- Caso 9 (RLS scoping): `userB` sin rol en `estA` consulta `rodeo_data_config` de un rodeo de `estA` → 0 filas.
- **Aceptación**: 9 tests verdes.
- **Cubre**: R2.8, R2.9, R2.10, R2.11, R2.12, R2.13.

### [x] T2.17 Tests: lote / management_groups (R2.14..R2.18)
> Tercer eje de organización (ADR-020).

- Caso 1 (crear lote owner-only): owner crea `management_group` "Otoño 2026" → OK; `field_operator` intenta crear → falla por RLS (42501/no policy).
- Caso 2 (asignar animal — cualquier rol operativo): `field_operator` con rol activo asigna un animal a "Otoño 2026" (`update animal_profiles set management_group_id = ?`) → OK.
- Caso 3 (exclusividad): reasignar el mismo animal a otro lote → el `management_group_id` queda con el nuevo valor (un solo lote a la vez; es un UPDATE de FK, sin historial).
- Caso 4 (mismo establishment): asignar un animal de `estA` a un lote de `estB` → falla con `23514`.
- Caso 5 (lote inexistente / soft-deleted): asignar a un `management_group_id` que no existe o está soft-deleted → falla.
- Caso 6 (quitar de lote): `update animal_profiles set management_group_id = NULL` → OK.
- Caso 7 (ortogonalidad): animal con `management_group_id = G`; registrar un parto que dispara transición de categoría → el `management_group_id` sigue siendo `G` (la transición no lo tocó). (Solapado con T2.4 ortogonalidad; acá se verifica desde el ángulo lote.)
- Caso 8 (soft-delete del lote): owner soft-deletea "Otoño 2026" → deja de aparecer en `select` (RLS); los animales que lo tenían quedan con `management_group_id` apuntando a un lote soft-deleted (el cliente debe reasignar — ver design).
- Caso 9 (RLS scoping): `userB` sin rol en `estA` no ve los `management_groups` de `estA` (0 filas).
- **Aceptación**: 9 tests verdes.
- **Cubre**: R2.14, R2.15, R2.16, R2.17, R2.18.

### [x] T2.18 Fix de seguridad: `apply_auto_transition` no es RPC público (SEC-HIGH-01)
> Fix loop de Gate 2 (FAIL). Ver `progress/security_code_02-modelo-animal.md` § SEC-HIGH-01.

- Migration `0042_revoke_internal_function_grants.sql`: `revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;` + `notify pgrst, 'reload schema';`. `apply_auto_transition` es helper SECURITY DEFINER interno del trigger de transición (R7.7); había quedado expuesto como RPC de PostgREST con `EXECUTE TO PUBLIC` por default → write cross-tenant (CWE-862/CWE-639). El trigger `tg_reproductive_events_apply_transition` (SECURITY DEFINER, corre como owner) conserva su EXECUTE, así que las transiciones automáticas siguen funcionando.
- Test de regresión: un `authenticated` sin rol en el establishment del perfil objetivo intenta `rpc('apply_auto_transition', { profile_id: <perfil ajeno>, target_category_id: <categoría válida> })` → debe fallar (permission denied / función no accesible) Y la categoría del perfil objetivo NO cambia (verificado con service_role).
- **Aceptación**: T2.18 verde; T2.4/T2.5 (transiciones automáticas + override/revert) siguen verdes.
- **Cubre**: SEC-HIGH-01, R11.x (aislamiento multi-tenant).

### [x] T2.19 Tests de no-bypass del delta Tier 1 (Gate 1, modo `spec`, sesión 20)
> Cierre de los findings del Gate 1 (FAIL) sobre el delta Tier 1. Ver `progress/security_spec_02-modelo-animal.md` y la sub-entrada "Endurecimiento Gate 1 (FAIL → fix)" del Changelog de `design.md`. Estos tests son **parte del contrato de seguridad firme** del fold; sin ellos el fold no cierra. Corren contra DB remota con `service_role` para verificar el estado real tras cada intento.

- **Caso 1 — `exit_animal_profile` exige rol activo (SEC-SPEC-01, espejo de T2.18)**: un `authenticated` que es `created_by` del `animal_profile` **pero con `user_roles.active = false`** (rol desactivado/revocado en ese establishment) llama `rpc('exit_animal_profile', { p_profile_id, p_status: 'sold', p_exit_reason: 'sale', p_exit_date })` → recibe **`42501`** y, leído con `service_role`, el `status` del perfil **NO** cambió (sigue `active`) ni se setearon las columnas `exit_*`. Variante de control: el mismo perfil, con el `owner` (rol activo) → la baja **sí** procede.
- **Caso 2 — `register_birth` no cruza tenant (SEC-SPEC-02)**: un `authenticated` con rol activo en el tenant A invoca `rpc('register_birth', { p_mother_profile_id: <animal_profile del tenant B>, p_event_date, p_calves: [{calf_sex:'male'}] })` → recibe **`42501`** y, con `service_role`, **no** se creó **nada**: ni `reproductive_events` de parto, ni `animals`/`animal_profiles` de ternero, ni filas de `birth_calves`. Variante de control: madre del propio tenant A → crea el parto + N terneros + N filas `birth_calves` en una transacción.
- **Caso 3 — `birth_calves` no acepta INSERT directo de cliente (SEC-SPEC-04)**: un `authenticated` con rol activo en el tenant A, dueño de un evento `birth` propio, intenta `insert into birth_calves(birth_event_id: <parto propio>, calf_profile_id: <cualquier animal_profile>)` por PostgREST → **falla** (sin `GRANT INSERT` para `authenticated`: 42501 / permission denied) y no se crea fila. Verifica que la única vía de escritura es el flujo server-side (trigger mono / `register_birth`).
- **Caso 4 — SELECT de `birth_calves` filtra evento soft-deleted (SEC-SPEC-04.a)**: tras soft-deletear el evento de parto (RPC `soft_delete_event('reproductive', <birth_event_id>)`), un `authenticated` con rol en el establishment **no** ve las filas de `birth_calves` de ese parto (0 filas por la policy con `re.deleted_at is null`); con `service_role` las filas siguen físicamente presentes (no se hard-deletearon).
- **Caso 5 — `created_by` se fuerza server-side, no es spoofeable (SEC-SPEC-03)**: un `authenticated` con rol activo inserta un `animal_profile` pasando explícitamente `created_by = <uid de otro usuario>` en el payload → con `service_role`, la fila resultante tiene `created_by = <uid del caller real>` (el trigger `tg_force_created_by_auth_uid` lo sobreescribió, ignorando el valor del cliente). Corolario verificable de la cadena de authz de `R4.14`: ese otro usuario **no** puede dar de baja el animal vía la rama `v_creator = auth.uid()`.
- **Caso 6 — L2: el alta del ternero al pie no la bloquean los triggers de validación (anexo del reporte)**: registrar un parto (mono o mellizos) sobre una madre de `(bovino, cría)` crea el/los ternero(s) con categoría `ternero`/`ternera` **del mismo `system_id` de la madre**, heredando establishment + rodeo. Verificar que el alta **no** es rechazada por `tg_animal_profiles_rodeo_same_system_check` (`0047`, item 5) — el ternero entra con el rodeo de la madre, sin cambio de rodeo, así que el trigger ni siquiera aplica (es `before update of rodeo_id`) — **ni** por `tg_animal_profiles_category_check` as-built (la categoría `ternero`/`ternera` pertenece al system del rodeo). El camino feliz debe pasar; es un test de no-regresión que blinda contra que el endurecimiento rompa el alta legítima.
- **Aceptación**: 6 casos verdes (cada uno con su variante de control donde aplica). Suite Animal pasa de 19 a un número mayor según el desglose del implementer. T2.4/T2.5/T2.7/T2.18 siguen verdes.
- **Cubre**: SEC-SPEC-01, SEC-SPEC-02, SEC-SPEC-03, SEC-SPEC-04, R4.14, R7.9/R9.5, R11.x (aislamiento multi-tenant).

## Fase 3 — Cliente: contextos y servicios base

> **Estado**: pausado intencionalmente hasta que Raf retome el frontend con el stack del `ADR-013`. Las tareas quedan documentadas y listas para retomarse después.

### T3.1 `RodeoContext`
- `app/src/contexts/RodeoContext.tsx` con estado loading/no_rodeos/active.
- Auto-select del único rodeo activo del establishment cuando hay uno solo.
- Persistencia del rodeo activo en `expo-secure-store` por establishment.
- El estado `no_rodeos` es el inicial esperado tras crear un establishment (no hay rodeo autogenerado); el cliente lleva al wizard de "Crear rodeo" y bloquea el resto (R2.6).
- **Aceptación**: `useRodeo()` retorna el rodeo activo del establishment activo; cambia con `switchRodeo`.
- **Cubre**: pre-requisito UI de R2, R4.

### T3.2 Servicio `app/src/services/animals.ts`
- Funciones (sin tocar UI):
  - `createAnimal(form): Promise<AnimalProfile>` con patrón split insert + select (`ADR-012`). **Primitive de mutación**: la UX de "alta interactiva con ID precargado + form dinámico por rodeo + dos puertas" se construye en spec 09 sobre esta primitive.
  - `fetchAnimals(filter): Promise<AnimalListItem[]>`.
  - `fetchAnimalDetail(profileId): Promise<AnimalDetail>` (incluye `animals.*` joined + `management_group`).
  - `fetchAnimalTimeline(profileId): Promise<TimelineEvent[]>` llamando a `animal_timeline(...)` (incluye `observacion` como séptimo origen).
  - `searchByTag / searchByIdv / searchByVisualAlt` — **primitives** que spec 09 consume.
  - `updateAnimalCategory(profileId, categoryId)` (marca override por trigger).
  - `revertCategoryOverride(profileId)` (set override=false + recompute).
  - `markCut(profileId)`.
  - `assignManagementGroup(profileId, groupId | null)` — asignar/quitar lote (R2.17).
- Todas las funciones tipadas, sin `any`, errores `Result<T, AppError>`.
- **Aceptación**: unit tests con cliente Supabase mock + integración liviana.
- **Cubre**: R3.5, R4.*, R5.*, R10, R2.15/R2.17, soporte de R14.

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

### T3.5 Servicio `app/src/services/observations.ts` (modelo Híbrido)
- `createObservation({ animalProfileId, establishmentId, eventType, text?, structuredPayload? }): Promise<AnimalEvent>` con `event_type IN ('observacion','otro')` (validación tipo TS); el server enforce vía CHECK.
- `editObservation(eventId, { text?, structuredPayload?, eventType? })`: el cliente verifica localmente si `now() < edit_window_until` antes de habilitar el botón de edit en UI; el server enforce vía trigger.
- `softDeleteObservation(eventId)`: marca `deleted_at`, permitido siempre por author/owner.
- **Aceptación**: unit tests + integration test contra DB remota.
- **Cubre**: soporte de R6.10..R6.13.

### T3.6 Servicio `app/src/services/rodeo-config.ts` (plantilla de datos)
- `fetchFieldCatalog(): Promise<FieldDefinition[]>` (lee `field_definitions`, cacheado en SQLite local).
- `fetchSystemDefaults(systemId): Promise<SystemDefaultField[]>`.
- `fetchRodeoConfig(rodeoId): Promise<RodeoDataConfig[]>`.
- `toggleRodeoField(rodeoId, fieldDefinitionId, enabled)` (owner; UPDATE).
- `enableNonDefaultField(rodeoId, fieldDefinitionId)` (owner; INSERT — caso "tambo + preñez").
- `isManeuverAvailable(rodeoId, requiredDataKeys[]): boolean` — helper de gating (consumido por spec 03).
- **Aceptación**: unit tests + integration test; el helper de gating refleja el mapeo de ADR-021.
- **Cubre**: soporte de R2.8..R2.13, R2.7 (sustrato del gating).

### T3.7 Servicio `app/src/services/management-groups.ts` (lote)
- `fetchManagementGroups(establishmentId): Promise<ManagementGroup[]>`.
- `createManagementGroup(establishmentId, name)` / `renameManagementGroup(id, name)` / `softDeleteManagementGroup(id)` (owner-only).
- `assignAnimalToGroup(profileId, groupId | null)` (cualquier rol operativo).
- `groupAnimalsForDisplay(profiles)`: implementa la regla "lote si tiene, si no categoría" (R2.16) en cliente.
- **Aceptación**: unit tests + integration test; la regla de display agrupa correctamente.
- **Cubre**: soporte de R2.14..R2.18.

### T3.8 Hooks
- `useAnimals`, `useAnimal`, `useAnimalTimeline`, `useCategories`, `useAnimalObservations`, `useRodeoDataConfig`, `useManagementGroups`, `useAssignManagementGroup`.
- Cada hook orquesta el service correspondiente y expone estado de loading/error/data.
- `useSearchAnimal` **no se define en este spec** (se mueve a spec 09).
- **Aceptación**: cobertura de los flujos del cliente vía RTL component-tests.
- **Cubre**: soporte de R14, R6.10..R6.13, R2.B, R2.C.

### [x] T3.9 Servicio de baja / egreso (C3.3 — frontend, R4.14 / R14.9) — DONE (2026-06-07)
- **`exitAnimalProfile(input): Promise<ServiceResult<void>>`** en `app/src/services/animals.ts`: llama el RPC ya existente `supabase.rpc('exit_animal_profile', {...})` (migration `0044`); `p_exit_weight`/`p_exit_price` → `null` si no vinieron (el RPC los `coalesce`). El RPC es la barrera de authz; el servicio NO fuerza permisos.
- **Lógica PURA en `app/src/services/exit-animal.ts`** (sin `./supabase` → testeable bajo `node:test`): `EXIT_REASON_MAPPINGS` + `exitReasonToStatus` (motivo→(status,exit_reason)); `classifyExitError` (42501/23503/23514/network/unknown → copy es-AR, nunca el `sqlerrm`); `validateExitWeight`/`validateExitPrice` (opcionales, vacío→null) + `sanitizePriceInput` (sin el cap de 4 díg del peso); `archivedBadgeLabel(status, exitDate)`.
- **`fetchAnimalDetail` extendido**: SELECT + type `AnimalDetail` suman `createdBy`, `exitDate`, `exitReason` (gating + badge de archivada).
- **Aceptación**: `exit-animal.test.ts` 25/25 verde (mapeo, errores, validadores, sanitizer, badge). Enganchado en `run-tests.mjs`.
- **Cubre**: R4.14 (capa cliente), R14.9 (mapeo 3 motivos + datos de venta opcionales).

## Fase 4 — Cliente: pantallas

### T4.1 `AnimalListScreen` (tab Animales)
- Lista paginada de `animal_profiles` activos del establishment activo, filtrable por rodeo y estado.
- Agrupamiento por la regla "lote si tiene, si no categoría" (R2.16) cuando corresponda.
- Tap → `AnimalDetailScreen`.
- CTA "Buscar / Crear" navega a `AnimalSearchScreen` **definida en spec 09**. Dejar el CTA placeholder/deshabilitado hasta que spec 09 lo provea.
- **Aceptación**: 50 animales se cargan sin lag perceptible (PowerSync local); navegación al detail funciona; agrupamiento por lote/categoría visible.
- **Cubre**: R14.1 (parcial), R2.16 (display).

### T4.2 `AnimalDetailScreen` — ficha del animal (R14)
- Cabecera con campos del R14.2 (incluye rodeo y lote del animal).
- Sección "Categoría" con valor actual + toggle de override (R14.5).
- Botón "Marcar como CUT" con confirmación (R14.6, R8.5).
- Selector de lote: asignar / cambiar / quitar `management_group_id` (R14.8, R2.17).
- Cronología renderizada desde `useAnimalTimeline` (R10), componente por tipo (R14.3).
- Si es ternero/ternera: link a la ficha de la madre (R14.7) — query inversa: `select * from reproductive_events where calf_id = profile_id`.
- Editar/borrar evento solo si owner o creador (R14.4).
- **Aceptación**: ficha muestra >= 3 tipos de eventos en orden; toggle de override funciona; CUT actualiza la categoría visible; asignar lote persiste.
- **Cubre**: R10, R14, R2.16/R2.17.

### T4.3 `RodeosScreen` + wizard "Crear rodeo" (Settings, owner-only)
- Lista de rodeos del establishment con estado (`active`, `deleted_at`, conteo de animales).
- Solo owner ve los botones de crear / soft-delete / editar plantilla.
- **Wizard "Crear rodeo"** (3 pasos):
  1. **Sistema**: dropdown con `systems_by_species` para `species = bovino`. En MVP solo `cría` es seleccionable; las otras (tambo, cabaña, invernada, feedlot) aparecen **grisadas** con badge "Próximamente". (R2.6)
  2. **Nombre**: input de `name` con validación de no-vacío.
  3. **Plantilla de datos**: lista de toggles cargados desde `field_definitions` (catálogo global) join `system_default_fields` filtrado por el `system_id` elegido. Cada toggle muestra `label`, `description` (tooltip) y su `default_enabled`. El usuario destilda lo que no quiera; opcionalmente puede tildar un dato del catálogo que no es default (habilitar field no-default). Confirmar dispara INSERT en `rodeos` (el trigger pre-popula `rodeo_data_config` con defaults) + UPDATEs/INSERTs sobre `rodeo_data_config` según los toggles del usuario.
- **Pantalla "Editar plantilla del rodeo"**: muestra los toggles actuales (`rodeo_data_config` join `field_definitions`). Owner toggablea; puede habilitar fields no-default.
- **Empty state (bloqueo total)**: cuando el establishment tiene 0 rodeos (`no_rodeos`), el wizard de "Crear rodeo" es la primera pantalla y bloquea la navegación al resto de la app hasta cerrarse (R2.6).
- **Aceptación**:
  - `field_operator` ve la lista read-only; no ve botones de crear/editar/borrar.
  - Owner completa el wizard y se crea el rodeo con la plantilla esperada en `rodeo_data_config`.
  - Owner habilita un field no-default desde "Editar plantilla" → persiste.
  - Establishment recién creado muestra el wizard como bloqueo total.
- **Cubre**: R2.2, R2.3, R2.5, R2.6, R2.8 (UI catálogo), R2.11 (UI toggle + habilitar no-default), R2.12.

### T4.4 Prompt CUT automático al cargar dientes (R8.4)
- Cuando el form de "actualizar dientes" del animal cierra con value en `('1/2','1/4','sin_dientes')` y `is_cut = false`, mostrar modal con dos botones explícitos.
- Si confirma → llamar `service.markCut`.
- No mostrar el prompt para terneros/terneras (R8.3).
- **Aceptación**: prompt aparece exactamente en los 3 valores; no aparece para terneros.
- **Cubre**: R8.1, R8.2, R8.3, R8.4.

### T4.5 Gestión de lotes (`ManagementGroupsScreen`)
- Pantalla (Settings o sección Animales) para listar / crear / renombrar / soft-delete de `management_groups` (owner-only para crear/editar/borrar).
- Asignar animales a un lote desde acción masiva o desde la ficha (T4.2).
- Al soft-delete de un lote con animales asignados, avisar y ofrecer reasignar a `NULL` o a otro lote.
- **Aceptación**: owner crea "Otoño 2026", asigna 3 animales, los ve agrupados; `field_operator` puede asignar pero no crear/borrar lotes.
- **Cubre**: R2.14, R2.16, R2.17.

### [x] T4.6 Baja / egreso desde la ficha (C3.3, R4.14 / R14.9) — DONE (2026-06-07)
- **`app/app/animal/[id].tsx`** (ficha): botón **"Dar de baja"** al FONDO, terracota/outline (discreto, no compite con "Agregar evento"), **gated** por `canExit = status==='active' AND (owner del campo activo del animal OR createdBy===userId)`. Conservadurismo multi-tenant: si el animal es de otro campo, solo `createdBy` (el RPC re-valida igual). **Modo archivada** (`status≠active`): badge bajo el hero (`ArchivedBadge` — "Vendido/Muerto/Transferido el {exitDate}") + se ocultan "Agregar evento" y "Dar de baja"; el resto read-only.
- **`app/app/animal/baja.tsx`** (pantalla corta, registrada en `_layout.tsx`): paso 1 = motivo (3 cards grandes, una decisión por pantalla); paso 2 = fecha (default hoy) + (solo Venta) peso/precio opcionales + resumen del animal + aviso de irreversibilidad + botón destructivo. `busyRef` anti doble-tap; online-only. Post-éxito → `backOr` a la ficha → `useFocusEffect` recarga → modo archivada in-situ; el animal sale de la tab Animales (filtro `status='active'`).
- **Aceptación**: e2e `animals.spec.ts` ("owner da de baja Venta → desaparece de Animales + ficha 'Vendido' + visible bajo filtro Vendidos"). `check.mjs` verde (typecheck + anti-hardcode + 25 unit + e2e). Cero hardcode (tokens), voseo es-AR, a11y por helper.
- **Cubre**: R4.14 (acción desde la ficha + gating espejo del authz del RPC), R14.9 (3 motivos, datos de venta opcionales solo en Venta, no reversible, online-only), R4.12/R4.15 (sale del activo, sigue archivado/visible).

## Fase 5 — PowerSync

### T5.1 Sync rules para tablas de este spec
- Definir buckets del `design.md` (`est_rodeos`, `est_rodeo_data_config`, `est_management_groups`, `est_animal_profiles`, `est_animals_local`, `est_*_events`, `est_animal_events`, `est_animal_category_history`, `est_semen_registry`, `config_global` con `field_definitions` + `system_default_fields`).
- **Aceptación**: cliente PowerSync sincroniza solo datos del establishment activo + globals.
- **Cubre**: R13.1.

### T5.2 Operaciones offline para alta, eventos y lote
- Verificar que `createAnimal`, `createWeightEvent`, `assignManagementGroup` (y resto) funcionan con red apagada.
- Encolar offline, sincronizar al volver.
- **Aceptación**: end-to-end test manual: airplane mode, alta + evento + asignar lote, vuelve red, todo sincroniza sin error.
- **Cubre**: R13.2.

### T5.3 Preview offline de transiciones
- Integrar `transitions.ts` (T3.4) en el flujo: cuando se carga un evento offline, mostrar la categoría preview en la UI con un badge "(preview)".
- Al sincronizar, refrescar el dato del server.
- **Aceptación**: cargar tacto positivo offline muestra preview `vaquillona_prenada`; al sincronizar coincide con el server.
- **Cubre**: R13.4.

### T5.4 Refresh de tablas de configuración
- Forzar refresh de `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields` al primer login del día.
- **Aceptación**: cambios en seed (futuro) llegan al cliente sin reinstall.
- **Cubre**: R13.5.

## Fase 6 — QA y cierre

### T6.1 Suite Detox / Maestro (heredada del `ADR-013`)
- Flujos end-to-end: crear rodeo (wizard), crear animal, registrar tacto positivo, ver transición en la ficha, registrar parto, ver ternero creado, asignar animal a un lote.
- **Aceptación**: 5+ flujos pasan en CI.

### T6.2 Auditoría de RLS manual
- `psql` con JWT de userA intenta accionar sobre datos de userB → cero acceso confirmado.
- Repetir para cada tabla nueva (incluye `rodeo_data_config`, `management_groups`).
- **Aceptación**: cero leaks documentados.

### T6.3 Documentación de cierre
- Actualizar `CONTEXT/07-pendientes.md` con preguntas que hayan surgido (ej. validación final del seed de cría con Facundo).
- Si hubo decisiones nuevas → ADRs.
- Mover spec de `specs/active/` a `specs/completed/` si se cierra completa, o mantener si solo se cierra backend (mismo patrón que spec 01).
- **Aceptación**: docs reflejan el estado real al cerrar; `feature_list.json` actualizado.

## Resumen de dependencias críticas

```
T1.1 → T1.2..T1.7 (config + rodeos + plantilla de datos [3 tablas, 0016] + helpers)
                     ↓
                   T1.8..T1.11 (animals + profiles + RLS)
                     ↓
                   T1.12..T1.18 (helpers + tablas de eventos tipadas)
                     ↓
                   T1.19 (category_history)
                     ↓
                   T1.20 (transitions) ← requiere T1.19 para grabar historial
                     ↓
                   T1.21 (calf creation) ← BEFORE INSERT corre antes que T1.20 AFTER INSERT
                     ↓
                   T1.22 (timeline v1)
                     ↓
                   T1.24 (animal_events — modelo Híbrido)
                     ↓
                   T1.25 (timeline v2 — incluye 'observacion') ← requiere T1.24
                     ↓
                   T1.26 (inmutabilidad tag/idv post-completitud)
                     ↓
                   T1.27 (management_groups + ALTER animal_profiles, 0036) ← requiere T1.9
                     ↓
                   T1.28 (grants housekeeping, 0037)
                     ↓
                   Fase 2 (T2.1..T2.17)
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
| R2.6 (no default rodeo + wizard manual + bloqueo total) | T1.6 (sin trigger de auto-creación), T2.9, T4.3 (wizard cliente) |
| R2.7 (gating maniobras — nota + mapeo hardcodeado) | nota conceptual; sustrato en T1.6 + T3.6; enforcement firme en spec 03 |
| R2.8 (`field_definitions` catálogo global) | T1.6, T2.16 |
| R2.9 (`system_default_fields`) | T1.6, T2.16 |
| R2.10 (`rodeo_data_config`) | T1.6, T2.16 |
| R2.11 (trigger pre-populate + toggle owner + habilitar no-default) | T1.6, T2.9, T2.16, T4.3 |
| R2.12 (seed cría TENTATIVO) | T1.6, T2.16 |
| R2.13 (26 fields cría) | T1.6, T2.16 |
| R2.14 (`management_groups`) | T1.27, T2.17, T4.5 |
| R2.15 (`management_group_id`, asignación exclusiva/manual) | T1.27, T2.17 |
| R2.16 (regla de display lote/categoría) | T1.27 (sustrato), T3.7, T4.1, T4.2 |
| R2.17 (RLS lote: crear owner / asignar cualquier rol) | T1.27, T2.17, T4.5 |
| R2.18 (no auto-asignación + ortogonalidad) | T1.27, T1.20 (no toca lote), T2.4, T2.17 |
| R3.1..R3.4 | T1.8 |
| R3.5 | T1.11, T2.8 |
| R4.1 | T1.9 (cuerpo) + T1.27 (columna management_group_id) |
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
| R4.13 | T1.26, T2.14 |
| R5.1, R5.2, R5.3, R5.4 | T1.9 (índices), T2.11 (primitives — la UX vive en spec 09) |
| R6.1..R6.5 | T1.14..T1.18 |
| R6.6 | T1.14..T1.18 (FK constraints) |
| R6.7 | T1.13, T1.14..T1.18 |
| R6.8 | T1.14..T1.18 (policies), T2.8 |
| R6.10..R6.13 (`animal_events`, modelo Híbrido) | T1.24, T2.13, T3.5 |
| R7.1..R7.5 | T1.20, T2.4 |
| R7.6 | T1.20, T2.5 |
| R7.7 (ortogonalidad transiciones ↔ rodeo/lote) | T1.20, T2.4, T2.17 |
| R8.1, R8.2 | T1.9 (teeth_state enum) |
| R8.3 | T4.4 |
| R8.4, R8.5 | T4.4, T2.6 |
| R9.1..R9.4 | T1.21, T2.7 |
| R10.1, R10.2 | T1.22 (v1) + T1.25 (v2 con `observacion`), T2.10, T2.15 |
| R10.3 | T1.19, T2.4 |
| R11.1..R11.5 | T1.11, T1.14..T1.18 (policies), T1.24 (RLS `animal_events`), T1.27 (RLS lote), T2.8, T2.19 (no-bypass delta Tier 1) |
| R4.14 (baja vía `exit_animal_profile`, authz rol activo) | design `0044` + T2.19 caso 1 (SEC-SPEC-01); **frontend C3.3**: T3.9 (servicio + lógica pura) + T4.6 (ficha + sheet de baja + modo archivada) |
| R14.9 (baja desde la ficha: 3 motivos, datos de venta opcionales, no reversible, online-only) | T3.9 + T4.6 (as-built C3.3, 2026-06-07) |
| R7.9 / R9.5 (mellizos, alta N terneros vía `register_birth`) | design `0045` + T2.19 casos 2/6 (SEC-SPEC-02) |
| R4.1 (`created_by` load-bearing, forzado server-side) | design `0043` + T2.19 caso 5 (SEC-SPEC-03) |
| SEC-SPEC-01..04 (Gate 1 delta Tier 1) | T2.19 |
| R12.1..R12.3 | T1.8, T1.9, T1.14..T1.18 (campos deleted_at), T1.24, T1.27 |
| R12.4 | T1.19, T2.4 |
| R13.1 | T5.1 |
| R13.2 | T5.2 |
| R13.3 | (movido a spec 09 — la validación local del form de alta vive allá) |
| R13.4 | T3.4, T5.3 |
| R13.5 | T5.4 |
| R14.1..R14.8 | T4.1, T4.2 |
| ~~R15.1..R15.5~~ | **eliminadas** — UX movida a spec 09 `09-buscar-animal` |

## Notas de ejecución

- Cada migration termina con commit en español, presente, descriptivo (`agrega ...`, `crea ...`, `enforce ...`).
- Si una tarea descubre algo que cambia la arquitectura → crear ADR antes de seguir.
- Si una tarea expone una pregunta nueva al vet socio → registrarla en `CONTEXT/07-pendientes.md` (ej. validación del seed de cría de `field_definitions`).
- Patrón **split insert + select** (`ADR-012`) sigue siendo la norma para inserts que disparan triggers (animal_profiles, reproductive_events).
- Tests Fase 2 corren contra DB remota — requieren `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`. El runner saltea con warning si no está, no rompe `check.mjs`.
- Si en revisión del spec se decide que el bulk-edit de animales hace falta en MVP, agregar Edge Function `bulk_edit_animals` como tarea adicional entre T1.28 y la Fase 2 (sin romper la numeración de migrations).
- Las tareas Fase 3+ están **listas para diferirse**: cerrar Fase 1+2 alcanza para declarar el backend completo, replicando el patrón de spec 01.

## Changelog

> Audit trail de la evolución del plan de tareas. Orden cronológico inverso.

- **2026-06-07 — Frontend C3.3 (baja / egreso desde la ficha, R4.14 / R14.9)**: agregadas **T3.9** (servicio `exitAnimalProfile` + lógica pura `exit-animal.ts` + `fetchAnimalDetail` extendido con `createdBy`/`exitDate`/`exitReason`) y **T4.6** (botón gated + sheet `animal/baja.tsx` + modo archivada en la ficha). Ambas marcadas `[x]` (DONE, pendiente reviewer + Gate 2). El backend (RPC `exit_animal_profile`, `0044`) ya existía + Gate 1 PASS; este chunk es frontend + un servicio cliente, no toca DB/migración/RLS. Trazabilidad R4.14/R14.9 actualizada. `design.md` sumó la subsección "Baja desde la ficha (C3.3 — as-built)". No se renumeró ningún requirement.
- **2026-05-30 (sesión 20) — Endurecimiento Gate 1 (FAIL → fix) del delta Tier 1**: agregada **T2.19** (tests de no-bypass que cierran los 4 findings del Gate 1 modo `spec` sobre las migrations 0043-0047 propuestas). Seis casos: `exit_animal_profile` con autor-sin-rol activo → `42501`, status sin cambiar (SEC-SPEC-01, espejo de T2.18); `register_birth` cross-tenant → `42501`, no crea nada (SEC-SPEC-02); INSERT directo a `birth_calves` sin grant → falla (SEC-SPEC-04.b); SELECT de `birth_calves` filtra el parto soft-deleted (SEC-SPEC-04.a); `created_by` forzado server-side, no spoofeable (SEC-SPEC-03); L2 — el alta del ternero al pie no la bloquean `rodeo_same_system_check` ni el category check as-built. No se renumeró ningún requirement. Ver `progress/security_spec_02-modelo-animal.md` y el Changelog de `design.md`.
- **2026-05-28 — Fix loop Gate 2 (FAIL → SEC-HIGH-01)**: agregada T2.18 (migration `0042` revoca EXECUTE de `apply_auto_transition` a public/authenticated/anon + test de regresión cross-tenant). Suite Animal pasa de 18 a 19 subtests.
- **2026-05-28 — Refundición consolidada (ADR-020 lote + ADR-021 plantilla de datos)**:
  - **T1.6 reescrita**: migration `0016` ahora crea las **tres tablas** de plantilla (`field_definitions` catálogo global + `system_default_fields` + `rodeo_data_config`) + seed de 26 fields de cría + trigger de auto-poblado desde `system_default_fields`. Se eliminó el trigger de validación-por-sistema (el FK al catálogo global lo hace innecesario y se permite habilitar fields no-default). RLS de `rodeo_data_config` ahora permite INSERT al owner (caso "tambo + preñez").
  - **T1.27 nueva**: migration `0036_management_groups.sql` — tabla de lote + `ALTER animal_profiles ADD management_group_id` + trigger de validación mismo-establishment + RLS. **T1.28** = `0037_check_grants` (era T1.27/0036).
  - **T2.16 reescrita** para el modelo de 3 tablas + caso "tambo + preñez". **T2.17 nueva** para lote. **T2.4** sumó test de ortogonalidad (R7.7). **T2.9** ajustada a 26 filas de `rodeo_data_config`. **T2.14** sumó casos NULL→valor (permitido) y valor→NULL (prohibido).
  - **Fase 3**: T3.6 (`rodeo-config.ts`) y T3.7 (`management-groups.ts`) nuevas; T3.8 hooks ampliada.
  - **Fase 4**: T4.3 wizard lee `field_definitions` + `system_default_fields`; T4.5 nueva (gestión de lotes); T4.2 ficha suma selector de lote.
  - **Transversal**: rangos de migration (`0012..0037`), buckets PowerSync, dependencias, trazabilidad (R2.8–R2.18, R7.7, R4.1+T1.27) y notas actualizadas. Header + historial movido a este Changelog.
- **2026-05-27 — Plantilla por sistema + sin rodeo default** *(superada por la refundición 2026-05-28)*. Repurposó T1.6 a `system_data_templates` + `rodeo_data_config` (catálogo por-sistema, con bug), reescribió T2.9, agregó T2.16. Reemplazado por ADR-021.
- **2026-05-26 — Refinamiento previo a aprobación**. Agregadas T1.24 (`animal_events`), T1.25 (`animal_timeline_v2`), T1.26 (inmutabilidad R4.13), T2.13/T2.14/T2.15. Eliminadas T4.2/T4.3 viejas (pantallas de búsqueda/alta → spec 09). Renumeración de Fase 4.
