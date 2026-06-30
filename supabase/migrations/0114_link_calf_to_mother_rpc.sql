-- 0114_link_calf_to_mother_rpc.sql  (spec 02 — delta VINCULAR LA CRÍA AL PIE #15, Fase A / T1-T2)
--
-- RPC `link_calf_to_mother`: vincula un ternero EXISTENTE a una madre creando, en UNA transacción
-- server-side, un reproductive_events(event_type='birth') de la madre + una fila birth_calves que linkea
-- ese evento con el calf_profile_id EXISTENTE. Hoy NO hay forma de hacerlo: register_birth (0075) SOLO crea
-- terneros nuevos (no acepta un calf_profile_id existente). Reusa la columna reproductive_events.client_op_id
-- + el índice compuesto reproductive_events_client_op_id_uq (0075), birth_calves (0045) y sus triggers
-- (0031/0063 transición de la madre AFTER INSERT, 0067 nursing sobre birth_calves). NO crea tablas,
-- columnas, índices ni policies nuevas.
--
-- Molde as-built: register_birth (0075) / transfer_animal (0087) / assign_tag_to_animal (0089) — SECURITY
-- DEFINER + search_path fijo, derivación anti-IDOR de la FILA REAL (nunca del payload), authz sobre el
-- tenant DERIVADO, idempotencia scopeada al caller (sin oráculo cross-tenant, patrón 0075:106), revoke/grant
-- con firma tipada + smoke-check fail-closed + notify pgrst.
--
-- ORDEN DE OPERACIONES (NO conmutable — molde 0089/0075/0087; cierra los race y no abre oráculos
-- cross-tenant — Gate 1 PASS, folds foldeados):
--   (a) DERIVAR la madre de su FILA REAL → v_est (tenant) + v_mother_species (especie). deleted_at IS NULL.
--       NULL → 23503 (RCAP.6.2). El cliente NUNCA pasa establishment_id.
--   (b) AUTHZ has_role_in(v_est) sobre el tenant DERIVADO (cualquier rol activo; 42501, RCAP.6.3, anti-IDOR).
--   (b-bis) LOW-3 (Gate 1): cota de p_event_date (1900 ≤ year ≤ current+1) DESPUÉS del guard de tenant
--       (patrón 0105). Evita fechas de parto absurdas.
--   (c) GUARD ternero ≠ madre: p_calf_profile_id = p_mother_profile_id → 23514 (RCAP.6.5).
--   (d) DERIVAR el ternero scopeado al tenant de la madre (anti-oráculo) + FOR UPDATE (fold Gate 1 MED-1,
--       anti-TOCTOU): el row-lock de la fila del ternero se toma ANTES del guard de re-vínculo (f), así dos
--       link_calf_to_mother concurrentes del MISMO ternero se serializan (el 2do espera, ve el birth_calves
--       del 1ro y aborta con 23514 — cierra el check-then-insert, no hay unique sobre
--       birth_calves.calf_profile_id). Vacío → 23503 GENÉRICO (mismo error para "no existe" y "existe en
--       otro tenant" → sin oráculo cross-tenant, RCAP.6.4). + guard de especie (ternero = especie de la
--       madre → 23514, defensa-en-profundidad, criterio propio #4).
--   (e) IDEMPOTENCIA SCOPEADA (replay) — copia exacta del patrón 0075:106. Solo si p_client_op_id IS NOT
--       NULL; anclado en (madre, client_op_id, tenant) → sin lookup global → sin oráculo cross-tenant
--       (RCAP.6.7). Corre DESPUÉS de has_role_in.
--   (f) GUARD "ternero ya tiene madre" — DESPUÉS del replay (para no falsear un replay legítimo). El ternero
--       ya figura en birth_calves con un evento de parto no borrado → 23514 (RCAP.6.6).
--   (g) INSERT del evento de parto con client_op_id (defensa-en-profundidad por el índice compuesto
--       reproductive_events_client_op_id_uq, RCAP.6.8). Sin calf_sex → el trigger mono-ternero (0048
--       BEFORE) NO actúa, el AFTER link_birth_calf tampoco (calf_id NULL) → este RPC es el único poblador
--       de birth_calves para este parto. El AFTER apply_transition (0031/0063) recomputa la categoría de la
--       madre (un parto). El AFTER recompute_nursing (0061) corre con birth_calves aún vacío (false), pero
--       el INSERT de (h) dispara 0067 → nursing=true (mismo patrón que el camino mellizos de register_birth).
--   (h) INSERT de la fila puente con el calf_profile_id EXISTENTE → dispara 0067 (nursing de la madre →
--       true) y deja el linaje en la tabla puente (R7.9).
--
-- birth_calves (RCAP.6.10): se conserva intacta de 0045. NO se agrega policy INSERT para authenticated — la
-- tabla la puebla SOLO el DEFINER (esta RPC se suma a register_birth y al trigger mono-ternero como
-- poblador autorizado). El cliente no puede fabricar parentescos por PostgREST (invariante 0045:35).
--
-- 🔴 NO aplicar al remoto desde acá: lo aplica el LEADER por Supabase MCP / Management API tras gatear el SQL
-- (Gate 1 PASS + Gate 2 + reviewer + autorización de Raf). Hasta entonces la suite link_calf_to_mother FALLA
-- (función inexistente, PGRST202) — ESPERADO (patrón 0075-0089).

begin;

create or replace function public.link_calf_to_mother (
  p_mother_profile_id uuid,   -- perfil ACTIVO de la madre (lo conoce el cliente; el tenant se DERIVA de él)
  p_calf_profile_id   uuid,   -- perfil EXISTENTE del ternero a vincular (mismo tenant de la madre)
  p_event_date        date,   -- fecha del evento de parto (= birth_date del ternero ?? hoy, lo resuelve el cliente)
  p_client_op_id      uuid default null   -- clave de idempotencia (= op_intents.id; NULL en path online = sin guard)
) returns jsonb               -- { birth_event_id, replay }
language plpgsql security definer
set search_path = public as $$
declare
  v_est               uuid;
  v_mother_species_id uuid;
  v_calf_est          uuid;
  v_calf_species_id   uuid;
  v_existing_id       uuid;
  v_birth_event_id    uuid;
begin
  -- (a) DERIVAR la madre de su FILA REAL (anti-IDOR, RCAP.6.2). deleted_at IS NULL (paridad register_birth
  --     0075:98). El tenant + la especie se derivan acá, NUNCA del payload.
  select p.establishment_id, a.species_id
    into v_est, v_mother_species_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  where p.id = p_mother_profile_id and p.deleted_at is null;
  if v_est is null then
    raise exception 'mother animal_profile not found' using errcode = '23503';   -- RCAP.6.2
  end if;

  -- (b) AUTHZ (RCAP.6.3): cualquier rol activo en el establishment DERIVADO de la madre. NUNCA del payload.
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to link a calf for this mother' using errcode = '42501';   -- RCAP.6.3
  end if;

  -- (b-bis) LOW-3 (Gate 1): cota de p_event_date DESPUÉS del guard de tenant (patrón 0105 p_year). Un caller
  --     sin rol nunca llega acá (rebota en (b)) → la cota no es un oráculo. Una fecha NULL cae al NOT NULL de
  --     reproductive_events.event_date en (g) (23502) — no es trabajo de esta cota.
  if p_event_date is not null and (
       extract(year from p_event_date) < 1900
       or extract(year from p_event_date) > extract(year from current_date)::int + 1
     ) then
    raise exception 'p_event_date out of range (1900..current+1)' using errcode = '22023';   -- RCAP LOW-3
  end if;

  -- (c) GUARD ternero ≠ madre (RCAP.6.5): un animal no puede ser su propia cría.
  if p_calf_profile_id = p_mother_profile_id then
    raise exception 'a calf cannot be its own mother' using errcode = '23514';   -- RCAP.6.5
  end if;

  -- (d) DERIVAR el ternero SCOPEADO al tenant de la madre (anti-oráculo, RCAP.6.4) + FOR UPDATE (fold Gate 1
  --     MED-1, anti-TOCTOU). El row-lock de la fila del ternero se toma ACÁ, antes del guard de re-vínculo
  --     (f): dos links concurrentes del MISMO ternero se serializan → el 2do espera, ve el birth_calves del
  --     1ro en (f) y aborta con 23514 (no hay unique sobre birth_calves.calf_profile_id que lo cierre solo).
  --     Vacío (no existe O es de otro tenant) → 23503 GENÉRICO, sin revelar si existe en otro tenant.
  select p.establishment_id, a.species_id
    into v_calf_est, v_calf_species_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  where p.id = p_calf_profile_id
    and p.establishment_id = v_est       -- scopeado al tenant de la madre (anti-oráculo cross-tenant)
    and p.status = 'active'
    and p.deleted_at is null
  for update of p;                        -- MED-1: serializa links concurrentes del mismo ternero
  if v_calf_est is null then
    raise exception 'calf not found in this establishment' using errcode = '23503';   -- RCAP.6.4 (genérico)
  end if;
  -- Guard de especie (criterio propio #4 — defensa en profundidad): no se puede ligar un potrillo a una vaca.
  if v_calf_species_id is distinct from v_mother_species_id then
    raise exception 'calf species differs from mother species' using errcode = '23514';
  end if;

  -- (e) IDEMPOTENCIA SCOPEADA (replay, RCAP.6.7) — copia exacta del patrón 0075:106. Corre DESPUÉS de
  --     has_role_in; anclada en (madre, client_op_id, tenant) → sin lookup global por client_op_id → sin
  --     oráculo cross-tenant. Un parto con ese client_op_id que apunte a otra madre/tenant (colisión ajena)
  --     NO matchea acá → cae a la creación, donde el INSERT del client_op_id choca el índice compuesto
  --     (animal_profile_id, client_op_id) → 23505 genérico (sin filtrar datos ajenos).
  if p_client_op_id is not null then
    select re.id into v_existing_id
    from public.reproductive_events re
    join public.animal_profiles p on p.id = re.animal_profile_id
    where re.client_op_id      = p_client_op_id
      and re.animal_profile_id = p_mother_profile_id   -- misma madre que el intent
      and p.establishment_id   = v_est                 -- y del tenant ya autorizado (has_role_in pasado)
      and re.deleted_at is null
    limit 1;
    if v_existing_id is not null then
      return jsonb_build_object('birth_event_id', v_existing_id, 'replay', true);   -- no-op idempotente
    end if;
  end if;

  -- (f) GUARD "ternero ya tiene madre" (RCAP.6.6) — DESPUÉS del replay (para no falsear un replay legítimo).
  --     Un ternero tiene UNA sola madre biológica: si ya figura en birth_calves con un evento de parto no
  --     borrado, el re-link se rechaza. Bajo el FOR UPDATE de (d), un link concurrente del mismo ternero ve
  --     acá la fila del primero y aborta.
  if exists (
    select 1 from public.birth_calves bc
    join public.reproductive_events re on re.id = bc.birth_event_id
    where bc.calf_profile_id = p_calf_profile_id and re.deleted_at is null
  ) then
    raise exception 'calf already linked to a mother' using errcode = '23514';   -- RCAP.6.6
  end if;

  -- (g) INSERT del evento de parto con client_op_id (RCAP.6.8). SIN calf_sex → el trigger mono-ternero (0048
  --     BEFORE) no actúa y el AFTER link_birth_calf tampoco (calf_id NULL) → solo (h) puebla birth_calves.
  --     El AFTER apply_transition (0031/0063) recomputa la categoría de la madre (cuenta un parto).
  insert into public.reproductive_events (animal_profile_id, event_type, event_date, client_op_id)
  values (p_mother_profile_id, 'birth', p_event_date, p_client_op_id)
  returning id into v_birth_event_id;

  -- (h) INSERT de la fila puente con el calf_profile_id EXISTENTE → dispara 0067 (nursing de la madre →
  --     true). El cliente no tiene GRANT INSERT sobre birth_calves; esta fila la inserta el DEFINER.
  insert into public.birth_calves (birth_event_id, calf_profile_id)
  values (v_birth_event_id, p_calf_profile_id);

  return jsonb_build_object('birth_event_id', v_birth_event_id, 'replay', false);
end; $$;

comment on function public.link_calf_to_mother is
  'Vincula un ternero EXISTENTE a una madre (spec 02 delta #15). SECURITY DEFINER. En una transacción: '
  '(a) deriva el tenant de la fila real de la madre (anti-IDOR; 23503 si no existe); (b) has_role_in (42501); '
  '(b-bis) cota de p_event_date (1900..current+1); (c) ternero ≠ madre (23514); (d) deriva el ternero '
  'scopeado al tenant de la madre + FOR UPDATE (anti-TOCTOU, 23503 genérico sin oráculo) + guard de especie '
  '(23514); (e) replay idempotente scopeado a (madre, client_op_id, tenant) sin oráculo (0075:106); '
  '(f) "ya tiene madre" tras el replay (23514); (g) inserta reproductive_events(birth, client_op_id); '
  '(h) inserta birth_calves(calf existente) → 0067 nursing + 0031/0063 transición de categoría. Devuelve '
  '{ birth_event_id, replay }. birth_calves SIN GRANT INSERT al cliente (se puebla solo server-side).';

-- ===========================================================================
-- Cierre de la superficie RPC (RCAP.6.9): solo authenticated. revoke from public/anon + grant con firma
-- tipada (uuid, uuid, date, uuid) + smoke-check fail-closed (estilo 0087/0089) + notify. Función NUEVA → no
-- hay firma vieja que dropear ni grant colgando. NO se agrega policy INSERT a birth_calves (RCAP.6.10).
-- ===========================================================================
revoke execute on function public.link_calf_to_mother (uuid, uuid, date, uuid) from public, anon;
grant  execute on function public.link_calf_to_mother (uuid, uuid, date, uuid) to authenticated;

do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public' and p.proname = 'link_calf_to_mother'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: link_calf_to_mother is EXECUTE-able by %', v_bad.rolname;
  end loop;
end$$;

notify pgrst, 'reload schema';

commit;
