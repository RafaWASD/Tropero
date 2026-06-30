-- 0115_register_birth_calf_rodeo.sql  (spec 02 — delta VINCULAR LA CRÍA AL PIE #15, Fase B / T3-T4)
--
-- 🔴🔴 SUPERSEDED POR 0116 — NO ES EL DISEÑO CORRECTO DE register_birth. Esta migración se moldeó por error
-- sobre 0075 (firma 4-arg, PRE-0109) y su DROP+CREATE BORRÓ la herencia de animal_profiles.breed_id de la
-- madre al ternero que 0109 había agregado (SIGSA R1.7) → terneros con breed_id NULL (regresión de dato
-- regulado, cazada por el Gate 2). 0116 (CREATE OR REPLACE de la 6-arg) la corrige re-incorporando el breed_id
-- del cuerpo de 0109. Se conserva 0115 como registro histórico de lo aplicado; el register_birth VIGENTE es el
-- de 0116. NO copiar este cuerpo (le falta breed_id).
--
--
-- Extiende register_birth (0075) con el RODEO del ternero editable, para el camino CREATE del prompt de cría
-- al pie (RCAP.7). Hoy register_birth crea los terneros SIEMPRE en el rodeo de la madre; el prompt necesita
-- poder colocar al ternero nuevo en un rodeo EDITABLE del mismo campo (decisión cerrada #1 del contexto). Se
-- agregan TRES params opcionales (default NULL → comportamiento as-built IDÉNTICO; todos los callers
-- existentes —parto normal/mellizos— quedan INALTERADOS):
--   - p_calf_rodeo_id uuid : rodeo efectivo del ternero. NULL → rodeo de la madre (RCAP.7.2). Provisto →
--       validar activo + del tenant de la MADRE + mismo sistema productivo (else 23514), patrón
--       transfer_animal 0087:115 (RCAP.7.3/7.4). La categoría se resuelve con el system de la madre (= el del
--       rodeo elegido, garantizado por la validación) → categories_by_system válida.
--   - p_calf_idv text      : fold Gate 1 LOW-1 — la caravana VISUAL/IDV que el operario tipeó (y no se
--       encontró) fluye al ternero creado. NULL → as-built (sin idv). Respeta la unicidad parcial
--       (establishment_id, idv) de 0020 (dup → 23505) y la inmutabilidad de 0036 (no aplica: es un INSERT).
--   - (LOW-2 cap del tag): check char_length(calf_tag_electronic) ≤ 15 autoritativo dentro del loop (el EID
--       FDX-B es 15 díg → cap exacto). LOW-3 cota de p_event_date (1900..current+1) tras has_role_in.
--
-- DROP de la firma vieja (uuid,date,jsonb,uuid) + CREATE de la nueva (uuid,date,jsonb,uuid,uuid,text) en la
-- MISMA migración, dentro de begin/commit → atómico (patrón 0075:62, evita ambigüedad de overloads). El resto
-- del flujo de 0075 (herencia de tenant de la fila real de la madre, atomicidad R9.4/R9.5, idempotencia por
-- p_client_op_id con el fix HIGH-D1) queda INTACTO.
--
-- 🔴 NO aplicar al remoto desde acá: lo aplica el LEADER por Supabase MCP / Management API tras gatear el SQL
-- (Gate 1 PASS + Gate 2 + reviewer + autorización de Raf). Hasta entonces la suite de register_birth con
-- rodeo FALLA (la nueva firma no existe → PGRST202) — ESPERADO (patrón 0075-0089).

begin;

-- DROP de la firma vieja (4 args) + CREATE de la nueva (6 args) en la misma transacción (atómico, 0075:62).
drop function if exists public.register_birth (uuid, date, jsonb, uuid);

create function public.register_birth (
  p_mother_profile_id uuid,
  p_event_date        date,
  p_calves            jsonb,   -- [{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text? }, ...]
  p_client_op_id      uuid default null,   -- clave de idempotencia (NULL en el path online = idéntico al as-built)
  p_calf_rodeo_id     uuid default null,   -- rodeo efectivo del ternero (NULL → rodeo de la madre, RCAP.7.2)
  p_calf_idv          text default null    -- LOW-1: IDV tipado del ternero (NULL → as-built; camino cría al pie CREATE)
) returns uuid                -- devuelve el reproductive_events.id del parto creado (o del existente, en el no-op del propio caller)
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid;
  v_species_id uuid;
  v_rodeo_id uuid;
  v_system_id uuid;
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
  -- (a) AUTORIZACIÓN derivada de la FILA REAL de la madre, NUNCA de un parámetro del cliente.
  --     (as-built 0075 — sin cambios; rige PRIMERO, antes de cualquier rama incl. el guard.)
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

  -- (a-bis) GUARD DE IDEMPOTENCIA — SCOPEADO AL CALLER (fix HIGH-D1, as-built 0075). Corre DESPUÉS de
  -- has_role_in. Path de LECTURA del parto existente, anclado a (p_mother_profile_id, v_est) → sin oráculo
  -- de existencia cross-tenant. Un client_op_id colisionado de otra madre/tenant cae a la creación, donde el
  -- INSERT del client_op_id choca el índice compuesto → 23505 genérico.
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
      return v_existing_id;        -- no-op idempotente LEGÍTIMO
    end if;
  end if;

  -- (a-ter) LOW-3 (Gate 1): cota de p_event_date DESPUÉS del guard de tenant (patrón 0105). Evita fechas de
  -- parto absurdas que se propagarían a animals.birth_date / animal_profiles.entry_date de los terneros.
  if p_event_date is not null and (
       extract(year from p_event_date) < 1900
       or extract(year from p_event_date) > extract(year from current_date)::int + 1
     ) then
    raise exception 'p_event_date out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- Validación del payload: al menos un ternero, todos con calf_sex válido. (as-built 0075)
  if p_calves is null or jsonb_typeof(p_calves) <> 'array' then
    raise exception 'p_calves must be a json array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_calves);
  if v_count < 1 then
    raise exception 'p_calves must contain at least one calf' using errcode = '22023';
  end if;

  -- (a-quater) RESOLVER el RODEO EFECTIVO del ternero (RCAP.7). NULL → rodeo de la madre (as-built, RCAP.7.2).
  -- Provisto → validar activo + del tenant DERIVADO de la madre + mismo sistema productivo (patrón
  -- transfer_animal 0087:115; anti-IDOR + consistencia de categoría). La categoría se resuelve con v_system_id
  -- (= el system del rodeo elegido, garantizado por la validación) → categories_by_system del ternero válida.
  if p_calf_rodeo_id is null then
    v_calf_rodeo_id := v_rodeo_id;                       -- RCAP.7.2 (comportamiento as-built)
  else
    select r.system_id into v_calf_rodeo_system
    from public.rodeos r
    where r.id = p_calf_rodeo_id
      and r.establishment_id = v_est                     -- tenant DERIVADO de la madre (anti-IDOR)
      and r.active = true
      and r.deleted_at is null;
    if v_calf_rodeo_system is null then
      raise exception 'calf rodeo not found / inactive / other tenant' using errcode = '23514';   -- RCAP.7.3
    end if;
    if v_calf_rodeo_system is distinct from v_system_id then
      raise exception 'calf rodeo belongs to a different productive system' using errcode = '23514';   -- RCAP.7.3
    end if;
    v_calf_rodeo_id := p_calf_rodeo_id;                  -- RCAP.7.4
  end if;

  -- LOW-1: IDV tipado del ternero (camino cría al pie CREATE). Trim/nullif. Aplica a CADA ternero del loop;
  -- el flujo cría al pie es de UN solo ternero (RCAP.4.3). El parto normal/mellizos pasa NULL → as-built.
  v_calf_idv := nullif(trim(coalesce(p_calf_idv, '')), '');

  -- (b) Insertar el evento de parto SIN campos calf_* (calf_sex NULL) para que el trigger mono-ternero NO
  -- actúe — los terneros los crea este RPC. Persiste client_op_id (NULL online = mismo INSERT que el as-built).
  insert into public.reproductive_events (animal_profile_id, event_type, event_date, client_op_id)
  values (p_mother_profile_id, 'birth', p_event_date, p_client_op_id)
  returning id into v_birth_event_id;

  -- (c) Iterar los terneros: crear animal + animal_profile (herencia de tenant = v_est de la fila real de la
  -- madre, NUNCA del payload; rodeo = v_calf_rodeo_id; idv = v_calf_idv) + fila en birth_calves. Cualquier
  -- fallo (incl. un ternero intermedio) propaga la excepción y revierte TODO (R9.4/R9.5). (as-built 0075.)
  for v_calf in select * from jsonb_array_elements(p_calves)
  loop
    v_calf_sex := v_calf ->> 'calf_sex';
    if v_calf_sex is null or v_calf_sex not in ('male', 'female') then
      raise exception 'each calf needs calf_sex in (male, female)' using errcode = '23514';
    end if;
    v_calf_weight := nullif(v_calf ->> 'calf_weight', '')::numeric;
    v_calf_tag := nullif(trim(coalesce(v_calf ->> 'calf_tag_electronic', '')), '');
    -- LOW-2 (Gate 1): cap autoritativo del tag del ternero (EID FDX-B = 15 díg → cap exacto). Defensa en
    -- profundidad sobre el techo de 64 de 0070 (oportunidad barata pre-existente).
    if v_calf_tag is not null and char_length(v_calf_tag) > 15 then
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
      birth_weight, entry_date, entry_origin, status
    ) values (
      v_calf_animal_id,
      v_est,                 -- herencia de tenant del server, NO del payload
      v_calf_rodeo_id,       -- rodeo efectivo (madre o el elegido, RCAP.7.4)
      v_calf_idv,            -- LOW-1: IDV tipado (NULL → as-built)
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

  -- Compat as-built: calf_id apunta al primer ternero. (Update de calf_id NO dispara el trigger de recálculo
  -- de 0046, que escucha event_type/pregnancy_status/deleted_at.)
  update public.reproductive_events set calf_id = v_first_calf_id where id = v_birth_event_id;

  return v_birth_event_id;
end; $$;

-- (RCAP.7.5) Cierre de la superficie RPC con la firma tipada COMPLETA NUEVA (6 args). register_birth SÍ debe
-- ser invocable por authenticated (es el camino de carga de partos del cliente). Los calls de 3/4/5 args
-- resuelven por los defaults null de los params nuevos → callers existentes INALTERADOS. La firma vieja
-- (uuid,date,jsonb,uuid) se dropeó arriba → no quedan grants colgando de ella.
revoke execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
