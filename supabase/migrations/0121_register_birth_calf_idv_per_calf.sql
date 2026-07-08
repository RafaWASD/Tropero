-- 0121_register_birth_calf_idv_per_calf.sql  (spec 02 — delta PARTO: CARAVANA VISUAL DEL TERNERO POR CRÍA)
--
-- 🔴 NO aplicar desde acá — lo aplica el LEADER por Supabase MCP con autorización de Raf (Gate 1 PASS +
--    reviewer APPROVED + Gate 2 PASS + Puerta de deploy). Hasta el deploy, las suites backend que llaman al
--    RPC con `calf_idv` per-calf reflejan el comportamiento VIEJO (idv escalar) → FALLAN. Es ESPERADO
--    (patrón 0075-0089 / 0114-0116). El implementer NO aplica la migración.
--
-- QUÉ CAMBIA (PCV.4, design §2): la caravana visual (idv) del ternero al parto pasa a computarse POR CRÍA
-- (leyendo `calf_idv` de cada elemento de `p_calves`, paralelo a `calf_tag_electronic`), con PRECEDENCIA
-- per-calf sobre el param top-level `p_calf_idv` (que se CONSERVA para backward-compat del camino cría al pie
-- #15, que manda 1 idv top-level). Antes el idv se computaba UNA sola vez antes del loop desde `p_calf_idv`
-- (idv escalar único para toda la camada → mellizos no podían tener idv distinto).
--
-- FIRMA INALTERADA (6-arg, la que dejó 0115/0116) → CREATE OR REPLACE (sin DROP; sin tocar grants/overloads).
-- Base: el CUERPO VIGENTE del RPC en el remoto (verificado por el leader hoy; `reference_function_recreate_base`
-- — NO 0116 a ciegas). Los 3 únicos cambios internos vs. ese cuerpo (PCV.4.6 — NADA más cambia):
--   (a) SACAR el `v_calf_idv := nullif(trim(coalesce(p_calf_idv,'')),'')` de ANTES del loop.
--   (b) DENTRO del loop, junto a la lectura de `calf_tag_electronic`, computar el idv POR CRÍA con precedencia
--       per-calf → param: coalesce(calf_idv del elemento, p_calf_idv top-level).
--   (c) REFINAR el fallback `visual_id_alt` a: solo `<fallback recién nacido>` cuando NO hay tag NI idv.
--
-- ⚠️ El fallback `visual_id_alt` en el caso both-null (sin tag ni idv) es LOAD-BEARING (design §5, PCV.2.4):
-- el at-least-one-identifier lo enforça el TRIGGER ACTIVO `animal_profiles_identity_check` (BEFORE INSERT,
-- 0021→0039), NO el column-CHECK `animal_profiles_local_id_check` (que es un NO-OP por su `OR true`). Sin el
-- fallback, la cría sin caravana rebotaría con 23514. Un delta futuro NO debe borrarlo creyéndolo display.
-- (El trigger lee `animals.tag_electronic`; el `animals` de la cría se inserta ANTES que el `animal_profiles`,
-- así que cuando el trigger corre ya ve el tag.)
--
-- CONSTRAINT DURO de Raf (PCV.2): ambas caravanas (visual idv + electrónica) SIEMPRE opcionales — NINGUNA
-- validación server-side fuerza cargar idv ni tag. La unicidad del idv (índice parcial
-- `animal_profiles_idv_unique (establishment_id, idv)`, 0020) → 23505 si se repite (mismo parto o rebaño):
-- eso NO es "forzar cargar", es "no repetir"; la RPC aborta atómica (rollback total).

create or replace function public.register_birth (
  p_mother_profile_id uuid,
  p_event_date        date,
  p_calves            jsonb,   -- [{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text?, "calf_idv": text? }, ...]
  p_client_op_id      uuid default null,   -- idempotencia (NULL online = as-built)
  p_calf_rodeo_id     uuid default null,   -- rodeo efectivo del ternero (NULL → rodeo de la madre, RCAP.7.2)
  p_calf_idv          text default null    -- idv top-level: EXCLUSIVO de cría al pie #15 (el parto manda idv per-calf en p_calves)
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid; v_species_id uuid; v_rodeo_id uuid; v_system_id uuid; v_mother_breed_id uuid;
  v_calf_rodeo_id uuid; v_calf_rodeo_system uuid; v_calf_idv text;
  v_birth_event_id uuid; v_existing_id uuid; v_calf jsonb; v_calf_sex text; v_calf_weight numeric;
  v_calf_tag text; v_calf_category_id uuid; v_calf_category_code text;
  v_calf_animal_id uuid; v_calf_profile_id uuid; v_first_calf_id uuid;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
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

  -- (a) PCV.4.2: el idv YA NO se computa acá (una vez antes del loop). Se computa POR CRÍA dentro del loop.

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
    -- (b) PCV.4.2/4.3: idv POR CRÍA. El `calf_idv` del elemento gana; si vacío/ausente, cae al `p_calf_idv`
    -- top-level (backward-compat cría al pie #15 — 1 cría, top-level). Los mellizos nunca mandan p_calf_idv:
    -- cada cría trae su calf_idv.
    v_calf_idv := coalesce(
        nullif(trim(coalesce(v_calf ->> 'calf_idv', '')), ''),
        nullif(trim(coalesce(p_calf_idv, '')), '')
    );

    v_calf_category_code := case when v_calf_sex = 'male' then 'ternero' else 'ternera' end;
    select id into v_calf_category_id from public.categories_by_system where system_id = v_system_id and code = v_calf_category_code and active = true;

    insert into public.animals (tag_electronic, species_id, sex, birth_date)
    values (v_calf_tag, v_species_id, v_calf_sex, p_event_date)
    returning id into v_calf_animal_id;

    insert into public.animal_profiles (
      animal_id, establishment_id, rodeo_id, idv, visual_id_alt, category_id, category_override,
      breed_id, birth_weight, entry_date, entry_origin, status
    ) values (
      v_calf_animal_id, v_est, v_calf_rodeo_id, v_calf_idv,
      -- (c) PCV.4.5: fallback SOLO cuando la cría no tiene tag NI idv (both-null). Si tiene idv (aunque no
      -- tenga tag) ya está identificada → visual_id_alt = null (el fallback NO aplica). LOAD-BEARING: el
      -- both-null pasa el trigger animal_profiles_identity_check por este fallback (design §5).
      case when v_calf_tag is null and v_calf_idv is null then v_visual_fallback else null end,
      v_calf_category_id, false, v_mother_breed_id, v_calf_weight, p_event_date, 'born_here', 'active'
    ) returning id into v_calf_profile_id;

    insert into public.birth_calves (birth_event_id, calf_profile_id) values (v_birth_event_id, v_calf_profile_id);
    if v_first_calf_id is null then v_first_calf_id := v_calf_profile_id; end if;
  end loop;

  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;
  return v_birth_event_id;
end; $$;

-- Grants: fail-closed (misma firma 6-arg exacta que el revoke/grant vigente). Idempotente.
revoke execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
