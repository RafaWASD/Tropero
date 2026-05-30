-- 0048_birth_calves_mono_after_insert.sql  (fix del fold Tier 1, sesión 20)
--
-- PROBLEMA: en 0045, el trigger mono-ternero tg_reproductive_events_create_calf es
-- BEFORE INSERT y intentaba `insert into birth_calves (birth_event_id = new.id, ...)`.
-- En un BEFORE INSERT la fila de reproductive_events AÚN no existe en la tabla, así que
-- el FK birth_calves_birth_event_id_fkey falla con 23503
-- ("Key (birth_event_id)=... is not present in table reproductive_events").
--
-- FIX: separar responsabilidades.
--  (a) El trigger BEFORE INSERT vuelve a su forma as-built: crea el ternero y setea
--      new.calf_id (mono-ternero), SIN tocar birth_calves.
--  (b) Un trigger AFTER INSERT nuevo puebla birth_calves(new.id, new.calf_id) cuando el
--      parto fue mono-ternero (calf_id no-NULL). Para entonces la fila de
--      reproductive_events ya existe, así que el FK se satisface.
-- El RPC register_birth (mellizos) NO se ve afectado: inserta el evento sin calf_sex (el
-- BEFORE trigger no actúa) y puebla birth_calves por dentro, ya con el id del evento
-- persistido (returning ... into v_birth_event_id antes del insert a la puente).
-- La atomicidad (R9.4) se conserva: cualquier excepción en el AFTER trigger revierte el INSERT.

-- (a) BEFORE INSERT: como el as-built 0031, sin insertar en birth_calves.
create or replace function public.tg_reproductive_events_create_calf ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mother_species_id uuid;
  v_mother_est_id uuid;
  v_mother_rodeo_id uuid;
  v_system_id uuid;
  v_calf_animal_id uuid;
  v_calf_profile_id uuid;
  v_calf_category_id uuid;
  v_calf_category_code text;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
begin
  if new.event_type <> 'birth' then return new; end if;
  if new.calf_id is not null then return new; end if;
  if new.calf_sex is null then return new; end if;   -- register_birth (mellizos) inserta sin calf_sex → este trigger no actúa
  -- calf_weight es opcional; el alta no depende de él.

  select a.species_id, p.establishment_id, p.rodeo_id, r.system_id
    into v_mother_species_id, v_mother_est_id, v_mother_rodeo_id, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  v_calf_category_code := case when new.calf_sex = 'male' then 'ternero' else 'ternera' end;
  select id into v_calf_category_id from public.categories_by_system
    where system_id = v_system_id and code = v_calf_category_code and active = true;

  insert into public.animals (tag_electronic, species_id, sex, birth_date)
  values (nullif(trim(new.calf_tag_electronic), ''), v_mother_species_id, new.calf_sex, new.event_date)
  returning id into v_calf_animal_id;

  insert into public.animal_profiles (
    animal_id, establishment_id, rodeo_id,
    visual_id_alt, category_id, category_override,
    birth_weight, entry_date, entry_origin, status
  ) values (
    v_calf_animal_id,
    v_mother_est_id,
    v_mother_rodeo_id,
    case when nullif(trim(new.calf_tag_electronic), '') is null then v_visual_fallback else null end,
    v_calf_category_id,
    false,
    new.calf_weight,
    new.event_date,
    'born_here',
    'active'
  ) returning id into v_calf_profile_id;

  new.calf_id := v_calf_profile_id;
  return new;
exception
  when others then
    raise;   -- R9.4: re-raise asegura rollback del parto completo. NO tragar la excepción.
end; $$;

-- (b) AFTER INSERT: poblar la tabla puente para el caso mono-ternero (calf_id seteado por
-- el BEFORE trigger). La fila de reproductive_events ya existe → el FK se satisface.
-- SECURITY DEFINER: corre como owner del schema (el cliente no tiene GRANT INSERT, SEC-SPEC-04).
create or replace function public.tg_reproductive_events_link_birth_calf ()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.event_type = 'birth' and new.calf_id is not null then
    insert into public.birth_calves (birth_event_id, calf_profile_id)
    values (new.id, new.calf_id)
    on conflict do nothing;   -- defensivo: idempotente si el vínculo ya existe
  end if;
  return new;
end; $$;

-- Orden de triggers AFTER INSERT (alfabético por nombre en Postgres):
--   reproductive_events_apply_transition  (transición de la madre)
--   reproductive_events_link_birth_calf   (puente mono)
-- Ambos son independientes; el orden no importa funcionalmente.
create trigger reproductive_events_link_birth_calf
  after insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_link_birth_calf();

notify pgrst, 'reload schema';
