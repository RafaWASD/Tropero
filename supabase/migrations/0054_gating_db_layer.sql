-- 0054_gating_db_layer.sql  (spec 03 — MODO MANIOBRAS, ADR-021) — toca tablas de spec 02
-- Gating capa 2 (DB): el corazón de seguridad de este spec. Defensa en profundidad sobre la UI.
--
-- assert_data_keys_enabled(p_animal_profile_id, p_data_keys):
--   resuelve el rodeo del animal INLINE (animal_profiles.rodeo_id del perfil activo,
--   SEC-SPEC-03-02 — NO usa current_animal_rodeo, que no existe as-built) y asierta que
--   TODOS los data_keys requeridos estén enabled=true en rodeo_data_config (join a
--   field_definitions por field_definition_id).
--   FAIL-CLOSED (R7.6, SEC-SPEC-03-03): si v_rodeo IS NULL (perfil inexistente/soft-deleted)
--   -> raise 23514, NUNCA pasar. PROHIBIDO un early-return fail-open.
--
-- Triggers BEFORE INSERT por tabla mapean event_type/sample_type -> data_key(s) (R5.4):
--   weight_events            -> ['peso']
--   condition_score_events   -> ['condicion_corporal']
--   sanitary_events          -> ['vacunacion'] si event_type='vaccination', else []
--   lab_samples              -> ['brucelosis'] si sample_type='blood';
--                               ['raspado_toros'] si sample_type in (scrape_tricho,scrape_campylo); else []
--   reproductive_events      -> ['prenez','tamano_prenez'] si event_type='tacto';
--                               ['tacto_vaquillona'] si event_type='tacto_vaquillona';
--                               ['inseminacion'] si event_type='service' and service_type='ai'; else []
--   (parto/aborto/destete/servicio-no-IA NO se gatean — US-8 nota de alcance.)
--
-- Teeth/CUT gating (R7.5, D8 = ENFORCE AFINADO): gatea solo cambios ADITIVOS de
-- teeth_state/is_cut sobre animal_profiles (data_key 'dientes'). Los SUSTRACTIVOS
-- (teeth_state->NULL, is_cut true->false) se PERMITEN sin gatear.
--
-- Todas las funciones: SECURITY DEFINER + search_path=public + EXECUTE revocado de
-- public/authenticated/anon (R11.4, SEC-HIGH-01). Ninguna es RPC.

-- ============================================================================
-- 1. Core: assert_data_keys_enabled
-- ============================================================================
create or replace function public.assert_data_keys_enabled (p_animal_profile_id uuid, p_data_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_rodeo uuid; v_have int; v_need int;
begin
  -- Rodeo REAL del animal, inline desde el perfil ACTIVO (SEC-SPEC-03-02).
  select rodeo_id into v_rodeo
  from public.animal_profiles
  where id = p_animal_profile_id and deleted_at is null;

  -- FAIL-CLOSED (SEC-SPEC-03-03): rodeo no resoluble => rechazo duro, NUNCA pasar.
  if v_rodeo is null then
    raise exception 'maneuver gated: cannot resolve rodeo for gated event on profile % (profile missing or soft-deleted)', p_animal_profile_id
      using errcode = '23514';
  end if;

  v_need := array_length(p_data_keys, 1);
  if v_need is null then
    return;  -- maniobra sin data_keys gateadas: rodeo-existence ya validado, nada mas que chequear.
  end if;

  select count(distinct fd.data_key) into v_have
  from public.rodeo_data_config rdc
  join public.field_definitions fd on fd.id = rdc.field_definition_id
  where rdc.rodeo_id = v_rodeo
    and rdc.enabled = true
    and fd.data_key = any (p_data_keys);

  -- FAIL-CLOSED: falta CUALQUIERA de los data_keys requeridos enabled => rechazo.
  if v_have < v_need then
    raise exception 'maneuver gated: rodeo % is missing enabled data_keys %', v_rodeo, p_data_keys
      using errcode = '23514';
  end if;
end; $$;
revoke execute on function public.assert_data_keys_enabled (uuid, text[]) from public, authenticated, anon;

-- ============================================================================
-- 2. Triggers BEFORE INSERT por tabla
-- ============================================================================

-- weight_events -> ['peso']
create or replace function public.tg_weight_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_data_keys_enabled(new.animal_profile_id, array['peso']);
  return new;
end; $$;
revoke execute on function public.tg_weight_events_gating () from public, authenticated, anon;
create trigger weight_events_gating
  before insert on public.weight_events
  for each row execute function public.tg_weight_events_gating();

-- condition_score_events -> ['condicion_corporal']
create or replace function public.tg_condition_score_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_data_keys_enabled(new.animal_profile_id, array['condicion_corporal']);
  return new;
end; $$;
revoke execute on function public.tg_condition_score_gating () from public, authenticated, anon;
create trigger condition_score_gating
  before insert on public.condition_score_events
  for each row execute function public.tg_condition_score_gating();

-- sanitary_events -> ['vacunacion'] solo para event_type='vaccination'; el resto no se gatea.
create or replace function public.tg_sanitary_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type = 'vaccination' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion']);
  end if;
  return new;
end; $$;
revoke execute on function public.tg_sanitary_events_gating () from public, authenticated, anon;
create trigger sanitary_events_gating
  before insert on public.sanitary_events
  for each row execute function public.tg_sanitary_events_gating();

-- lab_samples -> blood:['brucelosis']; scrape_*:['raspado_toros']; other: no gatea.
create or replace function public.tg_lab_samples_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sample_type = 'blood' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['brucelosis']);
  elsif new.sample_type in ('scrape_tricho', 'scrape_campylo') then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['raspado_toros']);
  end if;
  return new;
end; $$;
revoke execute on function public.tg_lab_samples_gating () from public, authenticated, anon;
create trigger lab_samples_gating
  before insert on public.lab_samples
  for each row execute function public.tg_lab_samples_gating();

-- reproductive_events -> tacto:['prenez','tamano_prenez']; tacto_vaquillona:['tacto_vaquillona'];
--                        service+ai:['inseminacion']; el resto (parto/aborto/destete/...) no gatea.
create or replace function public.tg_reproductive_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type = 'tacto' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['prenez', 'tamano_prenez']);
  elsif new.event_type = 'tacto_vaquillona' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['tacto_vaquillona']);
  elsif new.event_type = 'service' and new.service_type = 'ai' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['inseminacion']);
  end if;
  return new;
end; $$;
revoke execute on function public.tg_reproductive_events_gating () from public, authenticated, anon;
create trigger reproductive_events_gating
  before insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_gating();

-- ============================================================================
-- 3. Teeth/CUT gating (R7.5, D8 = ENFORCE AFINADO) — additive-only
-- ============================================================================
create or replace function public.tg_animal_profiles_teeth_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Gatea SOLO cambios aditivos (que escriben dato de dientes/CUT):
  --   teeth_state cambia a valor no-NULL, o is_cut cambia de false a true.
  -- Sustractivos (teeth_state->NULL, is_cut true->false) pasan sin gatear: nunca pueden
  -- meter dato prohibido en un rodeo sin 'dientes' (solo lo quitan).
  if (new.teeth_state is distinct from old.teeth_state and new.teeth_state is not null)
     or (new.is_cut is distinct from old.is_cut and new.is_cut = true) then
    perform public.assert_data_keys_enabled(new.id, array['dientes']);
  end if;
  return new;
end; $$;
revoke execute on function public.tg_animal_profiles_teeth_gating () from public, authenticated, anon;

-- La guarda WHEN evita gatear UPDATE de lote (R9.2: management_group_id) y de rodeo
-- (R4.4: rodeo_id), que no tocan dientes/CUT. category_id está en el OF porque CUT lo cambia
-- junto con is_cut.
create trigger animal_profiles_teeth_gating
  before update of teeth_state, is_cut, category_id on public.animal_profiles
  for each row
  when (new.teeth_state is distinct from old.teeth_state
        or new.is_cut is distinct from old.is_cut)
  execute function public.tg_animal_profiles_teeth_gating();

notify pgrst, 'reload schema';
