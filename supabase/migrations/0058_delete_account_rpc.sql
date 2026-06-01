-- 0058_delete_account_rpc.sql  (spec 01 — T6.3 / R2.4, R2.5, R2.5.1)
--
-- RPC SECURITY DEFINER que ejecuta la baja de cuenta como UNA transacción atómica:
--   (a) re-valida adentro de la transacción el bloqueo de único-owner (red de
--       seguridad TOCTOU; el edge ya pre-chequeó y dio la lista amigable), y
--   (b) hace los DOS writes de DB en lockstep: soft-delete del propio usuario
--       (`users.deleted_at`) + desactivación de TODOS sus `user_roles` activos
--       (`active=false`, `deactivated_at=now()`).
-- Cierra Gate 1 MEDIUM-1: nunca queda el estado "perfil borrado con roles activos".
-- Precedente directo: 0041_soft_delete_rpcs.sql (RPCs SECURITY DEFINER de spec 02).
--
-- La llama EXCLUSIVAMENTE el edge `delete_account` con adminClient (service_role).
-- NO es invocable por authenticated/anon (ver revoke/grant + smoke-check abajo) —
-- esto cierra el IDOR catastrófico (Gate 1 NUEVO-HIGH-1): toma p_user_id, así que si
-- fuera EXECUTE-able por authenticated cualquiera podría POST /rest/v1/rpc/
-- delete_account_tx {p_user_id:<otro>} y borrar a cualquier usuario.

create or replace function public.delete_account_tx (p_user_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_blocking int;
begin
  -- Red de seguridad TOCTOU (defensa en profundidad; el edge ya pre-chequeó con lista).
  -- ¿Queda algún establecimiento ACTIVO donde p_user_id es el ÚNICO owner activo?
  select count(*) into v_blocking
  from public.establishments e
  join public.user_roles ur
    on ur.establishment_id = e.id and ur.role = 'owner' and ur.active = true
  where e.deleted_at is null
    and ur.user_id = p_user_id
    and (
      select count(*) from public.user_roles ur2
      where ur2.establishment_id = e.id and ur2.role = 'owner' and ur2.active = true
    ) <= 1;
  if v_blocking > 0 then
    raise exception 'sole owner of % active establishment(s)', v_blocking
      using errcode = '23514';  -- check_violation → el edge lo mapea a 409 sole_owner
  end if;

  update public.users set deleted_at = now()
    where id = p_user_id and deleted_at is null;
  update public.user_roles set active = false, deactivated_at = now()
    where user_id = p_user_id and active = true;
end; $$;

-- CRÍTICO (Gate 1 NUEVO-HIGH-1, lección SEC-HIGH-01): es SECURITY DEFINER y toma
-- p_user_id → si fuera EXECUTE-able por authenticated/anon, CUALQUIERA podría
-- POST /rest/v1/rpc/delete_account_tx {p_user_id:<otro>} y borrar a cualquier usuario
-- (IDOR catastrófico). `revoke from public` NO alcanza si Supabase tiene un
-- ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO authenticated. Revocar de los
-- TRES roles explícitamente (patrón verificado: 0042 / 0055). Solo service_role la
-- ejecuta (el edge la llama con adminClient).
revoke all on function public.delete_account_tx (uuid) from public, authenticated, anon;
grant execute on function public.delete_account_tx (uuid) to service_role;

-- Smoke-check fail-closed (estilo 0055_check_grants.sql): si la RPC quedara
-- EXECUTE-able por authenticated/anon/public, la migración FALLA.
do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'delete_account_tx'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: delete_account_tx is EXECUTE-able by %', v_bad.rolname;
  end loop;
  raise notice 'grant check OK: delete_account_tx revoked from public/authenticated/anon';
end$$;

notify pgrst, 'reload schema';
