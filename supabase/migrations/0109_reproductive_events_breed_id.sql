-- 0109_reproductive_events_breed_id.sql  (spec 08 — export SIGSA, T3 / R1.6, R1.7)
-- Delta cross-spec sobre reproductive_events (spec 02, tabla creada en 0026). Agrega breed_id FK
-- nullable + cierra la herencia de raza del ternero al pie para el camino MELLIZOS (register_birth).
--
-- ⚠️ RECONCILIACIÓN CRÍTICA CONTRA EL AS-BUILT (design viejo vs schema real) — leer antes de tocar:
--
-- 1) reproductive_events NO TIENE columna `breed` (texto libre). El design 0109 asumía un
--    `UPDATE ... SET breed_id ... WHERE re.breed IS NOT NULL ...` análogo a 0108 (animal_profiles
--    SÍ tiene breed). Verificado contra el árbol de migraciones (0026 crea reproductive_events sin
--    breed; ninguna migración posterior la agrega; el único `breed` cercano es semen_registry.breed,
--    otra tabla). Ese UPDATE habría ABORTADO la migración con `column re.breed does not exist`.
--    → La "migración best-effort" de R1.6 es un NO-OP por la realidad del schema: no hay columna
--      fuente que matchear. Se OMITE el UPDATE (documentado). La columna breed_id se agrega igual
--      (R1.6 literal: "agregar breed_id FK nullable") para coherencia con el sync de PowerSync (T7)
--      y como columna forward-compat.
--
-- 2) La herencia que IMPORTA operativamente (R1.7) NO es sobre reproductive_events.breed_id: R1.7
--    pide que el animal_profile DEL TERNERO herede animal_profiles.breed_id de la MADRE. Eso se hace
--    en los DOS caminos de creación del ternero al pie:
--      (a) MONO-ternero: trigger tg_reproductive_events_create_calf → cubierto en 0108.
--      (b) MELLIZOS: RPC register_birth (último as-built = 0075, firma de 4 args) → cubierto AQUÍ.
--    reproductive_events.breed_id queda como columna nullable SIN path de población automática en
--    MVP (nada la lee; el código RAZA del TXT sale de animal_profiles.breed_id del ternero, R5.2).
--    Si post-MVP se quiere registrar la raza del ternero en el propio evento, se le da un path ahí.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE de register_birth.

-- ── (1) Columna breed_id FK nullable (R1.6) ────────────────────────────────────────────────
alter table public.reproductive_events
  add column if not exists breed_id uuid references public.breed_catalog(id);

comment on column public.reproductive_events.breed_id is
  'Raza CONTROLADA (FK a breed_catalog) del ternero del parto. Forward-compat (spec 08 R1.6). '
  'Sin path de población automática en MVP: la herencia de raza del ternero al pie va al '
  'animal_profile del ternero (R1.7), no a esta columna. reproductive_events NO tiene breed '
  'texto libre (a diferencia de animal_profiles 0020) → sin migración best-effort.';

-- ── (2) Best-effort de texto libre → catálogo (R1.6): NO-OP documentado ─────────────────────
-- reproductive_events NO tiene columna `breed` → no hay nada que matchear. El UPDATE del design
-- viejo (WHERE re.breed IS NOT NULL ...) habría abortado por columna inexistente. Se omite.

-- ── (3) Herencia de breed_id de la madre al ternero al pie — camino MELLIZOS (R1.7) ─────────
-- Re-definición MÍNIMA de register_birth (0075): idéntica byte-a-byte salvo (i) leer p.breed_id de
-- la madre en el SELECT de autorización y (ii) escribirlo en el INSERT del animal_profiles de cada
-- ternero del loop. Se preserva TODO lo demás: el guard de idempotencia scopeado al caller (fix
-- HIGH-D1), la autorización derivada de la fila REAL de la madre, la herencia de tenant del server
-- (no del payload), el manejo del payload jsonb, y la firma de 4 args (uuid, date, jsonb, uuid) con
-- sus GRANT/REVOKE. NO se dropea la firma (sigue siendo la misma de 0075): CREATE OR REPLACE basta.
create or replace function public.register_birth (
  p_mother_profile_id uuid,
  p_event_date        date,
  p_calves            jsonb,   -- [{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text? }, ...]
  p_client_op_id      uuid default null   -- clave de idempotencia (NULL en el path online = idéntico al as-built)
) returns uuid                -- devuelve el reproductive_events.id del parto creado (o del existente, en el no-op del propio caller)
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid;
  v_species_id uuid;
  v_rodeo_id uuid;
  v_system_id uuid;
  v_mother_breed_id uuid;   -- (R1.7) breed_id de la madre, heredado a cada ternero
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
  -- (a) AUTORIZACIÓN derivada de la FILA REAL de la madre, NUNCA de un parámetro del cliente.
  --     (as-built 0045/0075 — sin cambios; rige PRIMERO, antes de cualquier rama incl. el guard.)
  --     Se agrega p.breed_id a la lectura (R1.7) — misma fila de la madre, sin query extra.
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

  -- (a-bis) GUARD DE IDEMPOTENCIA — SCOPEADO AL CALLER (fix HIGH-D1). Corre DESPUÉS de has_role_in.
  -- Es un path de LECTURA del parto existente: solo es "el mismo" (no-op legítimo) si pertenece a la
  -- MISMA madre que el intent (animal_profile_id = p_mother_profile_id) y al TENANT ya autorizado
  -- (p.establishment_id = v_est, derivado por JOIN porque reproductive_events no tiene establishment_id).
  -- has_role_in valida la madre que el caller PASÓ, no la madre del parto existente → por eso el lookup
  -- DEBE re-anclar en p_mother_profile_id + v_est. Si NO matchea (otra madre/otro tenant = colisión
  -- ajena), NO se devuelve nada: cae al camino de creación, donde el INSERT del client_op_id choca el
  -- índice compuesto → 23505 genérico, sin filtrar datos ajenos ni oráculo de existencia.
  if p_client_op_id is not null then
    select re.id into v_existing_id
    from public.reproductive_events re
    join public.animal_profiles p on p.id = re.animal_profile_id
    where re.client_op_id     = p_client_op_id
      and re.animal_profile_id = p_mother_profile_id   -- mismo parto/misma madre que el intent
      and p.establishment_id   = v_est                 -- y del tenant ya autorizado (has_role_in pasado)
      and re.deleted_at is null
    limit 1;
    if v_existing_id is not null then
      return v_existing_id;        -- no-op idempotente LEGÍTIMO (mismo caller, misma madre, mismo client_op_id)
    end if;
    -- si llega acá: o no existe ningún parto con ese client_op_id para ESTE caller, o existe uno con ese
    -- client_op_id pero apunta a otra madre/otro tenant (colisión ajena) → camino de creación (abajo).
  end if;

  -- Validación del payload: al menos un ternero, todos con calf_sex válido. (as-built 0045)
  if p_calves is null or jsonb_typeof(p_calves) <> 'array' then
    raise exception 'p_calves must be a json array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_calves);
  if v_count < 1 then
    raise exception 'p_calves must contain at least one calf' using errcode = '22023';
  end if;

  -- (b) Insertar el evento de parto SIN campos calf_* (calf_sex NULL) para que el trigger mono-ternero
  -- (tg_reproductive_events_create_calf) NO actúe — los terneros los crea este RPC. El trigger de
  -- transición de la madre (AFTER INSERT) se dispara UNA vez por el parto. Persistimos client_op_id
  -- (NULL en el path online → mismo INSERT que el as-built; no-NULL → habilita la dedup explícita).
  insert into public.reproductive_events (animal_profile_id, event_type, event_date, client_op_id)
  values (p_mother_profile_id, 'birth', p_event_date, p_client_op_id)
  returning id into v_birth_event_id;

  -- (c) Iterar los terneros: crear animal + animal_profile (herencia de tenant = v_est de la fila real
  -- de la madre, NUNCA del payload; herencia de breed_id de la madre, R1.7) + fila en birth_calves.
  -- Cualquier fallo (incl. un ternero intermedio) propaga la excepción y revierte TODO (R9.4/R9.5).
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
      breed_id,
      birth_weight, entry_date, entry_origin, status
    ) values (
      v_calf_animal_id,
      v_est,                 -- herencia de tenant del server, NO del payload
      v_rodeo_id,            -- rodeo de la madre (R9.1)
      case when v_calf_tag is null then v_visual_fallback else null end,
      v_calf_category_id,
      false,
      v_mother_breed_id,     -- (R1.7) heredado de la madre (NULL si la madre no tiene breed_id)
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

  -- Compat as-built: calf_id apunta al primer ternero. (Update de calf_id NO dispara el trigger de
  -- recálculo de 0046, que escucha event_type/pregnancy_status/deleted_at.)
  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;

  return v_birth_event_id;
end; $$;

-- Cierre de la superficie RPC con la firma tipada COMPLETA (4 args), idéntico a 0075. register_birth
-- SÍ debe ser invocable por authenticated (camino de carga de partos del cliente). El call online de 3
-- args resuelve por el default null del 4to param. No se dropea/recrea la firma (CREATE OR REPLACE
-- preserva la firma de 0075): los GRANT/REVOKE de 0075 siguen vigentes. Se re-aplican explícitos por
-- defensa/idempotencia (no cambia nada si ya estaban).
revoke execute on function public.register_birth (uuid, date, jsonb, uuid) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
