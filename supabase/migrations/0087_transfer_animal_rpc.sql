-- 0087_transfer_animal_rpc.sql  (spec 11 — transferencia-animal, Fase 1 / T1.1-T1.13)
--
-- RPC ATÓMICA `transfer_animal`: transfiere un animal activo del campo de ORIGEN X al campo DESTINO Y
-- PRESERVANDO su historia (decisión Gate 0, Raf sesión 18). En UNA transacción server-side:
--   (0) idempotencia por p_target_profile_id de cliente (replay por ACK perdido) — FIX Gate-1 HIGH-2;
--   (a) deriva el origen de la FILA REAL del perfil de origen (tenant + created_by + descriptivos);
--       authz ASIMÉTRICA (FIX Gate-1 HIGH-1): destino Y = rol activo (CREATE); origen X = baja a PARIDAD
--       EXACTA con exit_animal_profile (0044/SEC-SPEC-01): has_role_in(X) AND (is_owner_of(X) OR creador);
--   (b) valida rodeo destino activo, en Y, MISMO sistema que el origen (R1.6/R2.2);
--   (c) resuelve idv: conservar si libre en Y; si colisiona → NULL + idv_dropped;
--   (d) ARCHIVA el perfil viejo PRIMERO (status='transferred', exit_reason='transfer') → libera el unique
--       parcial animal_profiles_active_animal_unique antes de crear el nuevo (invariante R4.2);
--   (e) crea el perfil nuevo en Y reusando el animal_id global (triggers 0043/0079/0084/0085 fuerzan
--       created_by/identidad/is_castrated/future_bull-default);
--   (f) re-apunta TODA la historia (5 tablas tipadas + animal_events + animal_category_history +
--       birth_calves) seteando establishment_id → Y (aislamiento del wire de sync, RECON-1/R3.6) y
--       session_id → NULL en las tipadas (R3.8);
--   (g) re-apunta los vínculos calf_id/bull_id de eventos de OTROS animales (descendencia que queda en X)
--       SIN tocar su animal_profile_id/establishment_id (el evento sigue en X — linaje cruzado R3.4/R8.1).
--
-- Molde as-built: import_rodeo_bulk (0074) / create_animal (0083) — SECURITY DEFINER + search_path fijo,
-- authz derivada de la FILA REAL (nunca del payload, anti-IDOR/anti-cross-tenant), idempotencia por id de
-- cliente, revoke/grant con firma tipada + smoke-check fail-closed + notify pgrst.
--
-- DEPENDE de 0088 (delta del trigger tg_animal_events_enforce_edit_window): el re-apuntado de
-- animal_events (que cambia animal_profile_id + establishment_id, inmutables para clientes) pasa SOLO
-- porque este RPC setea la GUC local rafaq.is_transfer='on'. Sin 0088 aplicada, el re-apuntado de
-- animal_events FALLA con 'immutable column changed' y la transferencia aborta.
--
-- NO aplicar al remoto desde acá: lo aplica el leader/implementer por Management API (apply_migration)
-- tras gatear el SQL (Gate 1 PASS + Gate 2 + reviewer). Hasta entonces la suite transfer_animal RPC
-- FALLA (función inexistente, PGRST202) — ESPERADO (patrón 0075-0086).

begin;

create or replace function public.transfer_animal (
  p_source_profile_id       uuid,   -- perfil ACTIVO del animal en el campo de ORIGEN X (lo conoce el cliente)
  p_target_establishment_id uuid,   -- campo DESTINO Y (el establishment activo del cliente)
  p_target_rodeo_id         uuid,   -- rodeo destino en Y (mismo sistema; R1.5/R2.2)
  p_target_profile_id       uuid,   -- id del PERFIL NUEVO, generado por el CLIENTE → idempotencia (R6.2)
  p_target_category_id      uuid    -- categoría inicial en Y (cliente la resuelve por el system destino; D2)
) returns jsonb                     -- { target_profile_id, idv_dropped, source_profile_id, replay }
language plpgsql security definer
set search_path = public as $$
declare
  v_source_est        uuid;
  v_animal_id         uuid;
  v_source_created_by uuid;   -- HIGH-1: authz de baja owner-or-creator en X
  v_source_idv        text;
  v_source_visual_id  text;   -- R2.12.a: campos del animal que VIAJAN
  v_source_breed      text;
  v_source_coat       text;
  v_source_rodeo_id   uuid;
  v_source_rodeo_system uuid;
  v_target_rodeo_system uuid;
  v_idv_to_use        text;
  v_idv_dropped       boolean := false;
  v_now               timestamptz := now();
begin
  -- ===========================================================================
  -- (0) IDEMPOTENCIA PRIMERO (R6.1/R6.2 — FIX Gate-1 HIGH-2). El corte de replay va ANTES del select
  --     active-only del origen: tras la 1ª transferencia el origen queda 'transferred', así que un select
  --     active-only dispararía 23503 en el reintento por ACK perdido → devolvería error en vez del
  --     resultado ya aplicado. El corte por el p_target_profile_id de cliente (UUID estable entre
  --     reintentos) debe ir al inicio. Molde create_animal (0083, a-bis al comienzo). Sin efectos →
  --     seguro sin authz previa (el id lo generó el cliente; no se filtra nada). Si el perfil target ya
  --     existe en Y → la op ya corrió → no-op + return.
  -- ===========================================================================
  if exists (
    select 1 from public.animal_profiles
    where id = p_target_profile_id and establishment_id = p_target_establishment_id
  ) then
    return jsonb_build_object(
      'target_profile_id', p_target_profile_id, 'idv_dropped', false,
      'source_profile_id', p_source_profile_id, 'replay', true);
  end if;

  -- ===========================================================================
  -- (a) DERIVAR origen de la FILA REAL (incluye created_by para la authz de baja + los descriptivos que
  --     VIAJAN, R2.12.a) — ANTES de cualquier escritura. status='active' and deleted_at is null (R5.6).
  -- ===========================================================================
  select establishment_id, animal_id, created_by, idv, visual_id_alt, breed, coat_color, rodeo_id
    into v_source_est, v_animal_id, v_source_created_by, v_source_idv,
         v_source_visual_id, v_source_breed, v_source_coat, v_source_rodeo_id
  from public.animal_profiles
  where id = p_source_profile_id
    and status = 'active'
    and deleted_at is null;
  if v_source_est is null then
    raise exception 'source profile not found, not active, or already transferred'
      using errcode = '23503';   -- R5.6
  end if;

  -- AUTHZ ASIMÉTRICA (FIX Gate-1 HIGH-1). La transferencia ARCHIVA el perfil de X (status='transferred')
  -- = es una BAJA. Destino Y = cualquier rol activo (CREATE, como el alta). Origen X = baja a PARIDAD
  -- EXACTA con exit_animal_profile (0044 / SEC-SPEC-01): has_role_in(X) OBLIGATORIO ADEMÁS del
  -- owner-or-creator. Sin has_role_in(X), el path created_by=auth.uid() (que NO chequea rol activo)
  -- dejaría a un EX-creador revocado de X (active=false) con rol en Y sacar el animal de X = reabre
  -- SEC-SPEC-01. [TODO-D7 confirmado por Raf: owner-or-creator con rol activo en X.]
  if not public.has_role_in(p_target_establishment_id) then
    raise exception 'not authorized in target establishment (need active role in Y)'
      using errcode = '42501';   -- R5.3
  end if;
  if not (public.has_role_in(v_source_est)
          and (public.is_owner_of(v_source_est) or v_source_created_by = auth.uid())) then
    raise exception 'not authorized to remove the animal from the source field (need active role in X AND owner-or-creator)'
      using errcode = '42501';   -- R5.2
  end if;

  -- Guard: no transferir a sí mismo (origen == destino no tiene sentido y rompería el archivado).
  if v_source_est = p_target_establishment_id then
    raise exception 'source and target establishment are the same' using errcode = '23514';
  end if;

  -- ===========================================================================
  -- (b) MISMO SISTEMA (R1.6/R2.2): el rodeo destino debe existir, ser activo, del establishment Y, y
  --     tener el mismo system_id que el rodeo de origen.
  -- ===========================================================================
  select r.system_id into v_source_rodeo_system
  from public.rodeos r where r.id = v_source_rodeo_id;

  select r.system_id into v_target_rodeo_system
  from public.rodeos r
  where r.id = p_target_rodeo_id
    and r.establishment_id = p_target_establishment_id
    and r.active = true
    and r.deleted_at is null;
  if v_target_rodeo_system is null then
    raise exception 'target rodeo not found / inactive / not in target establishment'
      using errcode = '23514';
  end if;
  if v_target_rodeo_system is distinct from v_source_rodeo_system then
    raise exception 'target rodeo belongs to a different productive system (R4.5.1)'
      using errcode = '23514';   -- R1.6
  end if;

  -- ===========================================================================
  -- (c) RESOLVER idv: conservar si no colisiona en Y; si colisiona → NULL + flag (R2.4/R2.5). El unique
  --     parcial es (establishment_id, idv) where idv is not null and deleted_at is null (0020).
  -- ===========================================================================
  v_idv_to_use := nullif(trim(coalesce(v_source_idv, '')), '');
  if v_idv_to_use is not null and exists (
    select 1 from public.animal_profiles ap
    where ap.establishment_id = p_target_establishment_id
      and ap.idv = v_idv_to_use
      and ap.deleted_at is null
  ) then
    v_idv_to_use := null;
    v_idv_dropped := true;
  end if;

  -- ===========================================================================
  -- (d) ARCHIVAR EL PERFIL VIEJO PRIMERO (libera el unique parcial de "perfil activo por animal", R4.2).
  --     status='transferred' + exit_reason='transfer' + exit_date. NO soft-delete (deleted_at queda NULL
  --     → rastro en X, R4.1). Hacerlo ANTES de crear el nuevo evita el choque con
  --     animal_profiles_active_animal_unique (dos activos).
  -- ===========================================================================
  update public.animal_profiles
     set status = 'transferred',
         exit_reason = 'transfer'::public.exit_reason_enum,
         exit_date = v_now::date
   where id = p_source_profile_id;

  -- ===========================================================================
  -- (e) CREAR EL PERFIL NUEVO EN Y con el id de CLIENTE (idempotencia). status='active'.
  --     created_by lo FUERZA 0043 (auth.uid()); identidad animal_* la FUERZA 0079; is_castrated lo FUERZA
  --     0084 (copia de animals → preserva, R2.7); future_bull arranca false por default de columna (0085,
  --     R2.8). management_group_id = NULL (R2.3). category_override = false (R2.9 / D2).
  --     Campos descriptivos (R2.12 / §4.7): VIAJAN los del animal (visual_id_alt/breed/coat_color, leídos
  --     del viejo en (a)); SE RESETEAN los de la relación con el campo (entry_date=hoy, entry_origin=NULL,
  --     entry_weight=NULL, notes=NULL — la "entrada" a Y es la transferencia).
  --     NO se setea created_by/animal_*/is_castrated/future_bull (los fuerzan/defaultean los triggers).
  -- ===========================================================================
  insert into public.animal_profiles (
    id, animal_id, establishment_id, rodeo_id, category_id, category_override, status,
    idv, management_group_id,
    visual_id_alt, breed, coat_color,
    entry_date, entry_origin, entry_weight, notes
  ) values (
    p_target_profile_id, v_animal_id, p_target_establishment_id, p_target_rodeo_id, p_target_category_id,
    false, 'active', v_idv_to_use, null,
    v_source_visual_id, v_source_breed, v_source_coat,
    v_now::date, null, null, null
  );

  -- ===========================================================================
  -- (f) RE-APUNTAR LA HISTORIA del perfil viejo → nuevo, con establishment_id=Y + session_id=NULL (R3.x).
  --     Las 5 tablas tipadas: animal_profile_id, establishment_id (denorm 0077) y session_id en un único
  --     UPDATE por tabla. El force de 0077 (BEFORE INSERT OR UPDATE) re-deriva establishment_id desde
  --     animal_profiles del NEW.animal_profile_id (= el nuevo perfil, ya en Y) → converge con el valor
  --     explícito; el perfil nuevo (e) ya existe antes de (f), requisito del force.
  -- ===========================================================================
  update public.weight_events
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
   where animal_profile_id = p_source_profile_id;
  update public.reproductive_events
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
   where animal_profile_id = p_source_profile_id;
  update public.sanitary_events
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
   where animal_profile_id = p_source_profile_id;
  update public.condition_score_events
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
   where animal_profile_id = p_source_profile_id;
  update public.lab_samples
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
   where animal_profile_id = p_source_profile_id;

  -- animal_events (observaciones): establishment_id PROPIO (0034), sin session_id. El trigger
  -- tg_animal_events_enforce_edit_window (0034) declara animal_profile_id/establishment_id INMUTABLES en
  -- UPDATE → bloquearía esto. La GUC local rafaq.is_transfer='on' (delta 0088) habilita el early-return
  -- SOLO dentro de este DEFINER; un cliente directo a PostgREST NO puede setearla → sigue bloqueado.
  perform set_config('rafaq.is_transfer', 'on', true);
  update public.animal_events
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id
   where animal_profile_id = p_source_profile_id;
  perform set_config('rafaq.is_transfer', 'off', true);

  -- animal_category_history: animal_profile_id + establishment_id denorm (0077).
  update public.animal_category_history
     set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id
   where animal_profile_id = p_source_profile_id;

  -- birth_calves del animal transferido como TERNERO (su calf_profile_id apuntaba al perfil viejo):
  -- re-apuntar calf_profile_id. El establishment_id de esta fila deriva de la MADRE (cadena
  -- parto→madre); su force es solo-INSERT (0078) → este UPDATE NO lo toca. Si la madre quedó en X, la
  -- fila conserva el establishment de la madre (X) = correcto (DEC-A2: es dato del parto de la madre; el
  -- ternero en Y la referencia vía su animal_id global — linaje cruzado R8.1).
  update public.birth_calves
     set calf_profile_id = p_target_profile_id
   where calf_profile_id = p_source_profile_id;

  -- birth_calves de partos DONDE EL ANIMAL ES LA MADRE (el evento de parto se re-apuntó a Y en (f)):
  -- seguir el establishment a Y (DEC-A3). El force de birth_calves es solo-INSERT → este UPDATE explícito
  -- es la ÚNICA vía de mantener fiel su establishment_id tras re-parentear el parto de la madre. Los
  -- terneros mismos (sus perfiles) QUEDAN en X (linaje cruzado) — acá se mueve el establishment de la
  -- fila PUENTE (que sigue a la madre), no el perfil del ternero.
  update public.birth_calves bc
     set establishment_id = p_target_establishment_id
   where bc.birth_event_id in (
     select id from public.reproductive_events
     where animal_profile_id = p_target_profile_id and event_type = 'birth'
   );

  -- ===========================================================================
  -- (g) VÍNCULOS REPRODUCTIVOS de OTROS animales que referencian al transferido como madre/toro (R3.4):
  --     estos eventos NO son del perfil viejo (son de su descendencia, que queda en X) → solo se re-apunta
  --     el PUNTERO calf_id/bull_id, NO el animal_profile_id ni el establishment_id del evento (el evento
  --     sigue en X — linaje cruzado R8.1). El re-apuntado del bull_id/calf_id de los PROPIOS eventos del
  --     animal (los que ya se movieron a Y en (f)) es benigno: ya apuntan al perfil viejo si el animal era
  --     su propia madre/toro (no ocurre), y el WHERE bull_id/calf_id = source los cubre igual.
  -- ===========================================================================
  update public.reproductive_events set bull_id = p_target_profile_id where bull_id = p_source_profile_id;
  update public.reproductive_events set calf_id = p_target_profile_id where calf_id = p_source_profile_id;

  return jsonb_build_object(
    'target_profile_id', p_target_profile_id, 'idv_dropped', v_idv_dropped,
    'source_profile_id', p_source_profile_id, 'replay', false);
end; $$;

comment on function public.transfer_animal is
  'Transferencia ATÓMICA de un animal de un campo X a otro Y PRESERVANDO su historia (spec 11, Gate 0). '
  'SECURITY DEFINER. (0) idempotencia por p_target_profile_id de cliente; (a) deriva origen de la fila '
  'real + authz asimétrica: destino Y = rol activo (CREATE), origen X = baja a paridad EXACTA con '
  'exit_animal_profile (0044): has_role_in(X) AND (is_owner_of(X) OR created_by=auth.uid()); '
  '(b) rodeo destino mismo sistema; (c) idv conservar-o-NULL; (d) archiva el viejo (transferred) ANTES '
  'de (e) crear el nuevo en Y; (f) re-apunta historia con establishment_id→Y + session_id→NULL (aísla el '
  'wire de sync, RECON-1) — animal_events vía GUC rafaq.is_transfer (0088); (g) re-apunta vínculos '
  'calf_id/bull_id de la descendencia que queda en X sin mover sus eventos. created_by/identidad/'
  'is_castrated los fuerzan 0043/0079/0084; future_bull arranca false (0085).';

-- ===========================================================================
-- Cierre de la superficie RPC (R5.5): solo authenticated. revoke from public/anon + smoke-check
-- fail-closed (estilo 0074) + notify. Firma tipada completa (5 uuids).
-- ===========================================================================
revoke execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) from public, anon;
grant  execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) to authenticated;

do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public' and p.proname = 'transfer_animal'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: transfer_animal is EXECUTE-able by %', v_bad.rolname;
  end loop;
end$$;

notify pgrst, 'reload schema';

commit;
