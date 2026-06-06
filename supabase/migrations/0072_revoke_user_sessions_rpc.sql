-- 0072_revoke_user_sessions_rpc.sql  (spec 13 — H1-1 / R9.1, R9.2, R9.3)
--
-- FIX-LOOP del reviewer (#1, BLOCKER): el mecanismo anterior de H1-1
-- (`updateUserById(uid, {ban_duration:'1s'})`) NO invalida la sesión del target de forma
-- efectiva ni persistente — VERIFICADO EMPÍRICAMENTE por el leader: tras ban 1s + 2.5s de
-- espera, `refreshSession` con el token original VUELVE A FUNCIONAR (el ban finito solo
-- bloquea el refresh ~1s; NO revoca el refresh token persistente). R9.1/R9.2 exigen invalidar
-- la sesión / revocar los refresh tokens de forma persistente.
--
-- MECANISMO CORRECTO (decisión del leader): replicar lo que hace `signOut(global)` —que
-- `delete_account` usa y SÍ funciona— pero POR USER-ID, ya que supabase-js@2 NO expone un
-- `signOut(userId)` (la Auth Admin API `signOut(jwt, scope)` solo acepta el ACCESS TOKEN, que
-- el owner no posee). `signOut(global)` internamente borra las sesiones del usuario en
-- `auth.sessions`; al borrar las filas, los refresh tokens asociados dejan de poder canjearse
-- → revocación PERSISTENTE (mismo efecto que el global signOut). Esta RPC SECURITY DEFINER
-- hace exactamente eso por user id:
--   DELETE FROM auth.sessions WHERE user_id = target_uid;
--
-- VERIFICACIÓN EMPÍRICA del leader (NO asumida, como pasó con el ban): contra el remoto, sobre
-- un user de prueba (creado, logueado, refresh token capturado), tras `DELETE FROM auth.sessions
-- WHERE user_id = X` (vía Management API, la migración aún sin aplicar) + 2s de espera, el
-- `refreshSession` con el token original FALLA persistente:
--     "400 Invalid Refresh Token: Refresh Token Not Found"
-- (control PRE-DELETE: el mismo refresh devolvía sesión válida; auth.sessions 2 → 0). Por
-- diseño NO toca el access-token vigente del target, que vive hasta su `exp` (~1h) cubierto por
-- RLS (`user_roles.active=false` ya niega acceso a datos en cada request) — eso es exactamente
-- lo que R9/R10 aceptan para un riesgo MEDIUM.
--
-- BLINDAJE DE GRANTS (CRÍTICO, lección SEC-HIGH-01 / patrón 0042/0055/0058): es SECURITY DEFINER
-- y toma `target_uid` → si fuera EXECUTE-able por authenticated/anon/public, CUALQUIERA podría
-- POST /rest/v1/rpc/revoke_user_sessions {target_uid:<otro>} y desloguear a cualquier usuario
-- (logout-de-cualquiera / DoS de sesión). `revoke from public` NO alcanza si Supabase tiene un
-- ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO authenticated → se revoca de los TRES roles
-- explícitamente + smoke-check fail-closed que ABORTA la migración si quedara invocable por
-- cliente. Solo `service_role` la ejecuta (la llaman las EFs remove_member/change_member_role
-- con adminClient).

create or replace function public.revoke_user_sessions (target_uid uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  -- Borra las sesiones del target → revoca sus refresh tokens de forma persistente (mismo
  -- efecto que signOut global, pero por user id). El access-token vigente vive hasta su exp
  -- (~1h), cubierto por RLS. `auth.sessions` se referencia con esquema explícito (auth NO está
  -- en search_path); SECURITY DEFINER corre con el dueño de la función (acceso a auth).
  delete from auth.sessions where user_id = target_uid;
end; $$;

-- CRÍTICO (lección SEC-HIGH-01): SECURITY DEFINER + toma target_uid → revocar de los TRES
-- roles cliente. Solo service_role la ejecuta (las EFs la llaman con adminClient).
revoke all on function public.revoke_user_sessions (uuid) from public, authenticated, anon;
grant execute on function public.revoke_user_sessions (uuid) to service_role;

-- Smoke-check fail-closed (estilo 0055/0058): si la RPC quedara EXECUTE-able por
-- authenticated/anon/public, la migración FALLA (no se deja una función de logout-de-cualquiera
-- expuesta a roles cliente).
do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'revoke_user_sessions'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: revoke_user_sessions is EXECUTE-able by %', v_bad.rolname;
  end loop;
  raise notice 'grant check OK: revoke_user_sessions revoked from public/authenticated/anon';
end$$;

notify pgrst, 'reload schema';
