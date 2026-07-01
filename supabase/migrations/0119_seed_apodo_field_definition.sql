-- 0119_seed_apodo_field_definition.sql  (spec 02 delta NOMBRE/APODO #2 — RNA.1)
-- Seed PER-ESTABLISHMENT del dato custom "apodo" (data_type propiedad, ui_component text), deshabilitado
-- por default (no toca system_default_fields → ningún rodeo lo tiene enabled sin opt-in del owner).
-- BACKFILL-ONLY: solo los establecimientos EXISTENTES. Sin trigger sobre establishments (DP2 diferida).
--
-- POR QUÉ PER-EST Y NO GLOBAL (DP1 / design §hallazgo): buildEnabledCustomFieldsQuery + buildCustomAttributesQuery
-- filtran fd.establishment_id IS NOT NULL → un fd global de 'propiedad' NO se renderiza en el alta ni en la ficha.
-- Una fila per-est es indistinguible de un dato custom del owner → fluye por CustomPropertiesForm/Ficha sin cambios.
--
-- El guard tg_field_definitions_custom_guard (0093) deja pasar el INSERT: en migración auth.uid() IS NULL → return new.
-- CHECKs 0093 satisfechos: data_key slug 'apodo', label ≤80, category 'identificacion' (≤32), data_type 'propiedad',
-- ui_component 'text' ∈ los 7. Idempotente sobre el índice parcial field_definitions_data_key_per_est.
--
-- ⚠ FIX GATE 1 (as-built vs. spec): el índice parcial field_definitions_data_key_per_est lo REDEFINIÓ
-- 0101_field_definitions_data_key_partial.sql (DROP+RECREATE) a predicado
--   (establishment_id is not null AND deleted_at is null)  — NO el 0093 original (solo establishment_id is not null).
-- Verificado contra el remoto (pg_indexes). El ON CONFLICT debe REPRODUCIR EXACTO ese predicado: como
-- `establishment_id is not null` NO implica `... and deleted_at is null`, sin el `and deleted_at is null` Postgres
-- no infiere el índice-árbitro y aborta con 42P10. Todas las filas insertadas tienen establishment_id no-NULL y
-- deleted_at NULL (fila nueva) → matchean el predicado del índice.
--
-- NO aplicar desde acá: lo aplica el LEADER por MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5. Deploy autorizado.

begin;

insert into public.field_definitions
  (establishment_id, data_key, label, description, category, data_type, ui_component, active)
select
  e.id,
  'apodo',
  'Nombre / apodo',
  'Nombre o apodo del animal (texto libre). Por rodeo, opt-in del owner.',
  'identificacion',
  'propiedad',
  'text',
  true
from public.establishments e
on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null
do nothing;

notify pgrst, 'reload schema';

commit;
