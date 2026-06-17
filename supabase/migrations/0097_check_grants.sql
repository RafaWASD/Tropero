-- 0097_check_grants.sql  (spec 03 — MODO MANIOBRAS, chunk M5) — housekeeping de grants/revokes
-- Consolida grants de cliente sobre las tablas custom y verifica (fail-closed) que las funciones
-- SECURITY DEFINER nuevas del gating/guard/audit custom NO sean EXECUTE-ables por
-- public/authenticated/anon (R13.24, lección SEC-HIGH-01). Patrón de 0055.
--
-- La frontera WAL del sync (R13.20/R13.21) NO vive en una migración: es el delta de
-- sync-streams/rafaq.yaml (catalog_field_definitions restringido a establishment_id IS NULL + 3 streams
-- custom scope establishment) — lo deploya el LEADER en el dashboard de PowerSync (Validate → Deploy).
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear.

begin;

-- Re-afirma grants de cliente sobre las tablas custom (idempotente).
grant select, insert, update on public.field_definitions   to authenticated;
grant select, insert, update on public.custom_measurements to authenticated;
grant select, insert, update on public.custom_attributes   to authenticated;
grant all on public.custom_measurements to service_role;
grant all on public.custom_attributes   to service_role;

-- Re-afirma los revokes de las funciones internas nuevas (idempotente; defensa en profundidad, R13.24).
revoke execute on function public.tg_field_definitions_custom_guard ()        from public, authenticated, anon;
revoke execute on function public.tg_custom_measurements_force_audit ()       from public, authenticated, anon;
revoke execute on function public.tg_custom_attributes_force_audit ()         from public, authenticated, anon;
revoke execute on function public.assert_custom_field_enabled (uuid, uuid)    from public, authenticated, anon;
revoke execute on function public.assert_custom_value_valid (uuid, jsonb)     from public, authenticated, anon;
revoke execute on function public.tg_custom_measurements_gating ()           from public, authenticated, anon;
revoke execute on function public.tg_custom_attributes_gating ()            from public, authenticated, anon;

-- Smoke check (fail-closed): si alguna función interna custom quedó EXECUTE-able por una de las roles
-- cliente, la migración FALLA. Distingue por firma (las dos assert_* tienen argumentos) para no confundir
-- nombres con otras funciones del schema.
do $$
declare
  v_bad record;
begin
  for v_bad in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and (
        (p.proname = 'tg_field_definitions_custom_guard'  and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname = 'tg_custom_measurements_force_audit' and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname = 'tg_custom_attributes_force_audit'   and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname = 'assert_custom_field_enabled'        and pg_get_function_identity_arguments(p.oid) = 'p_animal_profile_id uuid, p_field_definition_id uuid')
        or (p.proname = 'assert_custom_value_valid'          and pg_get_function_identity_arguments(p.oid) = 'p_field_definition_id uuid, p_value jsonb')
        or (p.proname = 'tg_custom_measurements_gating'      and pg_get_function_identity_arguments(p.oid) = '')
        or (p.proname = 'tg_custom_attributes_gating'        and pg_get_function_identity_arguments(p.oid) = '')
      )
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: %(%) is EXECUTE-able by %', v_bad.proname, v_bad.args, v_bad.rolname;
  end loop;
  raise notice 'grant check OK: spec-03 M5 custom SECURITY DEFINER functions revoked from public/authenticated/anon';
end$$;

notify pgrst, 'reload schema';

commit;
