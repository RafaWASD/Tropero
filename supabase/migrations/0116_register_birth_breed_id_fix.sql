-- 0116_register_birth_breed_id_fix.sql  (spec 02 — delta VINCULAR LA CRÍA AL PIE #15; FIX Gate 2 HIGH)
--
-- 🔴 CORRIGE UNA REGRESIÓN DE DATO REGULADO introducida por 0115. 0115 moldeó register_birth sobre 0075
-- (firma de 4 args, SIN breed_id) en vez del AS-BUILT REAL 0109, que había agregado la HERENCIA de
-- animal_profiles.breed_id de la MADRE al ternero (spec 08 SIGSA R1.7). El DROP+CREATE de 0115 borró esa
-- herencia → todo ternero creado por register_birth (mellizos + el camino cría-al-pie CREATE de #15) nacía
-- con breed_id NULL → la declaración SIGSA pierde la raza (regula). Lo cazó el Gate 2 (la suite animal no
-- cubre raza → la suite SIGSA T3 R1.7 quedó enmascarada).
--
-- Este fix re-define register_birth (firma 6-arg, la que dejó 0115) COMBINANDO:
--   - el cuerpo de 0109 → herencia de breed_id de la madre (R1.7): lee p.breed_id en el SELECT de auth +
--     lo escribe en el INSERT de animal_profiles de cada ternero.
--   - las extensiones de 0115 (#15): p_calf_rodeo_id (rodeo editable, RCAP.7), p_calf_idv (LOW-1), cap del
--     tag (LOW-2), cota de p_event_date (LOW-3).
-- CREATE OR REPLACE (la firma 6-arg YA existe por 0115 → no se re-dropea). Re-aplica revoke/grant (idempotente).
-- Todo lo demás (auth derivada de la fila real, idempotencia HIGH-D1, atomicidad, tenant del server) intacto.
--
-- 🔴 NO aplicar desde acá: lo aplica el LEADER por Supabase MCP (Raf autorizó el deploy de #15). Tras aplicar,
-- re-correr las suites SIGSA (breed_id restaurado) + animal (#15 sigue verde).

create or replace function public.register_birth (
  p_mother_profile_id uuid,
  p_event_date        date,
  p_calves            jsonb,   -- [{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text? }, ...]
  p_client_op_id      uuid default null,   -- idempotencia (NULL online = as-built)
  p_calf_rodeo_id     uuid default null,   -- rodeo efectivo del ternero (NULL → rodeo de la madre, RCAP.7.2)
  p_calf_idv          text default null    -- LOW-1: IDV tipado del ternero (NULL → as-built)
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid;
  v_species_id uuid;
  v_rodeo_id uuid;
  v_system_id uuid;
  v_mother_breed_id uuid;       -- (R1.7, 0109) breed_id de la madre, heredado a cada ternero
  v_calf_rodeo_id uuid;
  v_calf_rodeo_system uuid;
  v_calf_idv text;
  v_birth_event_id uuid;
  v_existing_id uuid;
  v_calf jsonb;
  v_calf_sex text;
  v_calf_weight numeric;
  v_calf_tag text;
  v_calf_category_id uuid;
  v_calf_category_code text;
  v_calf_animal_id uuid;
  v_calf_profile_id uuid;
  v_first_calf_id uuid;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
  v_count int;
begin
  -- (a) AUTH derivada de la FILA REAL de la madre + breed_id (R1.7, 0109:80-81). Misma fila, sin query extra.
  select p.establishment_id, p.rodeo_id, a.species_id, r.system_id, p.breed_id
    into v_est, v_rodeo_id, v_species_id, v_system_id, v_mother_breed_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = p_mother_profile_id and p.deleted_at is null;
  if v_est is null then
    raise exception 'mother animal_profile not found' using errcode = '23503';
  end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to register a birth for this animal' using errcode = '42501';
  end if;

  -- (a-bis) idempotencia scopeada al caller (fix HIGH-D1, 0075/0109). DESPUES de has_role_in.
  if p_client_op_id is not null then
    select re.id into v_existing_id
    from public.reproductive_events re
    join public.animal_profiles p on p.id = re.animal_profile_id
    where re.client_op_id     = p_client_op_id
      and re.animal_profile_id = p_mother_profile_id
      and p.establishment_id   = v_est
      and re.deleted_at is null
    limit 1;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  -- (a-ter) LOW-3: cota de p_event_date DESPUES del guard de tenant.
  if p_event_date is not null and (
       extract(year from p_event_date) < 1900
       or extract(year from p_event_date) > extract(year from current_date)::int + 1
     ) then
    raise exception 'p_event_date out of range (1900..current+1)' using errcode = '22023';
  end if;

  if p_calves is null or jsonb_typeof(p_calves) <> 'array' then
    raise exception 'p_calves must be a json array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_calves);
  if v_count < 1 then
    raise exception 'p_calves must contain at least one calf' using errcode = '22023';
  end if;

  -- (a-quater) RODEO EFECTIVO del ternero (RCAP.7). NULL → rodeo de la madre; provisto → validar
  -- activo/del tenant de la madre/mismo sistema (anti-IDOR, 0087:115).
  if p_calf_rodeo_id is null then
    v_calf_rodeo_id := v_rodeo_id;
  else
    select r.system_id into v_calf_rodeo_system
    from public.rodeos r
    where r.id = p_calf_rodeo_id
      and r.establishment_id = v_est
      and r.active = true
      and r.deleted_at is null;
    if v_calf_rodeo_system is null then
      raise exception 'calf rodeo not found / inactive / other tenant' using errcode = '23514';
    end if;
    if v_calf_rodeo_system is distinct from v_system_id then
      raise exception 'calf rodeo belongs to a different productive system' using errcode = '23514';
    end if;
    v_calf_rodeo_id := p_calf_rodeo_id;
  end if;

  v_calf_idv := nullif(trim(coalesce(p_calf_idv, '')), '');   -- LOW-1

  insert into public.reproductive_events (animal_profile_id, event_type, event_date, client_op_id)
  values (p_mother_profile_id, 'birth', p_event_date, p_client_op_id)
  returning id into v_birth_event_id;

  for v_calf in select * from jsonb_array_elements(p_calves)
  loop
    v_calf_sex := v_calf ->> 'calf_sex';
    if v_calf_sex is null or v_calf_sex not in ('male', 'female') then
      raise exception 'each calf needs calf_sex in (male, female)' using errcode = '23514';
    end if;
    v_calf_weight := nullif(v_calf ->> 'calf_weight', '')::numeric;
    v_calf_tag := nullif(trim(coalesce(v_calf ->> 'calf_tag_electronic', '')), '');
    if v_calf_tag is not null and char_length(v_calf_tag) > 15 then   -- LOW-2
      raise exception 'calf_tag_electronic must be at most 15 digits (FDX-B EID)' using errcode = '23514';
    end if;

    v_calf_category_code := case when v_calf_sex = 'male' then 'ternero' else 'ternera' end;
    select id into v_calf_category_id from public.categories_by_system
      where system_id = v_system_id and code = v_calf_category_code and active = true;

    insert into public.animals (tag_electronic, species_id, sex, birth_date)
    values (v_calf_tag, v_species_id, v_calf_sex, p_event_date)
    returning id into v_calf_animal_id;

    insert into public.animal_profiles (
      animal_id, establishment_id, rodeo_id,
      idv, visual_id_alt, category_id, category_override,
      breed_id,
      birth_weight, entry_date, entry_origin, status
    ) values (
      v_calf_animal_id,
      v_est,
      v_calf_rodeo_id,        -- RCAP.7.4 (madre o el elegido)
      v_calf_idv,             -- LOW-1
      case when v_calf_tag is null then v_visual_fallback else null end,
      v_calf_category_id,
      false,
      v_mother_breed_id,      -- (R1.7, 0109) heredado de la madre — el FIX de esta migración
      v_calf_weight,
      p_event_date,
      'born_here',
      'active'
    ) returning id into v_calf_profile_id;

    insert into public.birth_calves (birth_event_id, calf_profile_id)
    values (v_birth_event_id, v_calf_profile_id);

    if v_first_calf_id is null then
      v_first_calf_id := v_calf_profile_id;
    end if;
  end loop;

  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;

  return v_birth_event_id;
end; $$;

revoke execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
