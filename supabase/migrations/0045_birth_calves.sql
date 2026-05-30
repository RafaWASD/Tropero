-- 0045_birth_calves.sql  (fold Tier 1 spec 02, sesión 20)
-- Item 3 del Tier 1: modelo uno-a-muchos para mellizos / N terneros por parto.
-- Cubre R7.9 / R9.5 (parto con N terneros, cuenta partos por evento) / R9.4 (rollback atómico).
--
-- Un parto = UN evento 'birth' con N terneros (tabla puente birth_calves). El conteo de
-- partos en compute_category cuenta EVENTOS 'birth' distintos, NUNCA filas de birth_calves
-- ni terneros (mellizos no doble-cuentan el parto de la madre).

-- ---------------------------------------------------------------------------
-- Tabla puente birth_calves (select-only para cliente; poblada solo server-side).
-- ---------------------------------------------------------------------------
create table public.birth_calves (
  birth_event_id   uuid not null references public.reproductive_events(id) on delete cascade,
  calf_profile_id  uuid not null references public.animal_profiles(id),
  created_at       timestamptz not null default now(),
  primary key (birth_event_id, calf_profile_id)
);
create index birth_calves_by_event on public.birth_calves (birth_event_id);
create index birth_calves_by_calf  on public.birth_calves (calf_profile_id);

-- RLS: el establishment se deriva del animal de la MADRE (dueña del evento de parto).
-- (SEC-SPEC-04, Gate 1 s20) La policy de SELECT filtra re.deleted_at is null: tras
-- soft-deletear el evento de parto, las filas dejan de ser visibles (R12.3).
alter table public.birth_calves enable row level security;

create policy birth_calves_select on public.birth_calves
  for select using (
    exists (
      select 1 from public.reproductive_events re
      where re.id = birth_calves.birth_event_id
        and re.deleted_at is null
        and has_role_in(establishment_of_profile(re.animal_profile_id))
    )
  );
-- NO hay policy de INSERT para authenticated: la tabla se puebla SOLO desde el flujo de
-- parto SECURITY DEFINER (trigger mono-ternero extendido + RPC register_birth), que corren
-- como owner del schema y bypassean RLS. Sin GRANT INSERT, un caller no puede fabricar
-- parentescos ni ligar terneros cruzados desde PostgREST (SEC-SPEC-04).
grant select on public.birth_calves to authenticated;

-- ---------------------------------------------------------------------------
-- compute_category: el conteo de partos cuenta EVENTOS 'birth' distintos (no terneros).
-- (idéntico al as-built 0031; se re-emite con el comentario de mellizos explícito y firme.)
-- ---------------------------------------------------------------------------
create or replace function public.compute_category (profile_id uuid)
returns uuid language plpgsql security definer stable
set search_path = public as $$
declare
  v_sex text;
  v_birth_date date;
  v_system_id uuid;
  v_births int;
  v_has_pos_tacto boolean;
  v_target_code text;
begin
  select a.sex, a.birth_date, r.system_id
    into v_sex, v_birth_date, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  if v_sex = 'male' then
    if v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternero';
    else
      v_target_code := 'torito';   -- conservador, owner puede cambiar a 'toro'
    end if;
  else
    -- conteo de PARTOS (no de terneros) — R7.3/R7.9 (sesión 17):
    -- un parto = un evento 'birth', aunque haya parido N terneros (mellizos).
    -- Con el modelo de mellizos uno-a-muchos (tabla puente birth_calves), un parto de
    -- mellizos sigue siendo UN evento 'birth', así que count(*) sobre eventos 'birth' ==
    -- count de partos. NUNCA sumar filas de birth_calves / terneros.
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id
      and event_type = 'birth'
      and deleted_at is null;

    select exists (
      select 1 from public.reproductive_events
      where animal_profile_id = profile_id
        and event_type = 'tacto'
        and pregnancy_status is not null
        and pregnancy_status <> 'empty'
        and deleted_at is null
    ) into v_has_pos_tacto;

    if v_births >= 2 then
      v_target_code := 'multipara';
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';
    elsif v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternera';
    else
      v_target_code := 'vaquillona';
    end if;
  end if;

  return (select id from public.categories_by_system
          where system_id = v_system_id and code = v_target_code and active = true
          limit 1);
end; $$;

grant execute on function public.compute_category (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger mono-ternero (caso común): extendido para poblar birth_calves.
-- Conserva el comportamiento as-built (0031) — crea el ternero a partir de los campos
-- calf_* del propio evento y linkea calf_id — y AGREGA la fila en birth_calves.
-- El INSERT a birth_calves lo hace el trigger SECURITY DEFINER (no el cliente, que no
-- tiene GRANT INSERT — SEC-SPEC-04). El re-raise del bloque exception preserva la
-- atomicidad del parto (R9.4): cualquier excepción revierte el INSERT completo.
-- ---------------------------------------------------------------------------
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

  -- Categoría inicial del ternero según sexo.
  v_calf_category_code := case when new.calf_sex = 'male' then 'ternero' else 'ternera' end;
  select id into v_calf_category_id from public.categories_by_system
    where system_id = v_system_id and code = v_calf_category_code and active = true;

  -- 1) Crear animal global (TAG si vino, sino null).
  insert into public.animals (tag_electronic, species_id, sex, birth_date)
  values (nullif(trim(new.calf_tag_electronic), ''), v_mother_species_id, new.calf_sex, new.event_date)
  returning id into v_calf_animal_id;

  -- 2) Crear perfil del ternero. management_group_id queda NULL (no hereda el lote, R9.1).
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

  -- 3) Linkear en el evento (compat as-built) y poblar la tabla puente (SEC-SPEC-04).
  new.calf_id := v_calf_profile_id;
  insert into public.birth_calves (birth_event_id, calf_profile_id)
  values (new.id, v_calf_profile_id);
  return new;
exception
  when others then
    -- R9.4: el re-raise asegura el rollback del parto completo. NO tragar la excepción.
    raise;
end; $$;

-- ---------------------------------------------------------------------------
-- RPC register_birth (N terneros / mellizos) — contrato firme SEC-SPEC-02 (Gate 1 s20).
-- Atomicidad total (R9.4/R9.5): si CUALQUIER ternero falla (incl. uno intermedio), la
-- excepción no capturada revierte el evento + todos los terneros ya creados.
-- ---------------------------------------------------------------------------
create or replace function public.register_birth (
  p_mother_profile_id uuid,
  p_event_date        date,
  p_calves            jsonb   -- [{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text? }, ...]
) returns uuid                -- devuelve el reproductive_events.id del parto creado
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid;
  v_species_id uuid;
  v_rodeo_id uuid;
  v_system_id uuid;
  v_birth_event_id uuid;
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
  -- (a) AUTORIZACIÓN derivada de la FILA REAL de la madre, NUNCA de un parámetro del cliente.
  select p.establishment_id, p.rodeo_id, a.species_id, r.system_id
    into v_est, v_rodeo_id, v_species_id, v_system_id
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

  -- Validación del payload: al menos un ternero, todos con calf_sex válido.
  if p_calves is null or jsonb_typeof(p_calves) <> 'array' then
    raise exception 'p_calves must be a json array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_calves);
  if v_count < 1 then
    raise exception 'p_calves must contain at least one calf' using errcode = '22023';
  end if;

  -- (b) Insertar el evento de parto SIN campos calf_* (calf_sex NULL) para que el trigger
  -- mono-ternero (tg_reproductive_events_create_calf) NO actúe — los terneros los crea este
  -- RPC. El trigger de transición de la madre (AFTER INSERT) se dispara UNA vez por el parto.
  insert into public.reproductive_events (animal_profile_id, event_type, event_date)
  values (p_mother_profile_id, 'birth', p_event_date)
  returning id into v_birth_event_id;

  -- (c) Iterar los terneros: crear animal + animal_profile (herencia de tenant = v_est de la
  -- fila real de la madre, NUNCA del payload) + fila en birth_calves. Cualquier fallo (incl.
  -- un ternero intermedio) propaga la excepción y revierte TODO (R9.4/R9.5).
  for v_calf in select * from jsonb_array_elements(p_calves)
  loop
    v_calf_sex := v_calf ->> 'calf_sex';
    if v_calf_sex is null or v_calf_sex not in ('male', 'female') then
      raise exception 'each calf needs calf_sex in (male, female)' using errcode = '23514';
    end if;
    v_calf_weight := nullif(v_calf ->> 'calf_weight', '')::numeric;
    v_calf_tag := nullif(trim(coalesce(v_calf ->> 'calf_tag_electronic', '')), '');

    v_calf_category_code := case when v_calf_sex = 'male' then 'ternero' else 'ternera' end;
    select id into v_calf_category_id from public.categories_by_system
      where system_id = v_system_id and code = v_calf_category_code and active = true;

    insert into public.animals (tag_electronic, species_id, sex, birth_date)
    values (v_calf_tag, v_species_id, v_calf_sex, p_event_date)
    returning id into v_calf_animal_id;

    insert into public.animal_profiles (
      animal_id, establishment_id, rodeo_id,
      visual_id_alt, category_id, category_override,
      birth_weight, entry_date, entry_origin, status
    ) values (
      v_calf_animal_id,
      v_est,                 -- herencia de tenant del server, NO del payload
      v_rodeo_id,            -- rodeo de la madre (R9.1)
      case when v_calf_tag is null then v_visual_fallback else null end,
      v_calf_category_id,
      false,
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

  -- Compat as-built: calf_id apunta al primer ternero. (Update de calf_id NO dispara el
  -- trigger de recálculo de 0046, que escucha event_type/pregnancy_status/deleted_at.)
  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;

  return v_birth_event_id;
end; $$;

-- (SEC-SPEC-02) Cierre de la superficie RPC con firma tipada completa. register_birth SÍ
-- debe ser invocable por authenticated (es el camino de carga de mellizos del cliente).
revoke execute on function public.register_birth (uuid, date, jsonb) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
