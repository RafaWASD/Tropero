-- 0075_register_birth_idempotency.sql  (feature 15-powersync, Run 2 — delta de backend)
--
-- Delta ADITIVO de idempotencia para register_birth, aprobado en Puerta 1 (2026-06-08) y gateado
-- a nivel spec por Gate 1 (security_analyzer modo spec, DELTA PASS tras cerrar HIGH-D1). Único delta
-- de backend de la feature. Ver specs/active/15-powersync/{requirements R6.10/R11.3/R11.4, design §5.4.3(1)/§9-nota}.
--
-- POR QUÉ: la outbox de PowerSync es at-least-once (una RPC puede ejecutarse server-side y perderse
-- el ACK → PowerSync reintenta la misma CrudEntry de op_intents). register_birth crea el evento de
-- parto + N terneros con ids SERVER-SIDE (returning id into ...), así que NO hay id de cliente que
-- dedupee → un reintento crearía un SEGUNDO parto + N terneros. Por eso register_birth necesita una
-- clave de idempotencia explícita (p_client_op_id) — a diferencia de exit_animal_profile (idempotente
-- natural por transición de status), create_animal (ids de cliente) y los soft_delete_* (guarda
-- deleted_at IS NULL), que NO reciben delta.
--
-- ALCANCE (mínimo): 1 columna + 1 índice + 1 RPC. NO toca ninguna policy/RLS/trigger as-built (R11.3).
--   (1) columna nullable reproductive_events.client_op_id (los partos históricos quedan NULL).
--   (2) índice UNIQUE parcial COMPUESTO (animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL.
--       COMPUESTO, NO global: cierra el oráculo de existencia cross-tenant (fix HIGH-D1, design §9-nota).
--   (3) register_birth con p_client_op_id uuid default null + guard idempotente SCOPEADO al caller.
--
-- ⚠️ SEGURIDAD — fix HIGH-D1 (IDOR cross-tenant). El guard de idempotencia es un PATH DE LECTURA del
-- parto existente → NO se escribe como un lookup global por client_op_id ("SELECT id WHERE
-- client_op_id = p_client_op_id → RETURN"): eso sería VULNERABLE (un atacante con un client_op_id
-- colisionado por replay recibiría el id de un parto de OTRO establecimiento por el canal RPC). El
-- guard correcto: (a) has_role_in(v_est) sobre la fila REAL de la madre rige PRIMERO (as-built 0045);
-- (b) el lookup está scopeado al caller (misma madre p_mother_profile_id + mismo tenant v_est, vivo);
-- (c) si existe un parto con ese client_op_id pero apunta a otra madre/tenant (colisión ajena), NO se
-- devuelve nada: cae al camino de creación, el INSERT del client_op_id choca el índice compuesto y la
-- RPC levanta un error genérico (23505), NUNCA datos ajenos ni oráculo de existencia.
--
-- PATH ONLINE INTACTO: con p_client_op_id = default null el guard no entra → comportamiento IDÉNTICO al
-- as-built (0045). El índice es PARCIAL (WHERE client_op_id IS NOT NULL) → no impone unicidad sobre los
-- partos online históricos (todos NULL). NO aplicar al remoto desde acá: lo aplica el leader por
-- Management API tras gatear el SQL.

-- ---------------------------------------------------------------------------
-- (1) Columna de idempotencia (nullable; aditiva; no afecta partos históricos).
-- ---------------------------------------------------------------------------
alter table public.reproductive_events add column if not exists client_op_id uuid;

-- ---------------------------------------------------------------------------
-- (2) Índice UNIQUE parcial COMPUESTO (animal_profile_id, client_op_id).
--     - Idempotencia: un reintento del MISMO caller reusa su misma madre + el mismo client_op_id →
--       la tupla (animal_profile_id, client_op_id) colisiona consigo misma → el 2do INSERT choca →
--       no doble-parto (defensa-en-profundidad bajo el guard procedural).
--     - Anti-oráculo cross-tenant (fix HIGH-D1): el INSERT de un atacante usa SU propia
--       animal_profile_id (madre de su campo) → la unicidad por (madre, client_op_id) NUNCA colisiona
--       con la fila de otro tenant (madre distinta) → no hay unique_violation diferencial → desaparece
--       el oráculo de existencia binario del índice global. (reproductive_events NO tiene
--       establishment_id denormalizado — 0026 — así que animal_profile_id es el ancla de tenancy.)
-- ---------------------------------------------------------------------------
create unique index if not exists reproductive_events_client_op_id_uq
  on public.reproductive_events (animal_profile_id, client_op_id)
  where client_op_id is not null;

-- ---------------------------------------------------------------------------
-- (3) register_birth con guard idempotente scopeado.
--     Agregar un param con default a una función existente puede ambiguar la resolución de overloads
--     contra la firma vieja (uuid, date, jsonb). Para evitarlo: DROP de la firma vieja + CREATE de la
--     nueva (uuid, date, jsonb, uuid). Se hace en la MISMA migración (atómica): no queda hueco.
-- ---------------------------------------------------------------------------
drop function if exists public.register_birth (uuid, date, jsonb);

create function public.register_birth (
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
  --     (as-built 0045:213-225 — sin cambios; rige PRIMERO, antes de cualquier rama incl. el guard.)
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
  -- de la madre, NUNCA del payload) + fila en birth_calves. Cualquier fallo (incl. un ternero
  -- intermedio) propaga la excepción y revierte TODO (R9.4/R9.5). (as-built 0045 — sin cambios.)
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

  -- Compat as-built: calf_id apunta al primer ternero. (Update de calf_id NO dispara el trigger de
  -- recálculo de 0046, que escucha event_type/pregnancy_status/deleted_at.)
  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;

  return v_birth_event_id;
end; $$;

-- (SEC-SPEC-02) Cierre de la superficie RPC con la firma tipada COMPLETA NUEVA (4 args). register_birth
-- SÍ debe ser invocable por authenticated (es el camino de carga de partos del cliente). El call online
-- de 3 args resuelve por el default null del 4to param. La firma vieja (uuid, date, jsonb) se dropeó
-- arriba → no quedan grants colgando de ella.
revoke execute on function public.register_birth (uuid, date, jsonb, uuid) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
