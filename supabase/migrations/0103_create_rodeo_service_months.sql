-- 0103_create_rodeo_service_months.sql  (spec 02 — Stream A, RPS.3)
-- Camino de ESCRITURA de service_months, offline-first + RLS (owner-only, anti-IDOR por derivación).
--   (1) helper assert_service_months_valid(smallint[]) — validación server-side reusable (RPS.3.5).
--   (2) create_rodeo: +param p_service_months (default primavera si se omite) — RPS.3.1 (DD-PS-2).
--   (3) set_rodeo_service_months(p_rodeo_id, p_service_months) — RPC de edición offline (RPS.3.2-3.6).
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el leader por Management API tras Gate 1 (PASS) + reviewer +
-- Gate 2 + Puerta 2 + autorización de Raf. Depende de 0102 (la columna service_months). La suite
-- supabase/tests/puesta-en-servicio/run.cjs FALLA hasta el apply — ESPERADO (patrón 0075-0082 / 0093-0097).

begin;

-- ============================================================================
-- (1) Helper de validación reusable (RPS.3.5) — assert_service_months_valid
-- ============================================================================
-- Da un error accionable ANTES de persistir (el CHECK de columna rodeos_service_months_valid de 0102
-- también rechazaría, pero con un mensaje genérico). IMMUTABLE (no toca filas; solo valida el array de
-- entrada). NO se expone como RPC: revocado de public/anon/authenticated. Lo invocan las RPC SECURITY
-- DEFINER de abajo (corren como owner del schema → conservan EXECUTE pese al revoke; mismo patrón que
-- assert_data_keys_enabled 0054 / apply_auto_transition 0042). NULL = sin configurar = válido.
-- errcode 23514 (check_violation) por paridad con el CHECK de columna y con los caps INPUT-1 (0070).
create or replace function public.assert_service_months_valid (p_months smallint[])
returns void language plpgsql immutable
set search_path = public as $$
begin
  if p_months is null then
    return;  -- NULL = sin configurar, válido (RPS.1.2). '{}' (vacío) cae abajo y pasa todas las cláusulas.
  end if;
  -- (a) rango 1..12 (RPS.1.3)
  if exists (select 1 from unnest(p_months) as m where m < 1 or m > 12) then
    raise exception 'service_months out of range: every month must be between 1 and 12'
      using errcode = '23514';
  end if;
  -- (c) cardinalidad <= 12 (RPS.1.5) — cardinality() da 0 para '{}'.
  if cardinality(p_months) > 12 then
    raise exception 'service_months has too many elements (max 12)'
      using errcode = '23514';
  end if;
  -- (b) sin duplicados (RPS.1.4)
  if cardinality(p_months) <> (select count(distinct m)::int from unnest(p_months) as m) then
    raise exception 'service_months has duplicate months'
      using errcode = '23514';
  end if;
end; $$;

revoke execute on function public.assert_service_months_valid (smallint[]) from public, anon, authenticated;

comment on function public.assert_service_months_valid is
  'Validación server-side reusable de service_months (rango 1-12 / sin duplicados / <=12 elementos; NULL y '
  '{} válidos). errcode 23514. NO es RPC (revocado de public/anon/authenticated). La invocan create_rodeo y '
  'set_rodeo_service_months (SECURITY DEFINER, conservan EXECUTE como owner del schema). Espeja el CHECK de '
  'columna rodeos_service_months_valid (0102) dando un error accionable ANTES de persistir (RPS.3.5).';

-- ============================================================================
-- (2) Alta: create_rodeo + p_service_months (RPS.3.1, RPS.1.6, RPS.3.3, RPS.3.5)
-- ============================================================================
-- Cambio de FIRMA (agrega p_service_months) → DROP de la firma vieja (uuid,uuid,text,uuid,uuid,jsonb) +
-- CREATE de la nueva (DD-PS-2: el cliente del repo es el único caller y se actualiza en el mismo deploy →
-- DROP+CREATE limpia, sin overloads ambiguos en PostgREST). Conserva TODO el cuerpo de 0081 (owner-only
-- PRIMERO, validaciones de nombre/species/system, INSERT con id de cliente ON CONFLICT DO NOTHING +
-- idempotencia natural, guard anti-IDOR c-bis, UPSERT del diff de toggles). AGREGA: resolución de
-- service_months (default primavera si NULL) + validación server-side + persistir la columna en el INSERT.
drop function if exists public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb);

create or replace function public.create_rodeo (
  p_id               uuid,
  p_establishment_id uuid,
  p_name             text,
  p_species_id       uuid,
  p_system_id        uuid,
  p_toggles          jsonb default '[]'::jsonb,    -- [{ "field_definition_id": uuid, "enabled": bool }, ...]
  p_service_months   smallint[] default null       -- NUEVO. NULL/omitido → default primavera {10,11,12} (RPS.1.6).
) returns uuid                                       -- devuelve el id del rodeo (= p_id; o el existente en el replay)
language plpgsql security definer
set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_service_months smallint[];
  v_toggle jsonb;
  v_field_id uuid;
  v_enabled boolean;
begin
  -- (a) AUTHZ PRIMERO — crear rodeo es OWNER-ONLY (espeja rodeos_insert = is_owner_of, 0017). [SIN CAMBIO vs 0081]
  if not public.is_owner_of(p_establishment_id) then
    raise exception 'not authorized to create a rodeo in this establishment' using errcode = '42501';
  end if;

  -- (b) Validaciones mínimas accionables (el FK + el trigger rodeos_validate_species_system 0017 re-validan
  --     igual). [SIN CAMBIO vs 0081]
  if v_name = '' then
    raise exception 'rodeo name must not be empty' using errcode = '23514';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'rodeo name too long (max 120 chars)' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.species sp where sp.id = p_species_id and sp.active = true
  ) then
    raise exception 'species not found or inactive' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.systems_by_species s
    where s.id = p_system_id and s.species_id = p_species_id and s.active = true
  ) then
    raise exception 'invalid species/system combination or system inactive' using errcode = '23514';
  end if;

  -- (b-bis) NUEVO: resolver service_months. Omitido/NULL → default primavera {10,11,12} (RPS.1.6, reduce
  --     fricción del alta). Si viene, validar server-side (RPS.3.5) — el CHECK de columna re-valida igual,
  --     pero damos error claro acá. NOTA: el default se aplica SOLO en el alta de un rodeo NUEVO, nunca como
  --     backfill (DD-PS-3). Un caller que quiera "no hace servicio" pasa '{}' explícito (≠ NULL).
  v_service_months := coalesce(p_service_months, array[10,11,12]::smallint[]);
  perform public.assert_service_months_valid(v_service_months);

  -- (c) INSERT del rodeo con el id de CLIENTE + service_months. ON CONFLICT (id) DO NOTHING → idempotencia
  --     natural: un replay at-least-once (mismo p_id) NO crea un 2do rodeo y NO re-dispara el trigger de seed
  --     (tg_rodeos_seed_data_config, 0018). [+ service_months vs 0081]
  insert into public.rodeos (id, establishment_id, name, species_id, system_id, service_months)
  values (p_id, p_establishment_id, v_name, p_species_id, p_system_id, v_service_months)
  on conflict (id) do nothing;

  -- (c-bis) GUARD ANTI-IDOR (cross-tenant) [SIN CAMBIO vs 0081]: el rodeo con p_id debe PERTENECER a
  --     p_establishment_id (ya autorizado por is_owner_of). Si un atacante manda un p_id que colisiona con un
  --     rodeo de OTRO tenant, el INSERT es no-op pero el UPSERT de toggles escribiría sobre su config → 42501.
  if not exists (
    select 1 from public.rodeos r
    where r.id = p_id and r.establishment_id = p_establishment_id and r.deleted_at is null
  ) then
    raise exception 'rodeo id does not belong to this establishment' using errcode = '42501';
  end if;

  -- (d) Aplicar el DIFF de toggles del usuario (idempotente, UPSERT). [SIN CAMBIO vs 0081] El trigger 0078
  --     FUERZA establishment_id desde el rodeo (anti-spoof). El FK rechaza un field_definition_id inexistente.
  if p_toggles is not null and jsonb_typeof(p_toggles) = 'array' then
    for v_toggle in select * from jsonb_array_elements(p_toggles)
    loop
      v_field_id := nullif(v_toggle ->> 'field_definition_id', '')::uuid;
      v_enabled  := coalesce((v_toggle ->> 'enabled')::boolean, true);
      if v_field_id is null then
        raise exception 'toggle entry missing field_definition_id' using errcode = '22023';
      end if;
      insert into public.rodeo_data_config (rodeo_id, field_definition_id, enabled)
      values (p_id, v_field_id, v_enabled)
      on conflict (rodeo_id, field_definition_id) do update set enabled = excluded.enabled;
    end loop;
  end if;

  return p_id;
end; $$;

comment on function public.create_rodeo is
  'Crea un rodeo OFFLINE (drenado desde la outbox de PowerSync). SECURITY DEFINER con guard is_owner_of '
  '(owner-only, espeja rodeos_insert 0017). INSERT del rodeo con id de cliente ON CONFLICT DO NOTHING + '
  'UPSERT de los toggles → idempotente (replay at-least-once = no-op total). NUEVO (Stream A 0103): param '
  'p_service_months opcional → si se omite/NULL aplica el default de primavera {10,11,12} (RPS.1.6); valida '
  'server-side con assert_service_months_valid (RPS.3.5). El trigger 0018 seedea rodeo_data_config; el 0078 '
  'fuerza su establishment_id (anti-spoof). No necesita client_op_id (dedup natural por el id).';

-- Re-grant explícito sobre la firma NUEVA (7 args). anon/public revocados (es el camino de alta del cliente).
revoke execute on function public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb, smallint[]) from public, anon;
grant  execute on function public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb, smallint[]) to authenticated;

-- ============================================================================
-- (3) Edición offline: set_rodeo_service_months (RPS.3.2-RPS.3.6)
-- ============================================================================
-- Gemela de set_rodeo_config (0082) para EDITAR service_months OFFLINE (DD-PS-2). Anti-IDOR HERMÉTICO por
-- construcción: el establishment se DERIVA del rodeo (NO es parámetro), igual que set_rodeo_config → un
-- p_rodeo_id de otro tenant da is_owner_of(est ajeno)=false → 42501, sin tocar nada. Idempotente: un UPDATE
-- que setea service_months = p_service_months es naturalmente no-op al re-aplicar el mismo valor (replay
-- at-least-once de la outbox) → no necesita client_op_id (RPS.3.6).
create or replace function public.set_rodeo_service_months (
  p_rodeo_id       uuid,
  p_service_months smallint[]   -- nuevo conjunto: '{}' = no hace servicio; NULL = volver a "sin configurar"
) returns uuid                  -- devuelve el id del rodeo (= p_rodeo_id) por simetría con set_rodeo_config
language plpgsql security definer
set search_path = public as $$
declare v_est uuid;
begin
  -- (a) DERIVAR el establishment del rodeo (lo que hace la RPC anti-IDOR por construcción — ver header).
  --     Rodeo inexistente/soft-deleted → P0002 (el cliente lo clasifica como rechazo permanente: rollback
  --     del overlay optimista + descarte del intent — el rodeo a editar ya no existe). Mismo patrón que 0082.
  select establishment_id into v_est
  from public.rodeos
  where id = p_rodeo_id and deleted_at is null;
  if not found then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;

  -- (b) AUTHZ — owner-only (espeja rodeos_update = is_owner_of, 0017). v_est se DERIVÓ del rodeo, así que un
  --     owner solo pasa para rodeos de SUS campos; un p_rodeo_id ajeno → is_owner_of(est ajeno)=false → 42501
  --     (hermético por construcción). Un field_operator/vet o un usuario sin rol → 42501.
  if not public.is_owner_of(v_est) then
    raise exception 'not authorized to edit this rodeo service window' using errcode = '42501';
  end if;

  -- (c) Validación server-side (RPS.3.5) — NULL permitido (volver a "sin configurar"); si no-NULL, valida
  --     (el helper acepta '{}' → "no hace servicio"). El CHECK de columna (0102) re-valida (defensa en
  --     profundidad).
  perform public.assert_service_months_valid(p_service_months);

  -- (d) UPDATE idempotente (RPS.3.6): re-aplicar el mismo array deja el rodeo en el mismo estado (no-op).
  update public.rodeos set service_months = p_service_months where id = p_rodeo_id;

  return p_rodeo_id;
end; $$;

comment on function public.set_rodeo_service_months is
  'Edita service_months de un rodeo OFFLINE (drenado desde la outbox de PowerSync). SECURITY DEFINER con '
  'guard is_owner_of sobre el establishment DERIVADO del rodeo (owner-only, espeja rodeos_update 0017; '
  'anti-IDOR HERMÉTICO por construcción: el est no es parámetro → un p_rodeo_id ajeno da is_owner_of=false '
  '→ 42501). Valida con assert_service_months_valid (RPS.3.5). UPDATE idempotente (replay = no-op, RPS.3.6). '
  'Rodeo inexistente/soft-deleted → P0002. NULL = volver a sin configurar; {} = no hace servicio.';

revoke execute on function public.set_rodeo_service_months (uuid, smallint[]) from public, anon;
grant  execute on function public.set_rodeo_service_months (uuid, smallint[]) to authenticated;

-- ============================================================================
-- Smoke-check fail-closed de la superficie de EXECUTE (patrón 0066/0055/0097)
-- ============================================================================
-- (i) El helper assert_service_months_valid NO debe ser EXECUTE-able por NINGUNA rol cliente
--     (public/anon/authenticated). Si quedó expuesto → la migración FALLA.
-- (ii) create_rodeo (firma nueva) y set_rodeo_service_months NO deben ser EXECUTE-ables por anon/public
--     (sí por authenticated, que es el camino del cliente). Si anon/public las pueden ejecutar → FALLA.
do $$
declare v_bad record;
begin
  -- (i) helper interno: revocado de las 3 roles cliente.
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'assert_service_months_valid'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (Stream A): assert_service_months_valid is EXECUTE-able by % (must be internal-only)', v_bad.rolname;
  end loop;

  -- (ii) RPC de escritura: anon/public NUNCA.
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname in ('create_rodeo', 'set_rodeo_service_months')
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (Stream A): % is EXECUTE-able by % (must be revoked from anon/public)', v_bad.proname, v_bad.rolname;
  end loop;

  raise notice 'grant check OK (Stream A): assert_service_months_valid internal-only; create_rodeo/set_rodeo_service_months revoked from anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
