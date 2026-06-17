-- 0096_custom_gating.sql  (spec 03 — MODO MANIOBRAS, chunk M5 / R13.14–R13.16) — transcribe design.md §11.4
-- ⚠️ Corazón de seguridad de M5. Gating capa 2 GENÉRICO de las capturas custom + validación de value por
--    ui_component. Imita assert_data_keys_enabled (0054) pero DATA-DRIVEN por field_definition_id (no por
--    data_key literal): el id ES la clave → cero riesgo de binding data_key↔columna.
--
-- SEGURIDAD (security_spec M5):
--   - assert_custom_field_enabled: FAIL-CLOSED (SEC-SPEC-03-03) — rodeo no resoluble → 23514, nunca pasa.
--   - assert_custom_value_valid: valida value por ui_component; rama ELSE fail-closed (M5-SEC-01a / R13.25) —
--     un ui_component NO reconocido RECHAZA (23514), no acepta cualquier value (era el fail-OPEN del fix-loop).
--     enum_multi: array ≤50 elementos seleccionados (M5-SEC-04b / R13.17).
--   - todas las funciones: SECURITY DEFINER + search_path=public + EXECUTE revocado (R13.24). Ninguna es RPC.
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear.

begin;

-- (a) gating genérico por field_definition_id (R13.14/R13.15). Fail-closed.
create or replace function public.assert_custom_field_enabled (p_animal_profile_id uuid, p_field_definition_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_rodeo uuid; v_ok boolean;
begin
  select rodeo_id into v_rodeo from public.animal_profiles
  where id = p_animal_profile_id and deleted_at is null;
  if v_rodeo is null then            -- FAIL-CLOSED (SEC-SPEC-03-03)
    raise exception 'custom gated: cannot resolve rodeo for profile % (missing/soft-deleted)', p_animal_profile_id
      using errcode = '23514';
  end if;
  select exists (
    select 1 from public.rodeo_data_config rdc
    where rdc.rodeo_id = v_rodeo and rdc.field_definition_id = p_field_definition_id and rdc.enabled = true
  ) into v_ok;
  if not v_ok then
    raise exception 'custom gated: field % not enabled in rodeo %', p_field_definition_id, v_rodeo
      using errcode = '23514';
  end if;
end; $$;
revoke execute on function public.assert_custom_field_enabled (uuid, uuid) from public, authenticated, anon;

-- (b) validación de value por ui_component (R13.16). Lee field_definitions.ui_component + config_schema.
--   numeric/numeric_stepped -> número JSON; enum_single -> value (text) ∈ options; enum_multi -> cada elemento
--   del array ∈ options (+ ≤50 elementos); boolean -> json bool; date -> string parseable a fecha; text -> string.
create or replace function public.assert_custom_value_valid (p_field_definition_id uuid, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_uic text; v_cfg jsonb; v_opts jsonb;
begin
  select ui_component, config_schema into v_uic, v_cfg
  from public.field_definitions
  where id = p_field_definition_id and deleted_at is null;
  if v_uic is null then
    raise exception 'custom value: field % not found or soft-deleted', p_field_definition_id using errcode = '23514';
  end if;
  v_opts := coalesce(v_cfg -> 'options', '[]'::jsonb);
  if v_uic in ('numeric','numeric_stepped') then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception 'custom value for % must be numeric', p_field_definition_id using errcode = '23514'; end if;
  elsif v_uic = 'boolean' then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'custom value for % must be boolean', p_field_definition_id using errcode = '23514'; end if;
  elsif v_uic = 'enum_single' then
    if not (v_opts @> jsonb_build_array(p_value)) then
      raise exception 'custom value % not in options for %', p_value, p_field_definition_id using errcode = '23514'; end if;
  elsif v_uic = 'enum_multi' then
    if jsonb_typeof(p_value) <> 'array'
       or exists (select 1 from jsonb_array_elements(p_value) e where not (v_opts @> jsonb_build_array(e.value))) then
      raise exception 'custom multi value % has elements not in options for %', p_value, p_field_definition_id using errcode = '23514'; end if;
    -- cardinalidad del array seleccionado acotada (M5-SEC-04b / R13.17): un enum_multi no puede traer más
    -- elementos que opciones existen (≤50). Evita el garbage/costo de un array gigante de opciones válidas.
    if jsonb_array_length(p_value) > 50 then
      raise exception 'custom multi value for % exceeds max selected options (50)', p_field_definition_id using errcode = '23514'; end if;
  elsif v_uic in ('text','date') then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'custom value for % must be string', p_field_definition_id using errcode = '23514'; end if;
    if v_uic = 'date' and (p_value #>> '{}')::date is null then  -- parse-check (lanza si no es fecha)
      raise exception 'custom date value % invalid', p_value using errcode = '23514'; end if;
  else
    -- FAIL-CLOSED (M5-SEC-01a / R13.25): un ui_component NO reconocido NUNCA acepta el value (rama else que
    -- faltaba → la función caía sin lanzar = fail-OPEN = bypass total de R13.16). El CHECK de dominio (0093 d.1)
    -- ya impide crear una fila custom con ui_component fuera de los 7, pero este else es la defensa en profundidad.
    raise exception 'custom value: unsupported ui_component % for field %', v_uic, p_field_definition_id
      using errcode = '23514';
  end if;
end; $$;
revoke execute on function public.assert_custom_value_valid (uuid, jsonb) from public, authenticated, anon;

-- (c) triggers que aplican gating + validación a las dos tablas.
create or replace function public.tg_custom_measurements_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_custom_field_enabled(new.animal_profile_id, new.field_definition_id);  -- R13.14
  perform public.assert_custom_value_valid(new.field_definition_id, new.value);                -- R13.16
  return new;
end; $$;
revoke execute on function public.tg_custom_measurements_gating () from public, authenticated, anon;
create trigger custom_measurements_gating
  before insert on public.custom_measurements
  for each row execute function public.tg_custom_measurements_gating();

create or replace function public.tg_custom_attributes_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_custom_field_enabled(new.animal_profile_id, new.field_definition_id);  -- R13.14
  perform public.assert_custom_value_valid(new.field_definition_id, new.value);                -- R13.16
  return new;
end; $$;
revoke execute on function public.tg_custom_attributes_gating () from public, authenticated, anon;
create trigger custom_attributes_gating
  before insert or update on public.custom_attributes
  for each row execute function public.tg_custom_attributes_gating();

notify pgrst, 'reload schema';

commit;
