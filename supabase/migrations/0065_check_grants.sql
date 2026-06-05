-- 0065_check_grants.sql — Tier 2/3 spec 02. Housekeeping de grants/revokes (patrón 0038/0055).
-- Cubre RT2.12.2, RT2.12.4 + SEC-SPEC-M01.
--
-- (1) Re-afirma el revoke de apply_auto_transition (RT2.12.2): este delta NO reintroduce su grant;
--     las transiciones nuevas la invocan SOLO desde triggers SECURITY DEFINER (corren como owner).
-- (2) Confirma los grants correctos de las funciones de lectura nuevas/reescritas.
-- (3) SEC-SPEC-M01 (defensa en profundidad): revoca NOMINALMENTE las 3 funciones-trigger nuevas
--     y las suma al smoke-check fail-closed. Las funciones que retornan `trigger` NO se exponen
--     por PostgREST, pero el revoke nominal + smoke-check cierran el patrón y previenen regresión.

-- (1) apply_auto_transition sigue revocada (SEC-HIGH-01, 0042). Re-emisión idempotente.
revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;

-- (2) funciones de lectura: EXECUTE para authenticated (lectura pura, derivan del profile_id).
grant execute on function public.compute_category (uuid) to authenticated;
grant execute on function public.compute_nursing (uuid) to authenticated;

-- (3) SEC-SPEC-M01: revoke nominal de las 3 funciones-trigger nuevas del delta.
revoke execute on function public.tg_reproductive_events_apply_transition ()     from public, authenticated, anon;
revoke execute on function public.tg_animals_apply_castration ()                 from public, authenticated, anon;
revoke execute on function public.tg_reproductive_events_recompute_nursing ()    from public, authenticated, anon;

-- Smoke check (fail-closed): si alguna función interna del delta quedó EXECUTE-able por una de
-- las roles cliente, la migración FALLA. Paridad con 0055.
do $$
declare
  v_bad record;
  v_funcs text[] := array[
    'apply_auto_transition',
    'tg_reproductive_events_apply_transition',
    'tg_animals_apply_castration',
    'tg_reproductive_events_recompute_nursing'
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
  raise notice 'grant check OK: spec-02 Tier 2/3 internal functions revoked from public/authenticated/anon';
end$$;

notify pgrst, 'reload schema';
