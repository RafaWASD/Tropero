-- 0091_sanitary_gating_deworming_treatment.sql  (spec 03 — MODO MANIOBRAS, R7.7 / R6.13-R6.15) — toca tabla de spec 02
-- Extiende el gating capa 2 (DB) de sanitary_events para las 2 maniobras sanitarias nuevas
-- (sesión 26). HOY tg_sanitary_events_gating (0054) gatea SOLO event_type='vaccination'
-- → todo otro event_type (deworming, treatment, test, other) pasa SIN gatear.
--
-- Antiparasitario (R6.13) → event_type='deworming'  → silent_apply, escribe a sanitary_events.
-- Antibiótico    (R6.15) → event_type='treatment'   → silent_apply, escribe a sanitary_events.
-- Ambas deben gatearse por rodeo real igual que la vacunación (defensa en profundidad, R7.7):
-- un INSERT directo (PostgREST/sync) sobre un rodeo sin el/los data_key(s) habilitados se rechaza
-- con 23514, aunque la UI nunca lo hubiera ofrecido (R7.3).
--
-- Gating de cada maniobra:
--   treatment → ['antibiotico']                                    (single key, igual que vaccination → vacunacion)
--   deworming → antiparasitario_interno O antiparasitario_externo  (semántica OR — D10 cerrado por Raf 2026-06-14:
--               NO se distingue interno/externo de forma estructurada; con que AL MENOS UNO esté enabled
--               alcanza, R6.14. NO se agrega data_key nueva; NO se usa `route` para ramificar.)
--
-- assert_data_keys_enabled (0054) exige que TODOS los data_keys del array estén enabled (AND) → NO sirve
-- para la OR (pasarle los dos exigiría AMBOS). Se agrega un helper hermano assert_any_data_key_enabled
-- con la MISMA propiedad fail-closed (SEC-SPEC-03-03) pero con umbral `>= 1` en vez de `= n`.
--
-- NO toca el gating de vaccination ni el de las otras tablas (weight/condition/lab/reproductive/teeth):
-- solo CREATE OR REPLACE de la función del trigger de sanitary_events (el trigger sanitary_events_gating
-- ya existe de 0054 y NO se redefine — el replace de la función basta).
--
-- Todas las funciones: SECURITY DEFINER + search_path=public + EXECUTE revocado de
-- public/authenticated/anon (R11.4, SEC-HIGH-01). Ninguna es RPC.

-- ============================================================================
-- 1. Helper OR: assert_any_data_key_enabled (al menos UNO enabled)
-- ============================================================================
-- Mismo contrato fail-closed que assert_data_keys_enabled, pero acepta si AL MENOS UNO de los
-- data_keys está enabled en el rodeo real (no todos). Para gatear maniobras con alternativas
-- equivalentes (antiparasitario interno/externo, R6.14 / D10).
create or replace function public.assert_any_data_key_enabled (p_animal_profile_id uuid, p_data_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_rodeo uuid; v_have int; v_need int;
begin
  -- Rodeo REAL del animal, inline desde el perfil ACTIVO (SEC-SPEC-03-02; mismo patrón que
  -- assert_data_keys_enabled). NO usa current_animal_rodeo (no existe as-built).
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
    return;  -- sin data_keys: rodeo-existence ya validado, nada mas que chequear.
  end if;

  select count(distinct fd.data_key) into v_have
  from public.rodeo_data_config rdc
  join public.field_definitions fd on fd.id = rdc.field_definition_id
  where rdc.rodeo_id = v_rodeo
    and rdc.enabled = true
    and fd.data_key = any (p_data_keys);

  -- FAIL-CLOSED OR: NINGUNO de los data_keys alternativos enabled => rechazo. Basta con uno.
  if v_have < 1 then
    raise exception 'maneuver gated: rodeo % has none of the alternative data_keys % enabled', v_rodeo, p_data_keys
      using errcode = '23514';
  end if;
end; $$;
revoke execute on function public.assert_any_data_key_enabled (uuid, text[]) from public, authenticated, anon;

-- ============================================================================
-- 2. tg_sanitary_events_gating — ramifica vaccination + deworming + treatment
-- ============================================================================
-- CREATE OR REPLACE de la función pre-existente de 0054. Preserva el trigger sanitary_events_gating
-- (no se redefine). La rama vaccination queda EXACTAMENTE como en 0054 (no se altera el gating existente).
create or replace function public.tg_sanitary_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type = 'vaccination' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion']);
  elsif new.event_type = 'deworming' then
    -- Antiparasitario (R6.13/R6.14): gating OR interno/externo. D10 cerrado (Raf 2026-06-14):
    -- una sola maniobra, sin distinción estructurada interno/externo; basta con que el rodeo real
    -- tenga AL MENOS UNO de antiparasitario_interno / antiparasitario_externo enabled.
    perform public.assert_any_data_key_enabled(
      new.animal_profile_id,
      array['antiparasitario_interno', 'antiparasitario_externo']
    );
  elsif new.event_type = 'treatment' then
    -- Antibiótico (R6.15): single key, igual que vaccination.
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['antibiotico']);
  end if;
  -- test/other (sanitary_event_type) NO se gatean: no son maniobras de manga de este spec.
  return new;
end; $$;
-- EXECUTE ya estaba revocado (función pre-existente de 0054); el CREATE OR REPLACE lo preserva.
-- Re-afirmamos el revoke (housekeeping, defensa en profundidad — patrón 0055).
revoke execute on function public.tg_sanitary_events_gating () from public, authenticated, anon;

notify pgrst, 'reload schema';
