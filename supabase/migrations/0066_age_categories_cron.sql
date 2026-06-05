-- 0066_age_categories_cron.sql — Tier 2/3 spec 02. Red de seguridad de edad (DD-1, camino 2).
-- Cubre RT2.8.2, RT2.8.4, RT2.8.5, RT2.12.6 + SEC-SPEC-M02 (CRÍTICO).
--
-- refresh_age_categories(): job de sistema, CROSS-TENANT POR DISEÑO. Recalcula SOLO los
-- perfiles cuya categoría guardada quedó atrás de su edad (filtro targeted), no el padrón.
-- El on-event (compute_category vía triggers) sigue siendo el camino primario e instantáneo;
-- este cron es la red de seguridad de 24h para el animal que cruza un umbral de edad y al que
-- nadie carga/edita un evento.
--
-- SEGURIDAD (SEC-SPEC-M02, clase SEC-HIGH-01): la función retorna `void` y es SECURITY DEFINER →
-- SIN el revoke quedaría expuesta como RPC de PostgREST (POST /rest/v1/rpc/refresh_age_categories)
-- y, al cambiar category_id cross-tenant, sería un IDOR catastrófico. El revoke + smoke-check
-- fail-closed NO son defensa en profundidad: son el control de seguridad PRINCIPAL de esta función.

create extension if not exists pg_cron;

create or replace function public.refresh_age_categories ()
returns void language plpgsql security definer
set search_path = public as $$
declare
  r record;
  v_target uuid;
begin
  -- FILTRO TARGETED: solo perfiles cuya categoría guardada quedó atrás de su edad.
  -- Cría bovina: corte 1 año (ternero/ternera) y corte 2 años (torito/novillito).
  -- Las hembras NO tienen corte de 2 años (vaquillona->vaca es por PARTO, no por edad) → por eso
  -- solo ternero/ternera @365 y torito/novillito @730 entran. toro/novillo ya son terminales por
  -- edad; vaquillona+ no entran. Override y soft-delete excluidos (RT2.8.3 / soft-delete).
  for r in
    select p.id as profile_id, p.category_id as current_cat
    from public.animal_profiles p
    join public.categories_by_system c on c.id = p.category_id
    join public.animals a on a.id = p.animal_id
    where p.category_override = false
      and p.deleted_at is null
      and a.birth_date is not null
      and (
        (c.code in ('ternero','ternera')   and (current_date - a.birth_date) >= 365)
        or
        (c.code in ('torito','novillito')  and (current_date - a.birth_date) >= 730)
      )
  loop
    -- compute_category hace el trabajo real (misma fuente de verdad que el on-event).
    v_target := public.compute_category(r.profile_id);
    -- Aplica SOLO si difiere → no escribe de gusto, no genera history espurio.
    -- apply_auto_transition (revocada de clientes, 0042) registra el history como auto_transition.
    if v_target is not null and v_target is distinct from r.current_cat then
      perform public.apply_auto_transition(r.profile_id, v_target);  -- history auto_transition (RT2.8.4b)
    end if;
  end loop;
end; $$;

-- SEGURIDAD PRINCIPAL (SEC-SPEC-M02): cross-tenant by-design → NO invocable por clientes.
-- Revocada de las 3 roles CLIENTE expuestas por PostgREST. Mismo revoke que apply_auto_transition (0042).
revoke execute on function public.refresh_age_categories () from public, authenticated, anon;
-- service_role es la key admin server-side (NO un rol cliente, nunca se entrega al browser; ya
-- bypassea RLS). Conservar su EXECUTE no abre IDOR cliente (el smoke-check verifica solo las 3
-- roles cliente) y habilita la invocación operativa/maintenance server-side (y el test T8.n).
grant execute on function public.refresh_age_categories () to service_role;

-- Smoke-check fail-closed (paridad 0055/M01): si refresh_age_categories quedó EXECUTE-able por
-- una rol cliente, la migración FALLA. Es el control crítico (retorna void → se expondría como RPC).
do $$
declare
  v_bad record;
begin
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'refresh_age_categories'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (SEC-SPEC-M02): refresh_age_categories is EXECUTE-able by %', v_bad.rolname;
  end loop;
  raise notice 'grant check OK (SEC-SPEC-M02): refresh_age_categories revoked from public/authenticated/anon';
end$$;

-- Schedule idempotente. cron.schedule(jobname, schedule, command) hace upsert por jobname en
-- versiones recientes de pg_cron; para garantizar idempotencia en cualquier versión, hacemos un
-- unschedule defensivo (ignorando el error si el job no existe) antes del schedule.
do $$
begin
  perform cron.unschedule('refresh_age_categories_nightly');
exception when others then
  null;  -- el job no existía aún: ok.
end$$;

select cron.schedule('refresh_age_categories_nightly', '0 3 * * *',
                     $cron$ select public.refresh_age_categories(); $cron$);

notify pgrst, 'reload schema';
