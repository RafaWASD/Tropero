-- 0117_calving_kpi_status.sql
-- Delta %PARICIÓN fix del 0% + lógica de meses de parto (#8) — spec 07 (RPF.1–RPF.8).
--
-- QUÉ CAMBIA: `rodeo_calving_kpi(p_rodeo_id uuid, p_year int)` gana DOS columnas en su `returns table`:
--   * `status text`  — 'ok' | 'not_calving_season' | 'no_service_months' | 'not_applicable_12m'
--   * `pending_pregnant int` — preñadas vigentes (mismo criterio que `pregnant`) SIN parto contado en la campaña.
-- El `status` GATEA SOLO EL DISPLAY de la card de Parición (fix del "0 %" engañoso, D2/D3/D5); `calved`,
-- `pregnant`, `pending_pregnant` se computan SIEMPRE (conteo honesto, independiente de la fecha del test).
--
-- POR QUÉ DROP+CREATE (no CREATE OR REPLACE): agregar columnas al `returns table` cambia el TIPO DE RETORNO
-- de la función; Postgres NO lo permite con `CREATE OR REPLACE FUNCTION` → hay que DROP + CREATE de cero. La
-- RPC no tiene dependientes SQL (solo la invoca el cliente vía PostgREST; verificado: `rodeo_calving_kpi`
-- aparece únicamente en 0106) → el DROP es seguro. Como DROP+CREATE RESETEA privilegios (default Postgres =
-- EXECUTE a PUBLIC), la migración RE-APLICA `revoke public/anon` + `grant authenticated` + smoke-check
-- fail-closed (RPF.5.5) — esto es lo que Gate 1 (PASS) exige explícitamente.
--
-- MOLDE: cuerpo VIGENTE en 0106_reports_rpcs.sql:285-343 (regla reference_function_recreate_base — el leader
-- verifica contra el cuerpo VIGENTE del remoto antes de aplicar; ninguna migración posterior tocó esta RPC).
-- Se PRESERVA TAL CUAL: guard/cota (RPF.5.3/5.4), denominador de Stream A (RPF.5.1), `pregnant` (tacto+
-- vigente), `calved` (set-membership concepción − 9 meses ∈ (p_year, service_months), incl. wrap — RPF.5.2).
-- Solo se AGREGA `pending_pregnant` (D4) y `status` (D1/D2/D3/D5). Las otras 8 RPC de 0106 NO se tocan (RPF.5.6).
--
-- NUMERACIÓN: la spec citaba `0107` pero ese número ya está ocupado (0107_breed_catalog.sql, SIGSA); esta es
-- `0117` = siguiente libre tras 0116. El cuerpo base sigue siendo 0106.

begin;

-- El DROP+CREATE cambia el tipo de retorno (agrega status/pending_pregnant). Firma (uuid, int) exacta.
drop function public.rodeo_calving_kpi (uuid, int);

create function public.rodeo_calving_kpi (p_rodeo_id uuid, p_year int)
returns table (
  is_configured boolean, serviced int, entoradas int, pregnant int, calved int,
  status text,            -- 'ok' | 'not_calving_season' | 'no_service_months' | 'not_applicable_12m' (RPF.1/2/3)
  pending_pregnant int    -- D4: preñadas vigentes sin parto contado en la campaña (RPF.4.1)
)
language plpgsql security definer stable
set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_cfg record; v_denom record;
  v_window_start date;   -- inicio de la ventana de meses de parto de la campaña = min(mes servicio + 9 meses)
begin
  -- ── Guard/cota IDÉNTICOS al vigente (0106:291-299) — tenant derivado del RODEO, no del cliente. ──
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s calving kpi' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- ── Denominador de Stream A (0105) — sin re-derivar (RPF.5.1). ──
  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;
  entoradas     := v_denom.entoradas;

  -- ── pregnant (mismo criterio que rodeo_pregnancy_kpi) — SIN CAMBIOS (0106:307-325). ──
  with last_tacto as (
    select distinct on (t.animal_profile_id)
           t.animal_profile_id, t.pregnancy_status, t.event_date, t.created_at
    from public.rodeo_serviced_females(p_rodeo_id, p_year) s
    join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
    where t.event_type = 'tacto' and t.deleted_at is null
    order by t.animal_profile_id, t.event_date desc, t.created_at desc
  )
  select coalesce(sum(case
           when lt.pregnancy_status is not null and lt.pregnancy_status <> 'empty'
             and not exists (
               select 1 from public.reproductive_events ab
               where ab.animal_profile_id = lt.animal_profile_id
                 and ab.event_type = 'abortion' and ab.deleted_at is null
                 and (ab.event_date, ab.created_at) > (lt.event_date, lt.created_at)
             ) then 1 else 0 end), 0)::int
  into pregnant
  from last_tacto lt;

  -- ── calved: servidas con ≥1 birth cuya CONCEPCIÓN (parto − 9 meses) ∈ (p_year, mes ∈ service_months) ──
  -- SET-MEMBERSHIP (incl. wrap), SIN CAMBIOS (0106:330-340, RPF.5.2). El fix NO cambia el conteo, cambia el
  -- ESTADO de presentación (status). La guarda `v_months is not null and cardinality >= 1` se conserva.
  select count(distinct s.animal_profile_id)::int
  into calved
  from public.rodeo_serviced_females(p_rodeo_id, p_year) s
  where exists (
    select 1 from public.reproductive_events b
    where b.animal_profile_id = s.animal_profile_id
      and b.event_type = 'birth' and b.deleted_at is null
      and v_months is not null and cardinality(v_months) >= 1
      and extract(year  from (b.event_date - interval '9 months'))::int = p_year
      and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
  );

  -- ── pending_pregnant (NUEVO, D4 — RPF.4.1): preñadas VIGENTES (mismo criterio que `pregnant`: último
  -- tacto+ <> 'empty' sin aborto posterior) que NO tienen un parto CONTADO en la campaña (mismo criterio de
  -- set-membership que `calved`). = (# preñadas) − (# preñadas con parto contado). Scope tenant por el
  -- conjunto `rodeo_serviced_females` (re-guarda has_role_in + establishment) + join por animal_profile_id
  -- de ese conjunto → misma superficie que `pregnant`/`calved` (defensa M2/M5 de 0106 preservada). ──
  with last_tacto as (
    select distinct on (t.animal_profile_id)
           t.animal_profile_id, t.pregnancy_status, t.event_date, t.created_at
    from public.rodeo_serviced_females(p_rodeo_id, p_year) s
    join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
    where t.event_type = 'tacto' and t.deleted_at is null
    order by t.animal_profile_id, t.event_date desc, t.created_at desc
  )
  select coalesce(count(distinct lt.animal_profile_id), 0)::int
  into pending_pregnant
  from last_tacto lt
  where lt.pregnancy_status is not null and lt.pregnancy_status <> 'empty'
    and not exists (
      select 1 from public.reproductive_events ab
      where ab.animal_profile_id = lt.animal_profile_id
        and ab.event_type = 'abortion' and ab.deleted_at is null
        and (ab.event_date, ab.created_at) > (lt.event_date, lt.created_at)
    )
    and not exists (
      -- parto contado en la campaña (misma fórmula que `calved`).
      select 1 from public.reproductive_events b
      where b.animal_profile_id = lt.animal_profile_id
        and b.event_type = 'birth' and b.deleted_at is null
        and v_months is not null and cardinality(v_months) >= 1
        and extract(year  from (b.event_date - interval '9 months'))::int = p_year
        and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
    );

  -- ── status (NUEVO) — árbol de decisión con PRECEDENCIA (RPF.3.2: 12m antes que ventana). ──
  --   1) service_months NULL/{}         → 'no_service_months'   (D3, RPF.1.1)
  --   2) cardinality(service_months)=12 → 'not_applicable_12m'  (D5, RPF.3.1 — precede a la ventana)
  --   3) current_date < inicio ventana  → 'not_calving_season'  (D2, RPF.2.2 — 0% prematuro oculto)
  --   4) resto                          → 'ok'                   (D1/D2, RPF.2.3)
  if v_months is null or cardinality(v_months) < 1 then
    status := 'no_service_months';
  elsif cardinality(v_months) = 12 then
    status := 'not_applicable_12m';
  else
    -- inicio de la ventana de parto = el MENOR (mes de servicio + 9 meses) sobre service_months (RPF.2.1).
    -- El año calendario lo deriva `+ interval '9 months'` (wrap natural), consistente con el set-membership
    -- del `calved`. p_year ya está acotado y m ∈ [1,12] (CHECK DB 0102) → sin fechas absurdas.
    select min(make_date(p_year, m::int, 1) + interval '9 months')::date
    into v_window_start
    from unnest(v_months) as m;
    if current_date < v_window_start then
      status := 'not_calving_season';
    else
      status := 'ok';
    end if;
  end if;

  return next;
end; $$;

comment on function public.rodeo_calving_kpi is
  '%Parición de un rodeo en una campaña (R7.6 + delta #8/RPF): numerador calved = servidas con ≥1 birth cuya '
  'concepción (parto − 9 meses) cae en (p_year, mes ∈ service_months) — set-membership, no BETWEEN (R7.5.8). '
  'status (RPF.1/2/3) gatea SOLO el display de la card (no_service_months D3 / not_applicable_12m D5 / '
  'not_calving_season D2 / ok); pending_pregnant (RPF.4.1/D4) = preñadas vigentes sin parto contado en la '
  'campaña (insumo de la leyenda "todavía hay vacas que no parieron"). Read-only/STABLE, SECURITY DEFINER, '
  'guard has_role_in + cota p_year. calved/pregnant/pending_pregnant se computan SIEMPRE (conteo honesto).';

-- ── Re-grants tras el DROP+CREATE (RPF.5.5) — DROP resetea privilegios; default Postgres = EXECUTE a PUBLIC. ──
revoke execute on function public.rodeo_calving_kpi (uuid, int) from public, anon;
grant  execute on function public.rodeo_calving_kpi (uuid, int) to authenticated;

-- ── Smoke-check fail-closed (patrón 0106:730-750, acotado a rodeo_calving_kpi). Si la función quedó
-- EXECUTE-able por anon/public → raise → ROLLBACK de toda la migración (fail-closed a nivel migración). ──
do $$
declare v_bad record;
begin
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'rodeo_calving_kpi'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RPF.5.5): % is EXECUTE-able by % (must be revoked from anon/public)',
      v_bad.proname, v_bad.rolname;
  end loop;
  raise notice 'grant check OK (RPF.5.5): rodeo_calving_kpi revoked from anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
