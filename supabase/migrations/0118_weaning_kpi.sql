-- 0118_weaning_kpi.sql
-- Delta %DESTETE (#10) — spec 07 (RWK.1–RWK.9). RPC NUEVA rodeo_weaning_kpi: cierra el ciclo servida →
-- parida → DESTETADA. Moldeada sobre rodeo_calving_kpi (0117) — mismo guard/cota/tenant, mismo denominador de
-- Stream A (0105), mismo SECURITY DEFINER STABLE + revoke/grant + smoke-check. JOIN cría↔destete = compute_nursing
-- (0061). RPC NUEVA → CREATE directo (no DROP), pero el revoke public/anon es OBLIGATORIO (default = EXECUTE a
-- PUBLIC). NO toca rodeo_calving_kpi ni las otras 9 RPC de reportes (RWK.6.6).
--
-- NUMERACIÓN: 0118 = siguiente libre tras 0117 (la última). rodeo_weaning_kpi NO existe en el remoto
-- (verificado: grep vacío en supabase/migrations/*.sql, T1/RWK.6.6) → se crea de cero.
--
-- DEPLOY: NO se aplica desde este archivo. La aplica el LEADER por Supabase MCP tras Gate 1 (PASS) + reviewer
-- (APPROVED) + Gate 2 (PASS) + Gate 2.5 (capturas OK). La suite supabase/tests/reports/run.cjs (TR.11) queda
-- roja-hasta-apply.

begin;

create function public.rodeo_weaning_kpi (p_rodeo_id uuid, p_year int)
returns table (
  is_configured boolean,
  serviced int,
  weaned int,            -- numerador: crías destetadas de la campaña (RWK.2.1)
  pending_weaning int,   -- crías de la campaña al pie, sin destetar (RWK.3.1, D4)
  status text            -- 'ok' | 'not_weaning_season' | 'no_service_months' | 'not_applicable_12m' (RWK.5)
)
language plpgsql security definer stable
set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_cfg record; v_denom record;
begin
  -- ── Guard/cota IDÉNTICOS a 0117:43-52 — tenant derivado del RODEO, no del cliente (RWK.6.2/6.3/6.4). ──
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s weaning kpi' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- ── Denominador de Stream A (0105) — sin re-derivar (RWK.1.2). ──
  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;

  -- ── weaned (RWK.2): crías DISTINCT vinculadas por birth_calves a un parto de una SERVIDA cuya CONCEPCIÓN
  -- (parto − 9 meses) ∈ (p_year, mes ∈ service_months) — MISMA ventana que `calved` (0117:84-94), un paso más
  -- (parto → birth_calves → cría → weaning). JOIN molde = compute_nursing (0061:29-42). Imputación por AÑO DE
  -- SERVICIO (la cría se cuenta en la campaña que la concibió, NO por el año calendario del weaning — RWK.2.2). ──
  select count(distinct bc.calf_profile_id)::int
  into weaned
  from public.rodeo_serviced_females(p_rodeo_id, p_year) s
  join public.reproductive_events b
    on  b.animal_profile_id = s.animal_profile_id
    and b.event_type = 'birth' and b.deleted_at is null
    and v_months is not null and cardinality(v_months) >= 1
    and extract(year  from (b.event_date - interval '9 months'))::int = p_year
    and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
  join public.birth_calves bc on bc.birth_event_id = b.id
  where exists (
    select 1 from public.reproductive_events w
    where w.animal_profile_id = bc.calf_profile_id
      and w.event_type = 'weaning' and w.deleted_at is null
  );

  -- ── pending_weaning (RWK.3.1, D4): crías DISTINCT del MISMO conjunto de partos de la campaña SIN evento
  -- weaning no borrado (todavía al pie). = (# crías de la campaña) − weaned. Mismo JOIN, `not exists`. ──
  select count(distinct bc.calf_profile_id)::int
  into pending_weaning
  from public.rodeo_serviced_females(p_rodeo_id, p_year) s
  join public.reproductive_events b
    on  b.animal_profile_id = s.animal_profile_id
    and b.event_type = 'birth' and b.deleted_at is null
    and v_months is not null and cardinality(v_months) >= 1
    and extract(year  from (b.event_date - interval '9 months'))::int = p_year
    and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
  join public.birth_calves bc on bc.birth_event_id = b.id
  where not exists (
    select 1 from public.reproductive_events w
    where w.animal_profile_id = bc.calf_profile_id
      and w.event_type = 'weaning' and w.deleted_at is null
  );

  -- ── status (RWK.5) — precedencia: no_service_months → not_applicable_12m → not_weaning_season → ok. ──
  -- CRITERIO PROPIO (CD-2): not_weaning_season es DATA-DRIVEN (`weaned = 0`), NO date-driven como el
  -- not_calving_season de #8 (`current_date < ventana +9`). El destete NO tiene una ventana determinística:
  -- cae ~6-8 meses tras el parto, muy variable → no se puede computar un "inicio de temporada de destete".
  -- D3 lo define como "antes del 1er destete de la campaña" = `weaned = 0`. weaned/pending_weaning se
  -- computan SIEMPRE (conteo honesto); el status gatea solo el DISPLAY de la card.
  if v_months is null or cardinality(v_months) < 1 then
    status := 'no_service_months';
  elsif cardinality(v_months) = 12 then
    status := 'not_applicable_12m';
  elsif weaned = 0 then
    status := 'not_weaning_season';
  else
    status := 'ok';
  end if;

  return next;
end; $$;

comment on function public.rodeo_weaning_kpi is
  '%Destete de un rodeo en una campaña (delta #10/RWK): numerador weaned = crías DISTINCT (via birth_calves) '
  'de partos de servidas cuya concepción (parto − 9 meses) ∈ (p_year, mes ∈ service_months) que tienen evento '
  'weaning no borrado. Imputación por AÑO DE SERVICIO (no por año calendario del destete). %destete = '
  'weaned/serviced (puede >100% con mellizos). status (RWK.5) gatea el display: no_service_months (D5) / '
  'not_applicable_12m (D5, precede) / not_weaning_season (D3, weaned=0) / ok. pending_weaning (D4) = crías de '
  'la campaña al pie. Read-only/STABLE, SECURITY DEFINER, guard has_role_in + cota p_year. Denominador de Stream A.';

-- ── Grants (RPC nueva → default = EXECUTE a PUBLIC; el revoke es OBLIGATORIO — RWK.6.5). ──
revoke execute on function public.rodeo_weaning_kpi (uuid, int) from public, anon;
grant  execute on function public.rodeo_weaning_kpi (uuid, int) to authenticated;

-- ── Smoke-check fail-closed (patrón 0117:169-185, acotado a rodeo_weaning_kpi). Si la función quedó
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
      and p.proname = 'rodeo_weaning_kpi'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RWK.6.5): % is EXECUTE-able by % (must be revoked from anon/public)',
      v_bad.proname, v_bad.rolname;
  end loop;
  raise notice 'grant check OK (RWK.6.5): rodeo_weaning_kpi revoked from anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
