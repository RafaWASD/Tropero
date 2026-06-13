-- 0089_assign_tag_to_animal_rpc.sql  (spec 09 — chunk "09 resto · dedup A/B", Fase 1 / F1.1-F1.2)
--
-- RPC `assign_tag_to_animal`: asigna la caravana electrónica (EID 15 díg FDX-B) al animal GLOBAL de un
-- perfil ACTIVO que todavía no la tenía (NULL→valor). Cierra los "duplicados lógicos" de BUSCAR ANIMAL:
-- el animal cargado con solo visual/IDV al que recién en la manga se le pone la caravana. Es la ÚNICA vía
-- (online u offline) de mutar `animals.tag_electronic`: `animals` está FUERA del sync set (ADR-026 b1) —
-- la tabla NI EXISTE en el SQLite local → no hay UPDATE local posible (a diferencia de
-- setCastrated/setFutureBull, que escriben `animal_profiles`, sí sincronizada). El efecto "vuelve" a la UI
-- por `animal_profiles.animal_tag_electronic` cuando la stream sincroniza la propagación del trigger 0079.
--
-- Molde as-built: transfer_animal (0087) / register_birth (0075) / create_animal (0083) — SECURITY DEFINER
-- + search_path fijo, derivación anti-IDOR de la FILA REAL (nunca del payload), authz sobre el tenant
-- DERIVADO, idempotencia por estado ya aplicado (sin oráculo cross-tenant), revoke/grant con firma tipada
-- + smoke-check fail-closed + notify pgrst.
--
-- ORDEN DE OPERACIONES (NO conmutable; cierra los race y no abre oráculos cross-tenant — Gate 1 PASS):
--   (a) DERIVAR v_est + v_animal_id de la fila real del perfil ACTIVO (anti-IDOR, RD1.2; NULL → 23503).
--   (b) AUTHZ has_role_in(v_est) sobre el tenant DERIVADO (cualquier rol activo, D-d/RD1.3; 42501).
--   (c) VALIDACIÓN de formato server-side ^\d{15}$ (defensa en profundidad, RD1.4; 23514).
--   (d) IDEMPOTENCIA STATE-BASED (DA-1 RATIFICADA por Gate 1, RD1.6): si el animal derivado YA tiene
--       exactamente este TAG → la op ya corrió (reintento por ACK perdido) → no-op + replay:true. Scopeado
--       a v_animal_id (tenant ya autorizado) → sin lookup global por client_op_id → sin oráculo cross-tenant.
--       p_client_op_id es PASSTHROUGH del contrato del intent (NO ancla la dedup; NO se cuelga de ninguna
--       columna/índice nuevo — sin animals.last_assign_op_id ni tabla de audit, lo prohíbe RD1.6).
--   (e) UPDATE con guard `AND tag_electronic IS NULL` (NULL→valor; el trigger 0036 ya lo permite y bloquea
--       valor→valor — el guard es defensa-en-profundidad EXPLÍCITA + detector de race, RD1.5).
--   (f) RACE: 0 filas = el animal ya tenía caravana (otro device la puso entre (d) y (e)) → 23514 accionable
--       DISTINGUIBLE del dup global (RD1.5).
--   Unicidad global (RD1.7): si el TAG ya está en OTRO animal, el UPDATE viola el índice parcial
--   animals_tag_unique (0019) → 23505 PROPAGADO sin capturar → permanent_reject en sync.
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER por Management API (apply_migration) tras gatear el
-- SQL (Gate 1 PASS + Gate 2 + reviewer + autorización de Raf en sesión). Hasta entonces la suite
-- assign_tag_to_animal FALLA (función inexistente, PGRST202) — ESPERADO (patrón 0075-0088).

begin;

create or replace function public.assign_tag_to_animal (
  p_profile_id     uuid,   -- perfil ACTIVO del animal al que se le asigna la caravana (lo conoce el cliente)
  p_tag_electronic text,   -- EID de 15 díg FDX-B bastoneado
  p_client_op_id   uuid    -- clave de idempotencia del cliente (= op_intents.id). PASSTHROUGH: NO ancla la
                           -- dedup (state-based, RD1.6) — se recibe por compat del intent/mapeo (MED-2 Gate 1).
) returns jsonb            -- { animal_id, profile_id, tag_electronic, replay }
language plpgsql security definer
set search_path = public as $$
declare
  v_est       uuid;
  v_animal_id uuid;
begin
  -- (a) DERIVAR de la FILA REAL del perfil (anti-IDOR, RD1.2). status='active' AND deleted_at IS NULL.
  --     El cliente solo pasa p_profile_id; el animal_id + el tenant se derivan acá, NUNCA del payload.
  select establishment_id, animal_id
    into v_est, v_animal_id
  from public.animal_profiles
  where id = p_profile_id
    and status = 'active'
    and deleted_at is null;
  if v_est is null then
    raise exception 'profile not found, not active, or deleted' using errcode = '23503';   -- RD1.2
  end if;

  -- (b) AUTHZ (RD1.3 / D-d): cualquier rol activo en el establishment DERIVADO. NUNCA del payload. Un
  --     p_profile_id de OTRO campo: la fila se encuentra (la query no filtra por tenant del caller, igual
  --     que el molde 0087/0075), pero acá rebota 42501 → no toca el animal ajeno (Gate 1 punto 1).
  if not public.has_role_in(v_est) then
    raise exception 'not authorized in this establishment (need active role)' using errcode = '42501';  -- RD1.3
  end if;

  -- (c) VALIDACIÓN DE FORMATO server-side (RD1.4): exactamente 15 díg (espeja isValidTag de spec 04). El
  --     cliente ya valida en la ingesta del bastón; el RPC re-valida como defensa en profundidad.
  if p_tag_electronic is null or p_tag_electronic !~ '^\d{15}$' then
    raise exception 'tag_electronic must be exactly 15 digits (FDX-B)' using errcode = '23514';  -- RD1.4
  end if;

  -- (d) IDEMPOTENCIA STATE-BASED (RD1.6 / DA-1). Corre DESPUÉS de derivar+authz (anclada a v_animal_id del
  --     tenant ya autorizado) → un caller de otro campo nunca llega acá (rebota en (b)) → sin oráculo
  --     cross-tenant (Gate 1 punto 4). Si el animal derivado YA tiene exactamente este TAG, la op ya corrió
  --     (reintento por ACK perdido) → no-op + replay:true. NO se confunde con el dup global de OTRO animal:
  --     eso es unicidad de OTRA fila → lo tira el índice en (e), 23505. (DA-1 condición de Gate 1.)
  if exists (
    select 1 from public.animals
    where id = v_animal_id and tag_electronic = p_tag_electronic
  ) then
    return jsonb_build_object('animal_id', v_animal_id, 'profile_id', p_profile_id,
                              'tag_electronic', p_tag_electronic, 'replay', true);
  end if;

  -- (e) UPDATE con GUARD NULL→valor (RD1.5 / R12.2). El trigger 0036 ya permite NULL→valor y bloquea
  --     valor→valor; el `AND tag_electronic IS NULL` es defensa-en-profundidad EXPLÍCITA + detector de race.
  --     El UPDATE usa SOLO v_animal_id DERIVADO (anti-IDOR), nunca un id del payload.
  update public.animals
     set tag_electronic = p_tag_electronic
   where id = v_animal_id and tag_electronic is null;

  -- (f) RACE (RD1.5): 0 filas = el animal ya tenía caravana (otro device la puso entre (d) y (e)). Error
  --     accionable DISTINGUIBLE del dup global (23505), para que el cliente surfacee "ese animal ya tiene
  --     caravana — refrescá la lista".
  if not found then
    raise exception 'animal already has a tag (race)' using errcode = '23514';  -- RD1.5
  end if;

  return jsonb_build_object('animal_id', v_animal_id, 'profile_id', p_profile_id,
                            'tag_electronic', p_tag_electronic, 'replay', false);
  -- Unicidad global (RD1.7): si p_tag_electronic ya está en OTRO animal, el UPDATE de (e) viola el índice
  -- parcial animals_tag_unique (0019) → 23505 PROPAGADO al cliente (sin capturar) → permanent_reject en sync.
end; $$;

comment on function public.assign_tag_to_animal is
  'Asigna la caravana electrónica (EID 15 díg) al animal global de un perfil ACTIVO sin caravana (NULL→valor) '
  '— spec 09 dedup A/B. SECURITY DEFINER. ÚNICA vía de mutar animals.tag_electronic (animals fuera del sync '
  'set, ADR-026 b1; el efecto baja por animal_profiles.animal_tag_electronic vía la propagación del trigger '
  '0079). (a) deriva animal_id+establishment_id de la fila real del perfil (anti-IDOR); (b) has_role_in sobre '
  'el tenant derivado (cualquier rol activo, D-d); (c) valida formato ^\d{15}$ server-side; (d) idempotencia '
  'state-based (animal ya con ese TAG → replay:true, scopeada al tenant autorizado, sin oráculo cross-tenant; '
  'p_client_op_id es passthrough, NO ancla la dedup); (e) UPDATE con guard AND tag_electronic IS NULL; '
  '(f) 0 filas = race → 23514. Unicidad global (TAG en otro animal) → 23505 del índice animals_tag_unique '
  '(0019), propagado.';

-- ===========================================================================
-- Cierre de la superficie RPC (RD1.8): solo authenticated. revoke from public/anon + grant con firma tipada
-- (uuid, text, uuid) + smoke-check fail-closed (estilo 0087) + notify. Función NUEVA → no hay firma vieja
-- que dropear ni grant colgando (Gate 1 punto 6).
-- ===========================================================================
revoke execute on function public.assign_tag_to_animal (uuid, text, uuid) from public, anon;
grant  execute on function public.assign_tag_to_animal (uuid, text, uuid) to authenticated;

do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public' and p.proname = 'assign_tag_to_animal'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: assign_tag_to_animal is EXECUTE-able by %', v_bad.rolname;
  end loop;
end$$;

notify pgrst, 'reload schema';

commit;
