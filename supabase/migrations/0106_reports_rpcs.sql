-- 0106_reports_rpcs.sql  (spec 07 — Stream C: reportes / analytics)
-- Cómputo server-side de los reportes (R7.3–R7.11) como funciones SQL `SECURITY DEFINER STABLE` (RPC vía
-- PostgREST), continuación natural del Stream A (el denominador YA son 3 RPC de ese tipo, 0105). design §0/§2/§5.
--
-- 9 funciones (8 de cómputo + 1 lister de sesiones opcional, design §2.1):
--   (1) session_event_summary(p_session_id)                         — R7.3  (conteo por tipo de evento)
--   (2) rodeo_sessions_list(p_rodeo_id)                             — R7.3.6 (lista de sesiones del rodeo)
--   (3) rodeo_pregnancy_kpi(p_rodeo_id, p_year)                     — R7.5  (%preñez)
--   (4) rodeo_calving_kpi(p_rodeo_id, p_year)                       — R7.6  (%parición)
--   (5) rodeo_ccl_distribution(p_rodeo_id, p_year)                  — R7.7  (distribución CCL)
--   (6) rodeo_calving_by_stage(p_rodeo_id, p_year)                  — R7.8  (cruce tacto↔nacimientos)
--   (7) rodeo_weight_by_category(p_rodeo_id, p_session_id)          — R7.9  (peso prom. por categoría + comparativa)
--   (8) establishment_overdue_doses(p_establishment_id, p_lookback_days, p_limit)  — R7.10 (alerta dosis vencida)
--   (9) establishment_unweighed(p_establishment_id, p_threshold_days, p_category_codes) — R7.11 (alerta sin pesar)
--
-- CONTRATO DE SEGURIDAD (Gate 1, design §5; los 4 MEDIUM M1-M4 ya foldeados a la spec):
--   §5.1 — guard has_role_in al ENTRAR, fail-closed (rechazar 42501, NO devolver vacío). Para las RPC con
--          p_rodeo_id/p_session_id: derivar el establishment de la fila y exigir has_role_in. Para las 2 RPC de
--          ALERTA con p_establishment_id del cliente (M1): `has_role_in(p_establishment_id)` es la 1ª SENTENCIA
--          ejecutable (es la superficie IDOR más directa — no se deriva de ninguna fila).
--   §5.2 — SECURITY DEFINER STABLE set search_path = public (read-only; no escriben).
--   §5.3 — cota de p_year tras el guard (1900..current+1), espejo 0105.
--   §5.4 — cota de escaneo (M4): establishment_overdue_doses acota ventana (p_lookback_days) + LIMIT (p_limit);
--          establishment_unweighed acota p_threshold_days [0,3650] + cardinality(p_category_codes) <= 64.
--          raise 22023 fuera de rango, tras el guard.
--   §5.5 — defensa en profundidad de tenant en los joins (M2): scopear por el JOIN a animal_profiles con
--          `p.establishment_id = v_est`, NO por la columna denorm de las tablas de evento (0077 = plumbing del
--          sync; su RLS canónica es por FK al perfil). Espejo de rodeo_serviced_females (0105:117-122).
--   §5.6 — excluir el perfil archivado/borrado EN EL JOIN, no en el helper (M3): cada RPC que toca
--          animal_profiles filtra `p.deleted_at is null` (siempre) + `p.status = 'active'` (KPIs/alertas; el
--          histórico de sesión R7.13.2 INCLUYE archivados → exento del filtro status). establishment_of_profile
--          (0023:9) NO filtra deleted_at → no se confía en él.
--   §5.7 — los KPI reproductivos NO re-derivan el denominador: invocan rodeo_serviced_females /
--          rodeo_repro_denominator (que re-guardan el tenant) — un solo lugar auditable.
--   §5.8 — revoke execute from public, anon + grant authenticated + smoke-check fail-closed (patrón 0105 (4)).
--   §5.10 — todos los params son tipados de PostgREST (uuid/int/text[]) → sin SQL string → sin inyección.
--
-- Base ÚNICA = servidas (sin toggle, Puerta de spec 2026-06-24, R7.5.3/R7.6.4): la RPC devuelve los absolutos
-- (numerador + denominador); el % lo calcula la UI (serviced=0 → "—", la RPC nunca divide). Wrap de fin de año
-- por set-membership (mes ∈ service_months), no BETWEEN (R7.5.8), consistente con Stream A.
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el LEADER por CLI/Management-API tras reviewer + Gate 2 +
-- Puerta 2 + autorización de Raf (patrón Stream A 0102-0105). Depende de Stream A (0105) y Stream B (tacto con
-- pregnancy_status, 0026) ya aplicados. La suite supabase/tests/reports/run.cjs FALLA hasta el apply — ESPERADO
-- (patrón 0075-0082 / 0093-0097 / puesta-en-servicio). El hook en scripts/run-tests.mjs queda COMENTADO; el
-- leader lo descomenta al aplicar.

begin;

-- ============================================================================
-- (1) Resumen de sesión — session_event_summary(p_session_id) — R7.3
-- ============================================================================
-- Conteo por tipo de evento de una sesión, sobre las 7 tablas con FK session_id del as-built (weight/
-- reproductive/sanitary/condition/lab/scrotal/custom — animal_events NO tiene session_id, 0034/0052). Todos
-- deleted_at IS NULL (R7.3.3). El tenant se asegura por el JOIN a animal_profiles con p.establishment_id =
-- v_est (M2). R7.13.2 (decisión CERRADA en la Puerta de spec): el histórico de sesión INCLUYE animales hoy
-- archivados (la jornada es un hecho pasado) → NO filtra p.status='active'; sí filtra p.deleted_at IS NULL
-- siempre (M3). Devuelve un row por kind con event_count + animales DISTINTOS de ese kind.
create or replace function public.session_event_summary (p_session_id uuid)
returns table (event_kind text, event_count int, animals int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est
  from public.sessions where id = p_session_id and deleted_at is null;
  if v_est is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  -- GUARD tenant (R7.12.2): cualquier rol del establecimiento puede LEER el resumen.
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this session' using errcode = '42501';
  end if;

  return query
  with rows as (
    -- Una fila (kind, animal_profile_id) por cada evento no borrado de la sesión, scopeado por el JOIN a
    -- animal_profiles con p.establishment_id = v_est (M2) + p.deleted_at is null (M3; SIN p.status — R7.13.2).
    select 'weight'::text as kind, w.animal_profile_id
      from public.weight_events w
      join public.animal_profiles p on p.id = w.animal_profile_id
      where w.session_id = p_session_id and w.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
    union all
    select 'reproductive', re.animal_profile_id
      from public.reproductive_events re
      join public.animal_profiles p on p.id = re.animal_profile_id
      where re.session_id = p_session_id and re.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
    union all
    select 'sanitary', se.animal_profile_id
      from public.sanitary_events se
      join public.animal_profiles p on p.id = se.animal_profile_id
      where se.session_id = p_session_id and se.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
    union all
    select 'condition', ce.animal_profile_id
      from public.condition_score_events ce
      join public.animal_profiles p on p.id = ce.animal_profile_id
      where ce.session_id = p_session_id and ce.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
    union all
    select 'lab', ls.animal_profile_id
      from public.lab_samples ls
      join public.animal_profiles p on p.id = ls.animal_profile_id
      where ls.session_id = p_session_id and ls.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
    union all
    select 'scrotal', sm.animal_profile_id
      from public.scrotal_measurements sm
      join public.animal_profiles p on p.id = sm.animal_profile_id
      where sm.session_id = p_session_id and sm.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
    union all
    select 'custom', cm.animal_profile_id
      from public.custom_measurements cm
      join public.animal_profiles p on p.id = cm.animal_profile_id
      where cm.session_id = p_session_id and cm.deleted_at is null
        and p.establishment_id = v_est and p.deleted_at is null
  ),
  kinds(event_kind) as (
    values ('weight'),('reproductive'),('sanitary'),('condition'),('lab'),('scrotal'),('custom')
  )
  -- LEFT JOIN para que TODOS los kinds aparezcan con 0 cuando no hubo eventos (R7.3.5: la UI decide el empty
  -- state; la RPC devuelve los 7 kinds con conteo, incluyendo 0).
  select k.event_kind,
         count(r.animal_profile_id)::int as event_count,
         count(distinct r.animal_profile_id)::int as animals
  from kinds k
  left join rows r on r.kind = k.event_kind
  group by k.event_kind
  order by k.event_kind;
end; $$;

comment on function public.session_event_summary is
  'Resumen de una sesión (R7.3): conteo por tipo de evento sobre las 7 tablas con FK session_id (weight/'
  'reproductive/sanitary/condition/lab/scrotal/custom; animal_events NO tiene session_id). Read-only/STABLE, '
  'SECURITY DEFINER con guard has_role_in(est de la sesión). Tenant por JOIN a animal_profiles (M2) + '
  'deleted_at IS NULL (M3); INCLUYE archivados (R7.13.2, histórico de sesión). Devuelve los 7 kinds con conteo '
  '(0 incluido) + animales distintos por kind.';

-- ============================================================================
-- (2) Lista de sesiones del rodeo — rodeo_sessions_list(p_rodeo_id) — R7.3.6
-- ============================================================================
-- Lista de sesiones no borradas de un rodeo, order by started_at desc. animal_count/event_count = conteo
-- autoritativo recomputado sobre los eventos (no los contadores app-maintained de sessions, que pueden driftear).
-- Para mantenerlo barato y consistente con session_event_summary, el conteo de eventos suma las 7 tablas; el de
-- animales = distinct de animales con ≥1 evento de la sesión. Guard de tenant derivado del rodeo. (OPCIONAL,
-- design §2.1: la lista también puede leerse del SQLite local; se expone igual para que el cliente elija.)
create or replace function public.rodeo_sessions_list (p_rodeo_id uuid)
returns table (
  id uuid, started_at timestamptz, ended_at timestamptz,
  status public.session_status, work_lot_label text, animal_count int, event_count int
)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid;
begin
  -- `id` es OUT param de esta función (returns table (id uuid, ...)) → en scope PL/pgSQL en todo el body.
  -- El `where id = p_rodeo_id` sin calificar choca con ese OUT param (42702: column reference "id" is ambiguous).
  -- Aliasamos la tabla (`r`) y calificamos toda referencia de columna. (Las otras 5 RPC con guard de rodeo NO
  -- declaran `id` como OUT param, así que su `where id = p_rodeo_id` no es ambiguo — sólo ésta lo es.)
  select r.establishment_id into v_est
  from public.rodeos r where r.id = p_rodeo_id and r.deleted_at is null;
  if v_est is null then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s sessions' using errcode = '42501';
  end if;

  return query
  with sess as (
    select s.id, s.started_at, s.ended_at, s.status, s.work_lot_label
    from public.sessions s
    where s.rodeo_id = p_rodeo_id and s.establishment_id = v_est and s.deleted_at is null
  ),
  ev as (
    -- (kind-agnostic) un row (session_id, animal_profile_id) por evento no borrado de cada sesión del rodeo.
    select e.session_id, e.animal_profile_id
    from (
      select session_id, animal_profile_id from public.weight_events where deleted_at is null
      union all select session_id, animal_profile_id from public.reproductive_events where deleted_at is null
      union all select session_id, animal_profile_id from public.sanitary_events where deleted_at is null
      union all select session_id, animal_profile_id from public.condition_score_events where deleted_at is null
      union all select session_id, animal_profile_id from public.lab_samples where deleted_at is null
      union all select session_id, animal_profile_id from public.scrotal_measurements where deleted_at is null
      union all select session_id, animal_profile_id from public.custom_measurements where deleted_at is null
    ) e
    join public.animal_profiles p on p.id = e.animal_profile_id
    where p.establishment_id = v_est and p.deleted_at is null          -- M2/M3 (histórico → sin status)
      and e.session_id in (select sess.id from sess)                   -- `sess.id` ya calificado (alias de CTE); un `id` bare acá chocaría con el OUT param `id` (42702)
  )
  select s.id, s.started_at, s.ended_at, s.status, s.work_lot_label,
         count(distinct ev.animal_profile_id)::int as animal_count,
         count(ev.animal_profile_id)::int as event_count
  from sess s
  left join ev on ev.session_id = s.id
  group by s.id, s.started_at, s.ended_at, s.status, s.work_lot_label
  order by s.started_at desc;
end; $$;

comment on function public.rodeo_sessions_list is
  'Lista de sesiones no borradas de un rodeo (R7.3.6), order by started_at desc, con conteo autoritativo de '
  'animales/eventos recomputado. Read-only/STABLE, SECURITY DEFINER con guard has_role_in(est del rodeo). '
  'Tenant por JOIN a animal_profiles (M2) + deleted_at (M3). OPCIONAL (la lista puede leerse del SQLite local).';

-- ============================================================================
-- (3) %Preñez — rodeo_pregnancy_kpi(p_rodeo_id, p_year) — R7.5
-- ============================================================================
-- Numerador `pregnant` = del conjunto SERVIDAS (rodeo_serviced_females, Stream A), las hembras cuyo ÚLTIMO
-- tacto (event_type='tacto', order by event_date desc, created_at desc) tiene pregnancy_status <> 'empty' sin
-- abortion posterior — MISMA regla "tacto+ vigente" que compute_category RT2.7.5 (0104:91-104). `empty` = las
-- servidas con último tacto = 'empty' (insumo de %pérdida). La UI calcula pregnant/serviced×100 (base única
-- servidas, sin toggle); serviced=0 → "—" (R7.5.4), la RPC nunca divide. Devuelve absolutos (R7.5.5).
create or replace function public.rodeo_pregnancy_kpi (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, serviced int, entoradas int, pregnant int, empty int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_cfg record; v_denom record;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s pregnancy kpi' using errcode = '42501';
  end if;
  -- cota de p_year tras el guard (§5.3). rodeo_service_campaign/serviced_females la re-validan igual.
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- Stream A: is_configured (R7.5.6) + denominador explícito (serviced/entoradas). §5.7: no se re-deriva a mano.
  -- Se capturan en RECORDs (RHS son campos del record, LHS son los OUT params → sin shadowing ambiguo).
  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;
  entoradas     := v_denom.entoradas;

  -- numerador: del conjunto servidas, las con tacto+ vigente / empty (último tacto). Se reusa el conjunto
  -- servidas (no se re-implementa la elegibilidad). El "último tacto" se resuelve con distinct on por animal.
  with last_tacto as (
    select distinct on (t.animal_profile_id)
           t.animal_profile_id, t.pregnancy_status, t.event_date, t.created_at
    from public.rodeo_serviced_females(p_rodeo_id, p_year) s
    join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
    where t.event_type = 'tacto' and t.deleted_at is null
    order by t.animal_profile_id, t.event_date desc, t.created_at desc
  ),
  -- tacto+ vigente = último tacto con pregnancy_status <> 'empty' Y sin abortion posterior (RT2.7.5).
  classified as (
    select lt.animal_profile_id,
           (lt.pregnancy_status is not null and lt.pregnancy_status <> 'empty'
            and not exists (
              select 1 from public.reproductive_events ab
              where ab.animal_profile_id = lt.animal_profile_id
                and ab.event_type = 'abortion' and ab.deleted_at is null
                and (ab.event_date, ab.created_at) > (lt.event_date, lt.created_at)
            )) as is_pregnant,
           (lt.pregnancy_status = 'empty') as is_empty
    from last_tacto lt
  )
  select coalesce(sum(case when is_pregnant then 1 else 0 end), 0)::int,
         coalesce(sum(case when is_empty then 1 else 0 end), 0)::int
  into pregnant, empty
  from classified;

  return next;
end; $$;

comment on function public.rodeo_pregnancy_kpi is
  '%Preñez de un rodeo en una campaña (R7.5): numerador pregnant = servidas con tacto+ vigente (último tacto '
  '<> empty sin aborto posterior, espejo compute_category RT2.7.5). Read-only/STABLE, SECURITY DEFINER, guard '
  'has_role_in + cota p_year. Devuelve absolutos (is_configured/serviced/entoradas/pregnant/empty); el % lo '
  'calcula la UI (base única servidas, sin toggle; serviced=0 → "—").';

-- ============================================================================
-- (4) %Parición — rodeo_calving_kpi(p_rodeo_id, p_year) — R7.6
-- ============================================================================
-- Numerador `calved` = del conjunto SERVIDAS, las con ≥1 birth (no borrado) cuyo MES DE CONCEPCIÓN derivado
-- (event_date − 9 meses, Gate 0 §5) cae en la campaña p_year POR SET-MEMBERSHIP (mes ∈ service_months, R7.5.8 —
-- no BETWEEN con wrap). Esto alinea paridas con servidas (mismo grupo de servicios). `pregnant` se devuelve como
-- insumo de la pérdida preñez→parición (visible comparando %preñez vs %parición sobre la misma base servidas,
-- R7.6.4) — la UI NO lo usa como base alterna.
create or replace function public.rodeo_calving_kpi (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, serviced int, entoradas int, pregnant int, calved int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_months smallint[]; v_cfg record; v_denom record;
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s calving kpi' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;
  entoradas     := v_denom.entoradas;

  -- pregnant (mismo criterio que rodeo_pregnancy_kpi) como insumo de la pérdida preñez→parición.
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

  -- calved: servidas con ≥1 birth cuya CONCEPCIÓN (parto − 9 meses) cae en (p_year, mes ∈ service_months).
  -- Si el rodeo no tiene meses (NULL/{}) → ninguna concepción cae en la ventana → calved = 0 (degradación
  -- coherente con serviced, que en NATURAL ya está vacío sin ventana).
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

  return next;
end; $$;

comment on function public.rodeo_calving_kpi is
  '%Parición de un rodeo en una campaña (R7.6): numerador calved = servidas con ≥1 birth cuya concepción '
  '(parto − 9 meses, Gate 0 §5) cae en (p_year, mes ∈ service_months) — set-membership, no BETWEEN (R7.5.8). '
  'Read-only/STABLE, SECURITY DEFINER, guard has_role_in + cota p_year. Devuelve absolutos; pregnant = insumo '
  'de la pérdida preñez→parición (la UI compara %preñez vs %parición, base única servidas).';

-- ============================================================================
-- (5) Distribución CCL — rodeo_ccl_distribution(p_rodeo_id, p_year) — R7.7
-- ============================================================================
-- Conteo head/body/tail (large/medium/small) del ÚLTIMO tacto+ vigente de cada hembra PREÑADA de la campaña
-- (mismo conjunto servidas + misma regla "tacto+ vigente" que rodeo_pregnancy_kpi). n_months gobierna cuántos
-- buckets MUESTRA la UI (lo decide pregnancy-buckets.ts client-side — fuente única); la RPC devuelve los 3
-- conteos crudos + total. Empty si total = 0 (R7.7.4).
create or replace function public.rodeo_ccl_distribution (p_rodeo_id uuid, p_year int)
returns table (n_months int, head int, body int, tail int, total int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_cfg record;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s ccl distribution' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select * into v_cfg from public.rodeo_service_campaign(p_rodeo_id, p_year);
  n_months := v_cfg.n_months;

  with last_tacto as (
    select distinct on (t.animal_profile_id)
           t.animal_profile_id, t.pregnancy_status, t.event_date, t.created_at
    from public.rodeo_serviced_females(p_rodeo_id, p_year) s
    join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
    where t.event_type = 'tacto' and t.deleted_at is null
    order by t.animal_profile_id, t.event_date desc, t.created_at desc
  ),
  pregnant_sizes as (
    -- solo las PREÑADAS (tacto+ vigente, RT2.7.5) y su tamaño (large/medium/small).
    select lt.pregnancy_status
    from last_tacto lt
    where lt.pregnancy_status is not null and lt.pregnancy_status <> 'empty'
      and not exists (
        select 1 from public.reproductive_events ab
        where ab.animal_profile_id = lt.animal_profile_id
          and ab.event_type = 'abortion' and ab.deleted_at is null
          and (ab.event_date, ab.created_at) > (lt.event_date, lt.created_at)
      )
  )
  select coalesce(sum(case when pregnancy_status = 'large'  then 1 else 0 end), 0)::int,
         coalesce(sum(case when pregnancy_status = 'medium' then 1 else 0 end), 0)::int,
         coalesce(sum(case when pregnancy_status = 'small'  then 1 else 0 end), 0)::int,
         count(*)::int
  into head, body, tail, total
  from pregnant_sizes;

  return next;
end; $$;

comment on function public.rodeo_ccl_distribution is
  'Distribución CCL (cabeza/cuerpo/cola = large/medium/small) de las preñadas de una campaña (R7.7): conteo del '
  'último tacto+ vigente por tamaño + n_months + total. Read-only/STABLE, SECURITY DEFINER, guard + cota p_year. '
  'El nº de barras lo decide el cliente con pregnancy-buckets.ts (fuente única); la RPC da los 3 conteos crudos.';

-- ============================================================================
-- (6) Cruce tacto↔nacimientos — rodeo_calving_by_stage(p_rodeo_id, p_year) — R7.8
-- ============================================================================
-- Distribución de NACIMIENTOS por etapa (cabeza/cuerpo/cola) derivada del mes de concepción de cada birth de la
-- campaña (mismo criterio de `calved`, R7.6.2), ubicado en el tercio del rodeo. La asignación mes→tercio es la
-- MISMA lógica que el cliente (calving-stage.ts): orden de servicio (con wrap) desde el inicio del run, tercios
-- enteros. DEUDA DE CONSISTENCIA (Gate 0 §9): cuando Facundo cierre el bucketing 4-11, se ajustan AMBOS lugares
-- (esta RPC + calving-stage.ts + pregnancy-buckets.ts). Degrada con total_born=0 (R7.8.3).
create or replace function public.rodeo_calving_by_stage (p_rodeo_id uuid, p_year int)
returns table (n_months int, head_born int, body_born int, tail_born int, total_born int)
language plpgsql security definer stable
set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_n int; v_start int;
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s calving by stage' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  v_n := coalesce(cardinality(v_months), 0);
  n_months := v_n;

  -- sin distinción de etapas (0/1/12 meses) → todo 0 (la UI no muestra el cruce). Espejo de calving-stage.ts.
  if v_n < 2 or v_n >= 12 then
    head_born := 0; body_born := 0; tail_born := 0; total_born := 0;
    return next; return;
  end if;

  -- inicio del run de servicio EN ORDEN DE SERVICIO (con wrap): el mes JUSTO DESPUÉS del único hueco circular
  -- grande (espejo de serviceRunBounds de service-months.ts). Para un run contiguo de v_n meses, las posiciones
  -- 0..v_n-1 quedan bien definidas. El "siguiente" del último mes (con wrap) es el menor mes (coalesce).
  with circ as (
    select m as cur,
           coalesce(lead(m) over (order by m), (select min(x) from unnest(v_months) x)) as nxt
    from unnest(v_months) as m
  )
  select coalesce(
           (select cur_nxt.nxt from (
              select cur, nxt from circ where ((nxt - cur) % 12 + 12) % 12 <> 1 limit 1
            ) cur_nxt),
           (select min(x) from unnest(v_months) x)
         )::int
  into v_start;
  -- (si no hay hueco grande, el set son los 12 meses — ya excluido arriba por v_n >= 12; el coalesce es defensa.)

  -- por cada hembra servida con ≥1 birth de la campaña (concepción en p_year + mes ∈ service_months), tomar
  -- UN parto (el de concepción más temprana, desempate event_date) y ubicar su mes de concepción en el tercio.
  -- DISTINCT ON por animal → total_born == calved (un parto por hembra/campaña; evita doble-conteo de mellizos
  -- o partos repetidos). Bucketizado por tercios enteros (idéntico a stageForPosition de calving-stage.ts).
  with births as (
    select distinct on (s.animal_profile_id)
           s.animal_profile_id,
           extract(month from (b.event_date - interval '9 months'))::int as conc_month
    from public.rodeo_serviced_females(p_rodeo_id, p_year) s
    join public.reproductive_events b on b.animal_profile_id = s.animal_profile_id
    where b.event_type = 'birth' and b.deleted_at is null
      and extract(year  from (b.event_date - interval '9 months'))::int = p_year
      and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
    order by s.animal_profile_id, (b.event_date - interval '9 months') asc, b.event_date asc
  ),
  positioned as (
    select ((conc_month - v_start) % 12 + 12) % 12 as pos
    from births
  ),
  staged as (
    select case
             when v_n = 2 then (case when pos = 0 then 'head' else 'tail' end)
             when pos <  (v_n / 3)       then 'head'
             when pos <  ((2 * v_n) / 3) then 'body'
             else 'tail'
           end as stage
    from positioned
    where pos < v_n   -- defensa: posición fuera del run (set disjunto histórico) no se cuenta
  )
  select coalesce(sum(case when stage = 'head' then 1 else 0 end), 0)::int,
         coalesce(sum(case when stage = 'body' then 1 else 0 end), 0)::int,
         coalesce(sum(case when stage = 'tail' then 1 else 0 end), 0)::int,
         count(*)::int
  into head_born, body_born, tail_born, total_born
  from staged;

  return next;
end; $$;

comment on function public.rodeo_calving_by_stage is
  'Distribución de NACIMIENTOS por etapa (cabeza/cuerpo/cola) de una campaña (R7.8): cada birth se ubica por su '
  'mes de concepción (parto − 9) en el tercio del run de servicio (orden de servicio con wrap, tercios enteros '
  '— espejo de calving-stage.ts). Read-only/STABLE, SECURITY DEFINER, guard + cota p_year. 0/1/12 meses → todo '
  '0. Deuda de consistencia con pregnancy-buckets (bucketing 4-11 [SUPUESTO], Gate 0 §9).';

-- ============================================================================
-- (7) Peso por categoría — rodeo_weight_by_category(p_rodeo_id, p_session_id) — R7.9
-- ============================================================================
-- AVG del ÚLTIMO weight_event no borrado por animal ACTIVO del rodeo, group by categoría ACTUAL. El animal se
-- scopea por el JOIN a animal_profiles con p.establishment_id = v_est + p.deleted_at is null + p.status='active'
-- EN EL JOIN (M2/M3) — no por la columna denorm de weight_events. p_session_id opcional: si se pasa, filtra a
-- los pesajes de ESA sesión (comparativa por sesiones, R7.9.5 — la UI llama dos veces y computa el delta; MVP =
-- solo por sesiones, no por campañas). Categorías sin peso → no aparecen (la UI las marca "sin pesar", R7.9.4).
create or replace function public.rodeo_weight_by_category (p_rodeo_id uuid, p_session_id uuid default null)
returns table (category_id uuid, category_code text, category_name text, avg_weight numeric, n_animals int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s weights' using errcode = '42501';
  end if;
  -- si se pasa p_session_id, debe ser una sesión del MISMO rodeo/tenant (defensa anti-IDOR sobre el parámetro
  -- opcional; el guard de rodeo ya cubrió el tenant, esto evita cruzar pesos de una sesión ajena al rodeo).
  if p_session_id is not null then
    if not exists (
      select 1 from public.sessions s
      where s.id = p_session_id and s.establishment_id = v_est and s.rodeo_id = p_rodeo_id and s.deleted_at is null
    ) then
      raise exception 'session does not belong to this rodeo' using errcode = '42501';
    end if;
  end if;

  return query
  with last_weight as (
    -- último peso por animal ACTIVO del rodeo (scopeado por el join a animal_profiles, M2/M3). Si p_session_id
    -- viene, el "último" se calcula DENTRO de esa sesión (comparativa por sesión).
    select distinct on (w.animal_profile_id)
           w.animal_profile_id, p.category_id, w.weight_kg
    from public.weight_events w
    join public.animal_profiles p on p.id = w.animal_profile_id
    where w.deleted_at is null
      and p.rodeo_id = p_rodeo_id
      and p.establishment_id = v_est
      and p.deleted_at is null
      and p.status = 'active'
      and (p_session_id is null or w.session_id = p_session_id)
    order by w.animal_profile_id, w.weight_date desc, w.created_at desc
  )
  select lw.category_id,
         c.code,
         c.name,
         round(avg(lw.weight_kg), 2)::numeric as avg_weight,
         count(*)::int as n_animals
  from last_weight lw
  join public.categories_by_system c on c.id = lw.category_id
  -- c.sort_order va en el GROUP BY (se usa en el ORDER BY): es 1:1 con la categoría (JOIN por la PK c.id),
  -- no parte grupos y preserva el orden — sin él, ORDER BY c.sort_order tira 42803.
  group by lw.category_id, c.code, c.name, c.sort_order
  order by c.sort_order, c.code;
end; $$;

comment on function public.rodeo_weight_by_category is
  'Peso promedio por categoría de un rodeo (R7.9): AVG del último weight_event no borrado por animal ACTIVO, '
  'group by categoría actual. Read-only/STABLE, SECURITY DEFINER, guard has_role_in. Tenant + status/deleted_at '
  'por el JOIN a animal_profiles (M2/M3). p_session_id opcional → comparativa por sesión (R7.9.5, MVP).';

-- ============================================================================
-- (8) Alerta dosis vencida — establishment_overdue_doses(p_establishment_id, p_lookback_days, p_limit) — R7.10
-- ============================================================================
-- sanitary_events no borrados de animales ACTIVOS del establecimiento con next_dose_date < hoy que NO tengan una
-- dosis posterior del MISMO product_name sobre el MISMO animal. M1: el p_establishment_id viene del cliente →
-- `has_role_in(p_establishment_id)` es la 1ª SENTENCIA ejecutable (superficie IDOR más directa). M2/M3: tenant +
-- status/deleted_at por el JOIN a animal_profiles. M4 (cota de escaneo): piso de ventana p_lookback_days + LIMIT
-- p_limit server-side, validados (raise 22023 fuera de rango) — la alerta NUNCA escanea todo el historial.
create or replace function public.establishment_overdue_doses (
  p_establishment_id uuid,
  p_lookback_days int default 365,
  p_limit int default 500
)
returns table (
  animal_profile_id uuid, idv text, visual_id_alt text, product_name text, next_dose_date date
)
language plpgsql security definer stable
set search_path = public as $$
begin
  -- M1: guard 1ª sentencia ejecutable (el p_establishment_id es del cliente; fail-closed, NO vacío silencioso).
  if not public.has_role_in(p_establishment_id) then
    raise exception 'not authorized to read this establishment''s overdue doses' using errcode = '42501';
  end if;
  -- M4: cota de escaneo (tras el guard). Espejo de la cota de p_year de 0105.
  if p_lookback_days < 0 then
    raise exception 'p_lookback_days must be >= 0' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit out of range (1..1000)' using errcode = '22023';
  end if;

  return query
  select se.animal_profile_id, p.idv, p.visual_id_alt, se.product_name, se.next_dose_date
  from public.sanitary_events se
  join public.animal_profiles p on p.id = se.animal_profile_id
  where se.deleted_at is null
    and se.next_dose_date is not null
    and se.next_dose_date < current_date
    -- M4: piso de ventana — no escanear años de historial. (date - int → date.)
    and se.next_dose_date >= current_date - p_lookback_days
    -- M2/M3: tenant + status/deleted_at por el join a animal_profiles (no por la columna denorm de la tabla).
    and p.establishment_id = p_establishment_id
    and p.deleted_at is null
    and p.status = 'active'
    -- "sin dosis posterior del mismo producto" (R7.10.1) = `se` es la ÚLTIMA APLICACIÓN del producto sobre ese
    -- animal (por event_date, desempate created_at). Así el overdue refleja el estado vigente: una re-vacunación
    -- posterior (aunque su próximo turno sea futuro) cubre la vencida vieja; si la última aplicación tiene
    -- next_dose vencido, ESA aparece. Keyear por event_date (la fecha real de aplicación), no por next_dose_date.
    and not exists (
      select 1 from public.sanitary_events later
      where later.animal_profile_id = se.animal_profile_id
        and later.product_name = se.product_name
        and later.deleted_at is null
        and (later.event_date, later.created_at) > (se.event_date, se.created_at)
    )
  order by se.next_dose_date asc
  limit p_limit;   -- M4: tope server-side.
end; $$;

comment on function public.establishment_overdue_doses is
  'Alerta de dosis vencida (R7.10): sanitary_events no borrados de animales activos con next_dose_date < hoy sin '
  'dosis posterior del mismo producto/animal. Read-only/STABLE, SECURITY DEFINER. M1: has_role_in('
  'p_establishment_id) como 1ª sentencia (IDOR del cliente). M2/M3: tenant/status/deleted_at por el join a '
  'animal_profiles. M4: cota de escaneo (ventana p_lookback_days + LIMIT p_limit; 22023 fuera de rango).';

-- ============================================================================
-- (9) Alerta sin pesar — establishment_unweighed(p_establishment_id, p_threshold_days, p_category_codes) — R7.11
-- ============================================================================
-- Animales ACTIVOS del establecimiento sin weight_event no borrado, o con último pesaje < hoy − p_threshold_days
-- (default-MVP 180 d CERRADO, parametrizado por tuneabilidad), filtrado por p_category_codes si se pasa (default
-- null = el cliente pasa el conjunto [SUPUESTO] de categorías que se pesan en cría — sigue Facundo/D2). M1: guard
-- 1ª sentencia. M2/M3: tenant/status/deleted_at por el join. M4 (cota de input): p_threshold_days ∈ [0,3650] +
-- cardinality(p_category_codes) <= 64 (raise 22023 fuera de rango).
create or replace function public.establishment_unweighed (
  p_establishment_id uuid,
  p_threshold_days int default 180,
  p_category_codes text[] default null
)
returns table (
  animal_profile_id uuid, idv text, visual_id_alt text,
  category_code text, category_name text, last_weight_date date, days_since int
)
language plpgsql security definer stable
set search_path = public as $$
begin
  -- M1: guard 1ª sentencia ejecutable (p_establishment_id del cliente).
  if not public.has_role_in(p_establishment_id) then
    raise exception 'not authorized to read this establishment''s unweighed animals' using errcode = '42501';
  end if;
  -- M4: cota de input (tras el guard).
  if p_threshold_days < 0 or p_threshold_days > 3650 then
    raise exception 'p_threshold_days out of range (0..3650)' using errcode = '22023';
  end if;
  if p_category_codes is not null and cardinality(p_category_codes) > 64 then
    raise exception 'p_category_codes too large (max 64)' using errcode = '22023';
  end if;

  return query
  with active_animals as (
    -- animales activos del establecimiento (scopeado por el join a animal_profiles, M2/M3), opcionalmente
    -- filtrados por categoría.
    select p.id as animal_profile_id, p.idv, p.visual_id_alt, p.category_id, c.code, c.name
    from public.animal_profiles p
    join public.categories_by_system c on c.id = p.category_id
    where p.establishment_id = p_establishment_id
      and p.deleted_at is null
      and p.status = 'active'
      and (p_category_codes is null or c.code = any(p_category_codes))
  ),
  last_weight as (
    -- último pesaje no borrado por animal (entre los activos del establecimiento).
    select distinct on (w.animal_profile_id)
           w.animal_profile_id, w.weight_date
    from public.weight_events w
    join active_animals aa on aa.animal_profile_id = w.animal_profile_id
    where w.deleted_at is null
    order by w.animal_profile_id, w.weight_date desc, w.created_at desc
  )
  select aa.animal_profile_id, aa.idv, aa.visual_id_alt, aa.code, aa.name,
         lw.weight_date as last_weight_date,
         case when lw.weight_date is null then null else (current_date - lw.weight_date) end as days_since
  from active_animals aa
  left join last_weight lw on lw.animal_profile_id = aa.animal_profile_id
  where lw.weight_date is null                                        -- nunca pesado
     or lw.weight_date < current_date - p_threshold_days              -- pesaje viejo (date - int → date)
  order by aa.code, aa.idv;
end; $$;

comment on function public.establishment_unweighed is
  'Alerta de animales sin pesar (R7.11): activos sin weight_event o con último pesaje < hoy − p_threshold_days '
  '(default-MVP 180 d, parametrizado), filtrado por p_category_codes (sigue Facundo/D2). Read-only/STABLE, '
  'SECURITY DEFINER. M1: has_role_in(p_establishment_id) como 1ª sentencia. M2/M3: tenant/status/deleted_at por '
  'el join. M4: cota p_threshold_days [0,3650] + cardinality(p_category_codes) <= 64 (22023 fuera de rango).';

-- ============================================================================
-- (10) Grants/revokes + smoke-check fail-closed (R7.12.4, patrón 0105 (4))
-- ============================================================================
-- Las 9 funciones son READ-ONLY y tenant-scoped por el guard has_role_in al entrar. SECURITY DEFINER → la RLS no
-- las protege; el guard interno SÍ. Se exponen a authenticated; anon/public revocados.
revoke execute on function public.session_event_summary (uuid)                from public, anon;
revoke execute on function public.rodeo_sessions_list (uuid)                  from public, anon;
revoke execute on function public.rodeo_pregnancy_kpi (uuid, int)             from public, anon;
revoke execute on function public.rodeo_calving_kpi (uuid, int)              from public, anon;
revoke execute on function public.rodeo_ccl_distribution (uuid, int)         from public, anon;
revoke execute on function public.rodeo_calving_by_stage (uuid, int)         from public, anon;
revoke execute on function public.rodeo_weight_by_category (uuid, uuid)       from public, anon;
revoke execute on function public.establishment_overdue_doses (uuid, int, int) from public, anon;
revoke execute on function public.establishment_unweighed (uuid, int, text[]) from public, anon;

grant execute on function public.session_event_summary (uuid)                to authenticated;
grant execute on function public.rodeo_sessions_list (uuid)                  to authenticated;
grant execute on function public.rodeo_pregnancy_kpi (uuid, int)             to authenticated;
grant execute on function public.rodeo_calving_kpi (uuid, int)              to authenticated;
grant execute on function public.rodeo_ccl_distribution (uuid, int)         to authenticated;
grant execute on function public.rodeo_calving_by_stage (uuid, int)         to authenticated;
grant execute on function public.rodeo_weight_by_category (uuid, uuid)       to authenticated;
grant execute on function public.establishment_overdue_doses (uuid, int, int) to authenticated;
grant execute on function public.establishment_unweighed (uuid, int, text[]) to authenticated;

-- Smoke-check fail-closed: ninguna de las 9 RPC de reportes debe quedar EXECUTE-able por anon/public.
do $$
declare v_bad record;
begin
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname in (
        'session_event_summary','rodeo_sessions_list','rodeo_pregnancy_kpi','rodeo_calving_kpi',
        'rodeo_ccl_distribution','rodeo_calving_by_stage','rodeo_weight_by_category',
        'establishment_overdue_doses','establishment_unweighed'
      )
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (Stream C R7.12.4): % is EXECUTE-able by % (must be revoked from anon/public)', v_bad.proname, v_bad.rolname;
  end loop;
  raise notice 'grant check OK (Stream C R7.12.4): las 9 RPC de reportes revoked from anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
