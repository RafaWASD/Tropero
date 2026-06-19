-- 0099_scrotal_data_key_and_seed.sql  (spec 03 — MODO MANIOBRAS, chunk M6 / R14.1, R14.18) — design.md §12.4a/b
-- data_key GLOBAL nuevo de la CE + habilitado POR DEFECTO en el sistema cría (R14.18).
--
-- (a) catálogo: el data_key 'circunferencia_escrotal' es GLOBAL (establishment_id NULL = fábrica, post-M5).
--     ui_component='numeric_stepped' (a efectos de catálogo/gating capa 1/2; el renderer de manga es el
--     StepKind 'rueda' factory-only de §12.1 — el ui_component de la fila NO determina el renderer).
--
-- Por qué este INSERT NO abre camino de cliente ni rompe los guards de M5 (Gate 1 Foco 5, trazado fila a fila):
--   - tg_field_definitions_custom_guard (0093): `if auth.uid() is null then return new` → el seed por
--     migración (service_role, auth.uid() NULL) PASA; un cliente authenticated sigue rechazado (establishment_id
--     null → 42501 + la policy INSERT exige establishment_id is not null). El seed no le abre nada al cliente.
--   - CHECKs de tabla de 0093 que aplican a las filas GLOBALES (todas satisfechas):
--       * field_definitions_data_type_valid: 'maniobra' ∈ set → OK.
--       * field_definitions_data_key_slug ('^[a-z0-9_]+$'): 'circunferencia_escrotal' lowercase+underscore → OK.
--       * field_definitions_data_key_len (≤64): 23 chars → OK.
--       * field_definitions_description_len (≤500): ~44 chars → OK.
--       * field_definitions_label_len (≤80): 23 chars → OK.
--       * field_definitions_custom_ui_component_valid (establishment_id is null OR ...): null → exenta → OK.
--       * field_definitions_custom_category_len (establishment_id is null OR ...): null → exenta → OK.
--   - UNIQUE parcial field_definitions_data_key_global (WHERE establishment_id is null): 'circunferencia_escrotal'
--     es NUEVO (0 ocurrencias previas en supabase/) → una sola global por data_key se preserva → OK.
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear. NO `supabase db push`.

begin;

insert into public.field_definitions
  (data_key, label, description, category, data_type, ui_component, establishment_id)
values
  ('circunferencia_escrotal', 'Circunferencia escrotal', 'Medida de aptitud reproductiva del toro (cm)',
   'reproductivo', 'maniobra', 'numeric_stepped', null);

-- (b) seed: habilitada POR DEFECTO en el sistema cría (R14.18). default_enabled=true, required_for_system=false.
--     sort_order = max+1 del sistema cría (la CE va al final de la lista de defaults). El CTE `fd` apunta
--     SOLO a la fila GLOBAL recién creada (establishment_id is null) — no a una custom homónima de otro campo.
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
),
fd as (select id from public.field_definitions where data_key = 'circunferencia_escrotal' and establishment_id is null)
insert into public.system_default_fields (system_id, field_definition_id, default_enabled, required_for_system, sort_order)
select sys.system_id, fd.id, true, false,
       (select coalesce(max(sort_order), 0) + 1 from public.system_default_fields s where s.system_id = sys.system_id)
from sys, fd;

notify pgrst, 'reload schema';

commit;
