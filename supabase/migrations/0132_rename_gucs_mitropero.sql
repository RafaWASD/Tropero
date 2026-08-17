-- 0132_rename_gucs_mitropero.sql — Rebrand RAFAQ → miTropero, FASE 4: renombra las dos GUCs de sesión
-- `rafaq.is_auto_transition` → `mitropero.is_auto_transition` y `rafaq.is_transfer` → `mitropero.is_transfer`.
--
-- ⚠️ NO aplicar desde acá sin OK de deploy. Aplicada a DEV el 2026-08-17 (autorización de Raf en sesión).
--    PROD no se toca. Ver progress/rebrand-fase4-gucs.md y docs/rebrand-mitropero-plan.md §4.C.
--
-- POR QUÉ ES UNA SOLA MIGRACIÓN ATÓMICA (y no un deploy coordinado como decía el plan):
--   `git grep -nE "set_config|current_setting" -- app supabase/functions` → CERO. Ni el cliente ni las
--   Edge Functions tocan estas GUCs: viven enteramente dentro de Postgres. No hay skew posible. Dentro de
--   este begin/commit, o se renombran las 6 funciones o ninguna — nunca hay un instante con el que SETEA
--   y el que LEE desalineados (que es exactamente lo que apagaría el early-return en silencio).
--
-- SUPERFICIE (barrida sobre el CATÁLOGO del remoto, no sobre las migraciones):
--   `pg_proc` + `pg_db_role_setting` + vistas + constraints + policies + WHEN de triggers + defaults de
--   columna + índices, todos filtrados por `like '%rafaq.%'`. Todo lo no-función dio VACÍO. Son 6 funciones:
--     SETEAN:  apply_auto_transition (is_auto_transition) · transfer_animal (is_transfer)
--     LEEN:    tg_animal_profiles_set_override_on_manual · tg_animal_profiles_record_category_change
--              tg_animal_events_enforce_edit_window · tg_animal_profiles_record_rodeo_change
--
-- BASE DEL RE-CREATE = `pg_get_functiondef` CONTRA DEV (2026-08-17), no las migraciones que las crearon.
--   Es la trampa de reference_function_recreate_base y acá muerde tres veces:
--     · transfer_animal                          vigente = 0122 (no 0087; 0122 le sacó visual_id_alt)
--     · tg_animal_profiles_set_override_on_manual vigente = 0040 (no 0021; 0040 sumó el revert explícito)
--     · tg_animal_profiles_record_rodeo_change    vigente = 0127
--   Los cuerpos de abajo son BYTE-POR-BYTE los del remoto con el único cambio del literal de la GUC.
--
-- CREATE OR REPLACE, NUNCA DROP+CREATE: conserva owner, ACL, COMMENT y —en las 4 trigger functions— el
--   binding de los 6 triggers que las usan (un DROP los tiraría en cascada). Los revoke/grant de las dos
--   funciones invocables igual se re-emiten al final (idempotente, molde 0065).
--
-- SIN CAMBIO DE COMPORTAMIENTO: es un rename puro. Cualquier diferencia de conducta post-aplicación es un
--   bug de esta migración, no una mejora.

begin;

-- ── apply_auto_transition ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_auto_transition(profile_id uuid, target_category_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform set_config('mitropero.is_auto_transition', 'on', true);
  update public.animal_profiles
    set category_id = target_category_id
    where id = profile_id;
  perform set_config('mitropero.is_auto_transition', 'off', true);
end; $function$;

-- ── tg_animal_events_enforce_edit_window ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_animal_events_enforce_edit_window()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('mitropero.is_transfer', true), 'off') = 'on' then
    return new;
  end if;

  if now() > old.edit_window_until then
    if new.text is distinct from old.text
       or new.structured_payload is distinct from old.structured_payload
       or new.event_type is distinct from old.event_type then
      raise exception 'edit window expired for animal_event %', old.id
        using errcode = '23514';
    end if;
  end if;
  if new.author_id        is distinct from old.author_id
     or new.animal_profile_id is distinct from old.animal_profile_id
     or new.establishment_id  is distinct from old.establishment_id
     or new.created_at        is distinct from old.created_at
     or new.edit_window_until is distinct from old.edit_window_until then
    raise exception 'immutable column changed on animal_event %', old.id
      using errcode = '23514';
  end if;
  return new;
end; $function$;

-- ── tg_animal_profiles_record_category_change ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_animal_profiles_record_category_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_reason public.category_change_reason;
begin
  if tg_op = 'INSERT' then
    v_reason := 'initial';
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, null, new.category_id, auth.uid(), v_reason);
  elsif tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    if coalesce(current_setting('mitropero.is_auto_transition', true), 'off') = 'on' then
      v_reason := 'auto_transition';
    elsif old.category_override = true and new.category_override = false then
      v_reason := 'revert_to_auto';
    else
      v_reason := 'manual_override';
    end if;
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, old.category_id, new.category_id, auth.uid(), v_reason);
  end if;
  return new;
end; $function$;

-- ── tg_animal_profiles_record_rodeo_change ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_animal_profiles_record_rodeo_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason public.rodeo_membership_reason;
  v_from   date;
  v_open   record;
  v_in_padron boolean;
begin
  if tg_op = 'INSERT' then
    -- transfer_animal (0087) setea la GUC LOCAL mitropero.is_transfer='on' antes de crear el perfil destino
    -- (0088 documenta que un cliente no puede setearla dentro de la transacción del RPC).
    v_reason := case when coalesce(current_setting('mitropero.is_transfer', true), 'off') = 'on'
                     then 'transfer_in'::public.rodeo_membership_reason
                     else 'initial'::public.rodeo_membership_reason end;
    v_from   := coalesce(new.entry_date, new.created_at::date);

    if new.status = 'active' and new.deleted_at is null then
      -- perfil EN padrón → membresía vigente
      insert into public.rodeo_membership_history
        (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
      values (new.id, new.rodeo_id, new.establishment_id, v_from, null, v_reason, auth.uid());
    else
      -- perfil que nace YA FUERA del padrón (import histórico de un animal vendido): intervalo cerrado.
      -- greatest(...) protege el CHECK to_date >= from_date cuando entry_date es posterior a exit_date.
      insert into public.rodeo_membership_history
        (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
      values (new.id, new.rodeo_id, new.establishment_id, v_from,
              greatest(coalesce(new.exit_date, current_date), v_from), v_reason, auth.uid());
    end if;
    return new;
  end if;

  -- ── UPDATE ───────────────────────────────────────────────────────────────────────────────────────────
  -- DP-4: la membresía es el ÚNICO predicado de presencia. `exit_date` entra como el to_date del cierre de
  -- fila, no como un segundo filtro que pueda divergir.
  v_in_padron := (new.status = 'active' and new.deleted_at is null);

  select h.id, h.from_date, h.rodeo_id
    into v_open
    from public.rodeo_membership_history h
   where h.animal_profile_id = new.id and h.to_date is null
   order by h.from_date desc
   limit 1;

  if not v_in_padron then
    -- RCC.1.6 — sale del padrón (status <> 'active' o deleted_at): cierra la vigente, si la hay.
    if v_open.id is not null then
      update public.rodeo_membership_history
         set to_date = greatest(coalesce(new.exit_date, current_date), v_open.from_date)
       where id = v_open.id;
    end if;
    return new;
  end if;

  if v_open.id is null then
    -- RCC.1.7 — vuelve al padrón sin fila vigente (reingreso / un-delete).
    insert into public.rodeo_membership_history
      (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
    values (new.id, new.rodeo_id, new.establishment_id, current_date, null, 'reactivation', auth.uid());
    return new;
  end if;

  if new.rodeo_id is distinct from v_open.rodeo_id then
    -- RCC.1.5 — movimiento de rodeo: cierra la vigente HOY y abre una nueva HOY. `is distinct from` hace que
    -- un `update of rodeo_id` que no cambia nada no escriba (molde 0030).
    update public.rodeo_membership_history
       set to_date = greatest(current_date, v_open.from_date)
     where id = v_open.id;
    insert into public.rodeo_membership_history
      (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
    values (new.id, new.rodeo_id, new.establishment_id, current_date, null, 'move', auth.uid());
  end if;

  return new;
end; $function$;

-- ── tg_animal_profiles_set_override_on_manual ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_animal_profiles_set_override_on_manual()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.category_id is distinct from old.category_id then
    -- Revert explícito (R4.10): el usuario clarea el override en el mismo update.
    if old.category_override = true and new.category_override = false then
      return new;  -- respetar el revert; no re-marcar override.
    end if;
    if coalesce(current_setting('mitropero.is_auto_transition', true), 'off') <> 'on' then
      new.category_override := true;
    end if;
  end if;
  return new;
end; $function$;

-- ── transfer_animal ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_animal(p_source_profile_id uuid, p_target_establishment_id uuid, p_target_rodeo_id uuid, p_target_profile_id uuid, p_target_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source_est uuid; v_animal_id uuid; v_source_created_by uuid; v_source_idv text;
  v_source_breed text; v_source_coat text; v_source_rodeo_id uuid;
  v_source_rodeo_system uuid; v_target_rodeo_system uuid; v_idv_to_use text;
  v_idv_dropped boolean := false; v_now timestamptz := now();
begin
  if exists (select 1 from public.animal_profiles where id = p_target_profile_id and establishment_id = p_target_establishment_id) then
    return jsonb_build_object('target_profile_id', p_target_profile_id, 'idv_dropped', false, 'source_profile_id', p_source_profile_id, 'replay', true);
  end if;

  select establishment_id, animal_id, created_by, idv, breed, coat_color, rodeo_id
    into v_source_est, v_animal_id, v_source_created_by, v_source_idv, v_source_breed, v_source_coat, v_source_rodeo_id
  from public.animal_profiles
  where id = p_source_profile_id and status = 'active' and deleted_at is null;
  if v_source_est is null then raise exception 'source profile not found, not active, or already transferred' using errcode = '23503'; end if;

  if not public.has_role_in(p_target_establishment_id) then
    raise exception 'not authorized in target establishment (need active role in Y)' using errcode = '42501';
  end if;
  if not (public.has_role_in(v_source_est) and (public.is_owner_of(v_source_est) or v_source_created_by = auth.uid())) then
    raise exception 'not authorized to remove the animal from the source field (need active role in X AND owner-or-creator)' using errcode = '42501';
  end if;
  if v_source_est = p_target_establishment_id then raise exception 'source and target establishment are the same' using errcode = '23514'; end if;

  select r.system_id into v_source_rodeo_system from public.rodeos r where r.id = v_source_rodeo_id;
  select r.system_id into v_target_rodeo_system from public.rodeos r
  where r.id = p_target_rodeo_id and r.establishment_id = p_target_establishment_id and r.active = true and r.deleted_at is null;
  if v_target_rodeo_system is null then raise exception 'target rodeo not found / inactive / not in target establishment' using errcode = '23514'; end if;
  if v_target_rodeo_system is distinct from v_source_rodeo_system then raise exception 'target rodeo belongs to a different productive system (R4.5.1)' using errcode = '23514'; end if;

  v_idv_to_use := nullif(trim(coalesce(v_source_idv, '')), '');
  if v_idv_to_use is not null and exists (
    select 1 from public.animal_profiles ap where ap.establishment_id = p_target_establishment_id and ap.idv = v_idv_to_use and ap.deleted_at is null
  ) then
    v_idv_to_use := null; v_idv_dropped := true;
  end if;

  update public.animal_profiles
     set status = 'transferred', exit_reason = 'transfer'::public.exit_reason_enum, exit_date = v_now::date
   where id = p_source_profile_id;

  insert into public.animal_profiles (
    id, animal_id, establishment_id, rodeo_id, category_id, category_override, status,
    idv, management_group_id, breed, coat_color,
    entry_date, entry_origin, entry_weight, notes
  ) values (
    p_target_profile_id, v_animal_id, p_target_establishment_id, p_target_rodeo_id, p_target_category_id,
    false, 'active', v_idv_to_use, null,
    v_source_breed, v_source_coat,
    v_now::date, null, null, null
  );

  update public.weight_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.reproductive_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.sanitary_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.condition_score_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;
  update public.lab_samples set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null where animal_profile_id = p_source_profile_id;

  perform set_config('mitropero.is_transfer', 'on', true);
  update public.animal_events set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id where animal_profile_id = p_source_profile_id;
  perform set_config('mitropero.is_transfer', 'off', true);

  update public.animal_category_history set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id where animal_profile_id = p_source_profile_id;
  update public.birth_calves set calf_profile_id = p_target_profile_id where calf_profile_id = p_source_profile_id;
  update public.birth_calves bc set establishment_id = p_target_establishment_id
   where bc.birth_event_id in (select id from public.reproductive_events where animal_profile_id = p_target_profile_id and event_type = 'birth');
  update public.reproductive_events set bull_id = p_target_profile_id where bull_id = p_source_profile_id;
  update public.reproductive_events set calf_id = p_target_profile_id where calf_id = p_source_profile_id;

  return jsonb_build_object('target_profile_id', p_target_profile_id, 'idv_dropped', v_idv_dropped, 'source_profile_id', p_source_profile_id, 'replay', false);
end; $function$;

-- ── COMMENTs que nombraban la GUC vieja (los otros 4 no tienen COMMENT; el de transfer_animal dice
--    "vía GUC 0088" sin nombrarla → no cambia) ──────────────────────────────────────────────────────────
comment on function public.tg_animal_events_enforce_edit_window() is 'BEFORE UPDATE de animal_events: rechaza editar text/payload/event_type pasada la ventana e inmuta author_id/animal_profile_id/establishment_id/created_at/edit_window_until. DELTA spec 11 (0088): early-return cuando la GUC local mitropero.is_transfer=''on'' (la setea SOLO el RPC transfer_animal SECURITY DEFINER para re-apuntar la observación a Y; un cliente directo no puede setearla). Patrón mitropero.is_auto_transition (0031).';

comment on function public.tg_animal_profiles_record_rodeo_change() is 'Escribe rodeo_membership_history a partir de animal_profiles (delta campañas congeladas, RCC.1.4-1.7). SECURITY DEFINER set search_path = public (molde 0030). establishment_id SIEMPRE de la fila padre (anti-spoof, RCC.1.12). 5 ramas: INSERT en padrón / INSERT ya fuera del padrón / UPDATE con cambio de rodeo / UPDATE que sale del padrón / UPDATE que vuelve al padrón sin fila vigente. transfer_animal marca el alta del perfil destino como `transfer_in` vía la GUC local mitropero.is_transfer (0088). NO se re-apuntan filas en transfer_animal (RCC.1.13): la historia de membresía del perfil de origen se queda en el establecimiento de origen — re-apuntarla movería la historia de rodeo al campo destino, que es la fuga F4 elevada a escala de establecimiento. El próximo que lea 0087 va a querer "arreglar" esa asimetría: no lo haga.';

-- ── Re-emisión idempotente de los grants (CREATE OR REPLACE ya los conserva; esto es cinturón y
--    tiradores, y deja el estado esperado escrito en la migración). ─────────────────────────────────────
-- apply_auto_transition: helper interno del trigger, revocada de los 3 roles que expone PostgREST
-- (SEC-HIGH-01 / 0042, re-afirmada en 0065). Esta migración NO la reintroduce.
revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;

-- transfer_animal: RPC de usuario (0087/0122).
revoke execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) from public, anon;
grant  execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) to authenticated;

-- ── Guard: después de esta migración NINGUNA función del catálogo puede nombrar una GUC `rafaq.*`.
--    Se escribe sobre la AUSENCIA (busca `rafaq.` en cualquier prosrc, no las 6 que ya conozco), así que
--    si alguien deploya mañana una función nueva con el nombre viejo, esta migración la habría cazado.
--    Nota: `audit.resolve_actor`/`resolve_request_id` contienen "rafaq" pero en un HEADER
--    (`x-rafaq-actor`), no en una GUC `rafaq.<algo>` → el patrón `%rafaq.%` no los toca. Son fase 5.
do $$
declare v_left text;
begin
  select string_agg(n.nspname||'.'||p.proname, ', ')
    into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosrc like '%rafaq.%';
  if v_left is not null then
    raise exception 'fase 4 incompleta: todavía hay funciones con una GUC rafaq.*: %', v_left
      using errcode = '23514';
  end if;
end $$;

commit;
