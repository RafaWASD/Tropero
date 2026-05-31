-- 0055_check_grants.sql  (spec 03 — MODO MANIOBRAS) — housekeeping de grants/revokes
-- Consolida grants de las tablas nuevas y verifica (fail-closed) que las funciones
-- SECURITY DEFINER internas del gating/tenant-check NO sean EXECUTE-ables por
-- public/authenticated/anon (R11.4, lección SEC-HIGH-01). Patrón de 0038/0042.

-- Re-afirma grants de cliente sobre las tablas nuevas (idempotente).
grant select, insert, update on public.sessions          to authenticated;
grant select, insert, update on public.maneuver_presets  to authenticated;
grant all on public.sessions          to service_role;
grant all on public.maneuver_presets  to service_role;

-- Re-afirma los revokes de las funciones internas (idempotente; defensa en profundidad).
revoke execute on function public.assert_data_keys_enabled (uuid, text[])     from public, authenticated, anon;
revoke execute on function public.tg_event_session_tenant_check ()           from public, authenticated, anon;
revoke execute on function public.tg_sessions_rodeo_check ()                 from public, authenticated, anon;
revoke execute on function public.tg_weight_events_gating ()                 from public, authenticated, anon;
revoke execute on function public.tg_condition_score_gating ()              from public, authenticated, anon;
revoke execute on function public.tg_sanitary_events_gating ()              from public, authenticated, anon;
revoke execute on function public.tg_lab_samples_gating ()                  from public, authenticated, anon;
revoke execute on function public.tg_reproductive_events_gating ()         from public, authenticated, anon;
revoke execute on function public.tg_animal_profiles_teeth_gating ()       from public, authenticated, anon;

-- Smoke check (fail-closed): si alguna función interna quedó EXECUTE-able por una
-- de las roles cliente, la migración FALLA.
do $$
declare
  v_bad record;
  v_funcs text[] := array[
    'assert_data_keys_enabled',
    'tg_event_session_tenant_check',
    'tg_sessions_rodeo_check',
    'tg_weight_events_gating',
    'tg_condition_score_gating',
    'tg_sanitary_events_gating',
    'tg_lab_samples_gating',
    'tg_reproductive_events_gating',
    'tg_animal_profiles_teeth_gating'
  ];
begin
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = any(v_funcs)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: % is EXECUTE-able by %', v_bad.proname, v_bad.rolname;
  end loop;
  raise notice 'grant check OK: spec-03 SECURITY DEFINER functions revoked from public/authenticated/anon';
end$$;

notify pgrst, 'reload schema';
