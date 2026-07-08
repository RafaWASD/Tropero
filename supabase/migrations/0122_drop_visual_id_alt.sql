-- 0122_drop_visual_id_alt.sql  (spec 02 — delta IDENTIFICADORES UNIFICADOS)
--
-- 🔴 NO aplicar desde acá — lo aplica el LEADER por Supabase MCP con autorización de Raf (Gate 1 PASS +
--    reviewer + Gate 2 + puerta de deploy). Es el PASO 2 del deploy (design §11): el frontend + schema
--    PowerSync del PASO 1 (commit 865e954) ya dejaron de tocar la columna → esta migración la elimina sin
--    ventana rota. Hasta el deploy, las suites backend que asumen el estado nuevo FALLAN (esperado, patrón
--    0119/0121).
--
-- QUÉ HACE (IDU.2, atómico): borra `visual_id_alt` del todo.
--   (1)  drop del trigger de completitud `animal_profiles_identity_check` (+ su función) → un animal puede
--        quedar con CERO identificadores de usuario (siempre tiene su PK). El anti-spoof (0079) y la unicidad
--        del idv NO se tocan.
--   (1b) drop de la función MUERTA tg_reproductive_events_create_calf (0032, sin trigger activo — verificado
--        por el leader vía pg_trigger) que referenciaba la columna.
--   (2)  re-create de las 6 funciones que referencian la columna, SIN ella (moldeadas sobre el cuerpo VIGENTE
--        del remoto, reference_function_recreate_base): register_birth (sin fallback), create_animal
--        (DROP+CREATE, quita p_visual_id_alt), import_rodeo_bulk, transfer_animal, y los 2 reportes
--        (DROP+CREATE por el RETURNS TABLE).
--   (2b) assert_custom_value_valid (0096) con la validación SERVER-AUTORITATIVA del apodo (M1 de Gate 1):
--        cuando data_key='apodo', enforça char_length ≤15 + charset (letras/dígitos/ñ/tildes/espacio/guion).
--   (3)  rename del label del field apodo → "Nombre/Apodo".
--   (4)  drop físico de la columna + sus dependientes (trgm index, los 2 CHECK).
--
-- ORDEN: primero re-crear las funciones con los cuerpos NUEVOS (sin la columna → válidos), y RECIÉN dropear
-- la columna al final. Todo en una transacción (IDU.2.7: el drop-trigger + register_birth-sin-fallback son
-- inseparables — una cría both-null persiste sin 23514 SOLO si el trigger ya no está).

begin;

-- ─── (1) Trigger de completitud + función ────────────────────────────────────────────────────────
drop trigger  if exists animal_profiles_identity_check on public.animal_profiles;
drop function if exists public.tg_animal_profiles_identity_check ();

-- ─── (1b) Función muerta (0032) que referencia la columna ────────────────────────────────────────
drop function if exists public.tg_reproductive_events_create_calf () cascade;

-- ─── (2) register_birth — SIN el fallback visual_id_alt. Misma firma 6-arg (CREATE OR REPLACE). ───
create or replace function public.register_birth (
  p_mother_profile_id uuid,
  p_event_date        date,
  p_calves            jsonb,
  p_client_op_id      uuid default null,
  p_calf_rodeo_id     uuid default null,
  p_calf_idv          text default null
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid; v_species_id uuid; v_rodeo_id uuid; v_system_id uuid; v_mother_breed_id uuid;
  v_calf_rodeo_id uuid; v_calf_rodeo_system uuid; v_calf_idv text;
  v_birth_event_id uuid; v_existing_id uuid; v_calf jsonb; v_calf_sex text; v_calf_weight numeric;
  v_calf_tag text; v_calf_category_id uuid; v_calf_category_code text;
  v_calf_animal_id uuid; v_calf_profile_id uuid; v_first_calf_id uuid;
  v_count int;
begin
  select p.establishment_id, p.rodeo_id, a.species_id, r.system_id, p.breed_id
    into v_est, v_rodeo_id, v_species_id, v_system_id, v_mother_breed_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = p_mother_profile_id and p.deleted_at is null;
  if v_est is null then raise exception 'mother animal_profile not found' using errcode = '23503'; end if;
  if not public.has_role_in(v_est) then raise exception 'not authorized to register a birth for this animal' using errcode = '42501'; end if;

  if p_client_op_id is not null then
    select re.id into v_existing_id
    from public.reproductive_events re
    join public.animal_profiles p on p.id = re.animal_profile_id
    where re.client_op_id = p_client_op_id and re.animal_profile_id = p_mother_profile_id
      and p.establishment_id = v_est and re.deleted_at is null
    limit 1;
    if v_existing_id is not null then return v_existing_id; end if;
  end if;

  if p_event_date is not null and (extract(year from p_event_date) < 1900 or extract(year from p_event_date) > extract(year from current_date)::int + 1) then
    raise exception 'p_event_date out of range (1900..current+1)' using errcode = '22023';
  end if;

  if p_calves is null or jsonb_typeof(p_calves) <> 'array' then raise exception 'p_calves must be a json array' using errcode = '22023'; end if;
  v_count := jsonb_array_length(p_calves);
  if v_count < 1 then raise exception 'p_calves must contain at least one calf' using errcode = '22023'; end if;

  if p_calf_rodeo_id is null then
    v_calf_rodeo_id := v_rodeo_id;
  else
    select r.system_id into v_calf_rodeo_system from public.rodeos r
    where r.id = p_calf_rodeo_id and r.establishment_id = v_est and r.active = true and r.deleted_at is null;
    if v_calf_rodeo_system is null then raise exception 'calf rodeo not found / inactive / other tenant' using errcode = '23514'; end if;
    if v_calf_rodeo_system is distinct from v_system_id then raise exception 'calf rodeo belongs to a different productive system' using errcode = '23514'; end if;
    v_calf_rodeo_id := p_calf_rodeo_id;
  end if;

  insert into public.reproductive_events (animal_profile_id, event_type, event_date, client_op_id)
  values (p_mother_profile_id, 'birth', p_event_date, p_client_op_id)
  returning id into v_birth_event_id;

  for v_calf in select * from jsonb_array_elements(p_calves)
  loop
    v_calf_sex := v_calf ->> 'calf_sex';
    if v_calf_sex is null or v_calf_sex not in ('male', 'female') then raise exception 'each calf needs calf_sex in (male, female)' using errcode = '23514'; end if;
    v_calf_weight := nullif(v_calf ->> 'calf_weight', '')::numeric;
    v_calf_tag := nullif(trim(coalesce(v_calf ->> 'calf_tag_electronic', '')), '');
    if v_calf_tag is not null and char_length(v_calf_tag) > 15 then raise exception 'calf_tag_electronic must be at most 15 digits (FDX-B EID)' using errcode = '23514'; end if;
    -- idv POR CRÍA (0121): el calf_idv del elemento gana; si vacío, cae al p_calf_idv top-level (cría al pie #15).
    v_calf_idv := coalesce(
        nullif(trim(coalesce(v_calf ->> 'calf_idv', '')), ''),
        nullif(trim(coalesce(p_calf_idv, '')), '')
    );

    v_calf_category_code := case when v_calf_sex = 'male' then 'ternero' else 'ternera' end;
    select id into v_calf_category_id from public.categories_by_system where system_id = v_system_id and code = v_calf_category_code and active = true;

    insert into public.animals (tag_electronic, species_id, sex, birth_date)
    values (v_calf_tag, v_species_id, v_calf_sex, p_event_date)
    returning id into v_calf_animal_id;

    -- IDU.2.2: sin visual_id_alt (ni la columna ni el fallback). Una cría sin tag ni idv persiste con ambos
    -- NULL — el trigger de completitud ya no existe (IDU.2.1), no hay 23514.
    insert into public.animal_profiles (
      animal_id, establishment_id, rodeo_id, idv, category_id, category_override,
      breed_id, birth_weight, entry_date, entry_origin, status
    ) values (
      v_calf_animal_id, v_est, v_calf_rodeo_id, v_calf_idv,
      v_calf_category_id, false, v_mother_breed_id, v_calf_weight, p_event_date, 'born_here', 'active'
    ) returning id into v_calf_profile_id;

    insert into public.birth_calves (birth_event_id, calf_profile_id) values (v_birth_event_id, v_calf_profile_id);
    if v_first_calf_id is null then v_first_calf_id := v_calf_profile_id; end if;
  end loop;

  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;
  return v_birth_event_id;
end; $$;

revoke execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) to authenticated;

-- ─── (2) create_animal — DROP+CREATE (se quita el parámetro p_visual_id_alt). ────────────────────
drop function if exists public.create_animal (uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, text, text, date, text, text, text, text, date, numeric, uuid, text, boolean);

create function public.create_animal (
  p_animal_id uuid, p_profile_id uuid, p_establishment_id uuid, p_rodeo_id uuid, p_category_id uuid,
  p_sex text, p_species_id uuid, p_category_override boolean default false, p_status text default 'active',
  p_tag_electronic text default null, p_birth_date date default null, p_idv text default null,
  p_breed text default null, p_coat_color text default null, p_entry_date date default null,
  p_entry_weight numeric default null, p_management_group_id uuid default null, p_teeth_state text default null,
  p_nursing boolean default null
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_tag text := nullif(trim(coalesce(p_tag_electronic, '')), '');
begin
  if not public.has_role_in(p_establishment_id) then
    raise exception 'not authorized to create an animal in this establishment' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.animal_profiles ap
    where ap.id = p_profile_id and ap.animal_id = p_animal_id and ap.establishment_id = p_establishment_id
  ) then
    return p_profile_id;
  end if;

  insert into public.animals (id, sex, species_id, tag_electronic, birth_date)
  values (p_animal_id, p_sex, p_species_id, v_tag, p_birth_date)
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.animals a
    where a.id = p_animal_id and a.sex = p_sex and a.species_id = p_species_id
      and a.tag_electronic is not distinct from v_tag
      and a.birth_date is not distinct from p_birth_date and a.deleted_at is null
  ) then
    raise exception 'animal id does not match this create intent' using errcode = '42501';
  end if;

  -- IDU.2.5: sin visual_id_alt.
  insert into public.animal_profiles (
    id, animal_id, establishment_id, rodeo_id, category_id, category_override, status,
    idv, breed, coat_color, entry_date, entry_weight, management_group_id,
    teeth_state, nursing
  ) values (
    p_profile_id, p_animal_id, p_establishment_id, p_rodeo_id, p_category_id,
    coalesce(p_category_override, false),
    coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active')::public.animal_status,
    nullif(trim(coalesce(p_idv, '')), ''),
    nullif(trim(coalesce(p_breed, '')), ''),
    nullif(trim(coalesce(p_coat_color, '')), ''),
    p_entry_date, p_entry_weight, p_management_group_id,
    nullif(trim(coalesce(p_teeth_state, '')), '')::public.teeth_state_enum,
    coalesce(p_nursing, false)
  )
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.animal_profiles ap
    where ap.id = p_profile_id and ap.animal_id = p_animal_id
      and ap.establishment_id = p_establishment_id and ap.deleted_at is null
  ) then
    raise exception 'profile id does not belong to this establishment' using errcode = '42501';
  end if;

  return p_profile_id;
end; $$;

revoke execute on function public.create_animal (uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, text, text, date, text, text, text, date, numeric, uuid, text, boolean) from public, anon;
grant  execute on function public.create_animal (uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, text, text, date, text, text, text, date, numeric, uuid, text, boolean) to authenticated;

-- ─── (2) import_rodeo_bulk — CREATE OR REPLACE, quita visual_id_alt del INSERT. ──────────────────
create or replace function public.import_rodeo_bulk (p_rodeo_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_establishment_id uuid; v_species_id uuid; v_system_id uuid; v_uid uuid := auth.uid();
  v_row jsonb; v_ok int := 0; v_err int := 0; v_errors jsonb := '[]'::jsonb;
  v_animal_id uuid; v_profile_id uuid; v_cat_id uuid; v_cat_code text; v_cat_override boolean;
  v_sex text; v_row_index int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select r.establishment_id, r.species_id, r.system_id
    into v_establishment_id, v_species_id, v_system_id
  from public.rodeos r where r.id = p_rodeo_id and r.deleted_at is null;
  if v_establishment_id is null then raise exception 'rodeo % not found or deleted', p_rodeo_id using errcode = '23503'; end if;

  if not (
    public.is_owner_of(v_establishment_id)
    or exists (select 1 from public.user_roles ur where ur.user_id = v_uid and ur.establishment_id = v_establishment_id and ur.role = 'veterinarian' and ur.active = true)
  ) then
    raise exception 'caller is not owner or veterinarian of the destination establishment' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    raise exception 'import batch exceeds max rows: % (max 5000 per call)', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_index := coalesce((v_row->>'row_index')::int, -1);
    begin
      v_sex := v_row->>'sex';
      v_cat_code := nullif(trim(coalesce(v_row->>'category_code', '')), '');
      v_cat_override := coalesce((v_row->>'category_override')::boolean, false);
      v_cat_id := null;
      if v_cat_code is not null then
        select c.id into v_cat_id from public.categories_by_system c
        where c.system_id = v_system_id and c.code = v_cat_code and c.active = true;
      end if;
      if v_cat_id is null then
        v_cat_override := false;
        select c.id into v_cat_id from public.categories_by_system c
        where c.system_id = v_system_id and c.code = case when v_sex = 'male' then 'torito' else 'vaquillona' end and c.active = true;
      end if;
      if v_cat_id is null then raise exception 'no se pudo resolver una categoría del catálogo para la fila'; end if;

      v_animal_id := gen_random_uuid();
      insert into public.animals (id, species_id, sex, tag_electronic, birth_date)
      values (v_animal_id, v_species_id, v_sex, nullif(trim(coalesce(v_row->>'tag_electronic', '')), ''), (nullif(trim(coalesce(v_row->>'birth_date', '')), ''))::date);

      -- IDU.2.5: sin visual_id_alt.
      v_profile_id := gen_random_uuid();
      insert into public.animal_profiles (
        id, animal_id, establishment_id, rodeo_id, idv, breed,
        category_id, category_override, management_group_id, status
      )
      values (
        v_profile_id, v_animal_id, v_establishment_id, p_rodeo_id,
        nullif(trim(coalesce(v_row->>'idv', '')), ''),
        nullif(trim(coalesce(v_row->>'breed', '')), ''),
        v_cat_id, v_cat_override, nullif(v_row->>'management_group_id', '')::uuid, 'active'
      );

      v_ok := v_ok + 1;
    exception
      when unique_violation then
        v_err := v_err + 1;
        v_errors := v_errors || jsonb_build_object('row_index', v_row_index, 'reason', 'duplicate');
      when others then
        v_err := v_err + 1;
        v_errors := v_errors || jsonb_build_object('row_index', v_row_index, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('imported_ok', v_ok, 'imported_errors', v_err, 'errors', v_errors);
end; $$;

revoke execute on function public.import_rodeo_bulk (uuid, jsonb) from public, anon;
grant  execute on function public.import_rodeo_bulk (uuid, jsonb) to authenticated;

-- ─── (2) transfer_animal — CREATE OR REPLACE, quita visual_id_alt del select+insert. ─────────────
create or replace function public.transfer_animal (p_source_profile_id uuid, p_target_establishment_id uuid, p_target_rodeo_id uuid, p_target_profile_id uuid, p_target_category_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_source_est uuid; v_animal_id uuid; v_source_created_by uuid; v_source_idv text;
  v_source_breed text; v_source_coat text; v_source_rodeo_id uuid;
  v_source_rodeo_system uuid; v_target_rodeo_system uuid; v_idv_to_use text;
  v_idv_dropped boolean := false; v_now timestamptz := now();
begin
  if exists (select 1 from public.animal_profiles where id = p_target_profile_id and establishment_id = p_target_establishment_id) then
    return jsonb_build_object('target_profile_id', p_target_profile_id, 'idv_dropped', false, 'source_profile_id', p_source_profile_id, 'replay', true);
  end if;

  -- IDU.2.5: se deja de leer visual_id_alt de la fila origen.
  select establishment_id, animal_id, created_by, idv, breed, coat_color, rodeo_id
    into v_source_est, v_animal_id, v_source_created_by, v_source_idv, v_source_breed, v_source_coat, v_source_rodeo_id
  from public.animal_profiles
  where id = p_source_profile_id and status = 'active' and deleted_at is null;
  if v_source_est is null then raise exception 'source profile not found, not active, or already transferred' using errcode = '23503'; end if;

  if not public.has_role_in(p_target_establishment_id) then
    raise exception 'not authorized in target establishment (need active role in Y)' using errcode = '42501';
  end if;
  if not (public.has_role_in(v_source_est) and (public.is_owner_of(v_source_est) or v_source_created_by = auth.uid())) then
    raise exception 'not authorized to remove the animal from the source field (need active role in X AND owner-or-creator)' using errcode = '42501';
  end if;
  if v_source_est = p_target_establishment_id then raise exception 'source and target establishment are the same' using errcode = '23514'; end if;

  select r.system_id into v_source_rodeo_system from public.rodeos r where r.id = v_source_rodeo_id;
  select r.system_id into v_target_rodeo_system from public.rodeos r
  where r.id = p_target_rodeo_id and r.establishment_id = p_target_establishment_id and r.active = true and r.deleted_at is null;
  if v_target_rodeo_system is null then raise exception 'target rodeo not found / inactive / not in target establishment' using errcode = '23514'; end if;
  if v_target_rodeo_system is distinct from v_source_rodeo_system then raise exception 'target rodeo belongs to a different productive system (R4.5.1)' using errcode = '23514'; end if;

  v_idv_to_use := nullif(trim(coalesce(v_source_idv, '')), '');
  if v_idv_to_use is not null and exists (
    select 1 from public.animal_profiles ap where ap.establishment_id = p_target_establishment_id and ap.idv = v_idv_to_use and ap.deleted_at is null
  ) then
    v_idv_to_use := null; v_idv_dropped := true;
  end if;

  update public.animal_profiles
     set status = 'transferred', exit_reason = 'transfer'::public.exit_reason_enum, exit_date = v_now::date
   where id = p_source_profile_id;

  -- IDU.2.5: sin visual_id_alt en el insert del perfil destino.
  insert into public.animal_profiles (
    id, animal_id, establishment_id, rodeo_id, category_id, category_override, status,
    idv, management_group_id, breed, coat_color,
    entry_date, entry_origin, entry_weight, notes
  ) values (
    p_target_profile_id, v_animal_id, p_target_establishment_id, p_target_rodeo_id, p_target_category_id,
    false, 'active', v_idv_to_use, null,
    v_source_breed, v_source_coat,
    v_now::date, null, null, null
  );

  update public.weight_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.reproductive_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.sanitary_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.condition_score_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.lab_samples set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;

  perform set_config('rafaq.is_transfer', 'on', true);
  update public.animal_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id where animal_profile_id = p_source_profile_id;
  perform set_config('rafaq.is_transfer', 'off', true);

  update public.animal_category_history set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id where animal_profile_id = p_source_profile_id;
  update public.birth_calves set calf_profile_id = p_target_profile_id where calf_profile_id = p_source_profile_id;
  update public.birth_calves bc set establishment_id = p_target_establishment_id
   where bc.birth_event_id in (select id from public.reproductive_events where animal_profile_id = p_target_profile_id and event_type = 'birth');
  update public.reproductive_events set bull_id = p_target_profile_id where bull_id = p_source_profile_id;
  update public.reproductive_events set calf_id = p_target_profile_id where calf_id = p_source_profile_id;

  return jsonb_build_object('target_profile_id', p_target_profile_id, 'idv_dropped', v_idv_dropped, 'source_profile_id', p_source_profile_id, 'replay', false);
end; $$;

revoke execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) from public, anon;
grant  execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) to authenticated;

-- ─── (2) reportes — DROP+CREATE (cambia el RETURNS TABLE al quitar visual_id_alt). ───────────────
drop function if exists public.establishment_overdue_doses (uuid, integer, integer);

create function public.establishment_overdue_doses (p_establishment_id uuid, p_lookback_days integer default 365, p_limit integer default 500)
returns table (animal_profile_id uuid, idv text, product_name text, next_dose_date date)
language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.has_role_in(p_establishment_id) then raise exception 'not authorized to read this establishment''s overdue doses' using errcode = '42501'; end if;
  if p_lookback_days < 0 then raise exception 'p_lookback_days must be >= 0' using errcode = '22023'; end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'p_limit out of range (1..1000)' using errcode = '22023'; end if;

  return query
  select se.animal_profile_id, p.idv, se.product_name, se.next_dose_date
  from public.sanitary_events se
  join public.animal_profiles p on p.id = se.animal_profile_id
  where se.deleted_at is null and se.next_dose_date is not null and se.next_dose_date < current_date
    and se.next_dose_date >= current_date - p_lookback_days
    and p.establishment_id = p_establishment_id and p.deleted_at is null and p.status = 'active'
    and not exists (
      select 1 from public.sanitary_events later
      where later.animal_profile_id = se.animal_profile_id and later.product_name = se.product_name
        and later.deleted_at is null and (later.event_date, later.created_at) > (se.event_date, se.created_at)
    )
  order by se.next_dose_date asc
  limit p_limit;
end; $$;

revoke execute on function public.establishment_overdue_doses (uuid, integer, integer) from public, anon;
grant  execute on function public.establishment_overdue_doses (uuid, integer, integer) to authenticated;

drop function if exists public.establishment_unweighed (uuid, integer, text[]);

create function public.establishment_unweighed (p_establishment_id uuid, p_threshold_days integer default 180, p_category_codes text[] default null)
returns table (animal_profile_id uuid, idv text, category_code text, category_name text, last_weight_date date, days_since integer)
language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.has_role_in(p_establishment_id) then raise exception 'not authorized to read this establishment''s unweighed animals' using errcode = '42501'; end if;
  if p_threshold_days < 0 or p_threshold_days > 3650 then raise exception 'p_threshold_days out of range (0..3650)' using errcode = '22023'; end if;
  if p_category_codes is not null and cardinality(p_category_codes) > 64 then raise exception 'p_category_codes too large (max 64)' using errcode = '22023'; end if;

  return query
  with active_animals as (
    select p.id as animal_profile_id, p.idv, p.category_id, c.code, c.name
    from public.animal_profiles p
    join public.categories_by_system c on c.id = p.category_id
    where p.establishment_id = p_establishment_id and p.deleted_at is null and p.status = 'active'
      and (p_category_codes is null or c.code = any(p_category_codes))
  ),
  last_weight as (
    select distinct on (w.animal_profile_id) w.animal_profile_id, w.weight_date
    from public.weight_events w
    join active_animals aa on aa.animal_profile_id = w.animal_profile_id
    where w.deleted_at is null
    order by w.animal_profile_id, w.weight_date desc, w.created_at desc
  )
  select aa.animal_profile_id, aa.idv, aa.code, aa.name,
         lw.weight_date as last_weight_date,
         case when lw.weight_date is null then null else (current_date - lw.weight_date) end as days_since
  from active_animals aa
  left join last_weight lw on lw.animal_profile_id = aa.animal_profile_id
  where lw.weight_date is null or lw.weight_date < current_date - p_threshold_days
  order by aa.code, aa.idv;
end; $$;

revoke execute on function public.establishment_unweighed (uuid, integer, text[]) from public, anon;
grant  execute on function public.establishment_unweighed (uuid, integer, text[]) to authenticated;

-- ─── (2b) assert_custom_value_valid — validación SERVER del apodo (M1). CREATE OR REPLACE. ────────
create or replace function public.assert_custom_value_valid (p_field_definition_id uuid, p_value jsonb)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_uic text; v_cfg jsonb; v_opts jsonb; v_dk text; v_str text;
begin
  select ui_component, config_schema, data_key into v_uic, v_cfg, v_dk
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
    if jsonb_array_length(p_value) > 50 then
      raise exception 'custom multi value for % exceeds max selected options (50)', p_field_definition_id using errcode = '23514'; end if;
  elsif v_uic in ('text','date') then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'custom value for % must be string', p_field_definition_id using errcode = '23514'; end if;
    if v_uic = 'date' and (p_value #>> '{}')::date is null then
      raise exception 'custom date value % invalid', p_value using errcode = '23514'; end if;
    -- M1 (IDU.5.1b): el apodo es identificador de primera clase → formato server-autoritativo (≤15 + charset
    -- alfanum + ñ/tildes + espacio + guion). Espeja sanitizeApodoInput del cliente (UX). data_key='apodo'.
    if v_dk = 'apodo' then
      v_str := p_value #>> '{}';
      if char_length(v_str) > 15 then
        raise exception 'apodo excede 15 caracteres' using errcode = '23514'; end if;
      if v_str ~ '[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ \-]' then
        raise exception 'apodo tiene caracteres no permitidos (solo letras, dígitos, espacios y guiones)' using errcode = '23514'; end if;
    end if;
  else
    raise exception 'custom value: unsupported ui_component % for field %', v_uic, p_field_definition_id using errcode = '23514';
  end if;
end; $$;

-- ─── (3) Rename del label del apodo ──────────────────────────────────────────────────────────────
update public.field_definitions set label = 'Nombre/Apodo'
 where data_key = 'apodo' and label is distinct from 'Nombre/Apodo';

-- ─── (4) Drop físico de la columna + dependientes (trgm index + los 2 CHECK) ─────────────────────
drop index    if exists public.animal_profiles_visual_alt_trgm;
alter table   public.animal_profiles drop constraint if exists animal_profiles_visual_id_alt_len_chk;
alter table   public.animal_profiles drop constraint if exists animal_profiles_local_id_check;
alter table   public.animal_profiles drop column     if exists visual_id_alt;

notify pgrst, 'reload schema';
commit;
