-- 0129_reports_historical_compute.sql
-- Delta CAMPAÑAS CONGELADAS (spec 07) — F1 / F2 / F3 / F3-bis / F4 / F5 / DL3 / DL5 / DL6.
-- El corazón del delta: las 7 funciones de campaña pasan a (a) devolver la FOTO si la campaña está cerrada y
-- (b) computar el estado HISTÓRICO —el del cierre de la ventana de servicio— cuando está abierta. Se agregan
-- 3 set-functions internas para que cada concepto del dominio tenga UN SOLO dueño auditable.
--
-- Evidencia del defecto que esto tapa: `progress/repro_reportes-campanas-congeladas.md` (probes contra DEV).
-- Un tacto de la campaña siguiente movía 3 campos del reporte del año anterior; una venta, 7; una
-- transferencia de rodeo, 6; y un veredicto `no_apta` posterior hacía DESAPARECER la campaña (serviced: 0).
--
-- MOLDE (regla reference_function_recreate_base): el cuerpo VIGENTE EN EL REMOTO de cada una de las 7,
-- traído con pg_get_functiondef y verificado en T2. `rodeo_calving_kpi` viene de 0117 y `rodeo_weaning_kpi`
-- de 0118 — NO de 0106. Ninguna cambia su `returns table` → CREATE OR REPLACE (sin DROP, sin perder grants
-- ni romper el contrato del cliente). El guard, la cota y la derivación de v_est quedan TEXTUALMENTE como
-- estaban (§5.1/§5.3 de 0106 preservados).
--
-- Cubre: RCC.2.*, RCC.3.*, RCC.7.1–7.5, RCC.9.1, RCC.9.5, RCC.9.6, RCC.12.*.
--
-- 🔴 NO se aplica al remoto desde acá. Orden: 0127 → 0128 → 0129 → 0130 (0129 depende de la tabla de
-- membresía y de los helpers de 0128; si se aplicara antes de 0127, TODOS los reportes darían serviced = 0).
-- La suite supabase/tests/reports/run.cjs queda ROJA-HASTA-APPLY.

begin;

-- ============================================================================
-- (1) Capa 1 — set-functions INTERNAS: un dueño por concepto (§3.1, RCC.3.5–3.7)
-- ============================================================================
-- Hoy el "último tacto + regla de aborto" está copiado 4 veces (0106:242-266, 0117:62-79, 0117:101-127,
-- 0106:376-395) y la ventana de concepción del parto 5 veces (0117:84-94, 0117:119-127, 0106:466-476,
-- 0118:51-59, 0118:69-78). Agregar el filtro de ventana a mano en cada copia es la forma garantizada de que
-- en seis meses una quede vieja. Se bajan a una función por concepto.
--
-- Las tres son INTERNAS: revocadas de public, anon Y authenticated (RCC.9.5) → no alcanzables por PostgREST.
-- Igual llevan guard + cota del patrón: si algún día se les diera grant, no nacen desnudas.
-- NO cortocircuitan por snapshot: solo se invocan durante el cómputo en vivo o desde close_campaign, que por
-- construcción corre con la campaña abierta.

-- El ÚNICO lugar del "último tacto de la campaña + tacto+ vigente" (F1 / DL5 / RCC.3.3–3.5).
create or replace function public.rodeo_campaign_tacto (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, pregnancy_status text, event_date date,
               is_pregnant boolean, is_empty boolean)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid; v_months smallint[]; v_from date; v_to date;
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s campaign tacto' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select b.tacto_from, b.tacto_to into v_from, v_to
    from public.campaign_tacto_bounds(v_months, p_year) b;

  return query
  with last_tacto as (
    select distinct on (t.animal_profile_id)
           t.animal_profile_id, t.pregnancy_status::text as pregnancy_status, t.event_date, t.created_at
      from public.rodeo_serviced_females(p_rodeo_id, p_year) s
      join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
     where t.event_type = 'tacto' and t.deleted_at is null
       and t.event_date between v_from and v_to                        -- ← F1: la ventana que faltaba
     order by t.animal_profile_id, t.event_date desc, t.created_at desc
  )
  select lt.animal_profile_id, lt.pregnancy_status, lt.event_date,
         (lt.pregnancy_status is not null and lt.pregnancy_status <> 'empty'
          and not exists (select 1 from public.reproductive_events ab
                           where ab.animal_profile_id = lt.animal_profile_id
                             and ab.event_type = 'abortion' and ab.deleted_at is null
                             and ab.event_date between v_from and v_to   -- ← F1 (aborto acotado, DP-14)
                             and (ab.event_date, ab.created_at) > (lt.event_date, lt.created_at))),
         (lt.pregnancy_status = 'empty')
    from last_tacto lt;
end; $$;

comment on function public.rodeo_campaign_tacto is
  'INTERNA (revocada de public/anon/authenticated). ÚNICO dueño del "último tacto de la campaña + tacto+ '
  'vigente" (RCC.3.3-3.5). El tacto se acota a la ventana de campaña de DL5 (F1: antes no había filtro de '
  'fecha, así que un tacto de la campaña SIGUIENTE reescribía el % de preñez de la anterior). El `abortion` '
  'que revierte un tacto+ también se acota a la ventana (DP-14, [VALIDAR CON FACUNDO]). La consumen '
  'rodeo_pregnancy_kpi, rodeo_calving_kpi y rodeo_ccl_distribution: NO se vuelve a escribir la CTE.';

-- El ÚNICO lugar de "parto imputado a la campaña" (RCC.3.6). distinct on por concepción más temprana
-- (molde 0106:466-476) con la condición de set-membership de 0117:84-94.
create or replace function public.rodeo_campaign_births (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, birth_event_id uuid, birth_date date, conc_month int)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid; v_months smallint[];
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s campaign births' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  return query
  select distinct on (s.animal_profile_id)
         s.animal_profile_id,
         b.id,
         b.event_date,
         extract(month from (b.event_date - interval '9 months'))::int
    from public.rodeo_serviced_females(p_rodeo_id, p_year) s
    join public.reproductive_events b on b.animal_profile_id = s.animal_profile_id
   where b.event_type = 'birth' and b.deleted_at is null
     and v_months is not null and cardinality(v_months) >= 1
     and extract(year  from (b.event_date - interval '9 months'))::int = p_year
     and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
   order by s.animal_profile_id, (b.event_date - interval '9 months') asc, b.event_date asc;
end; $$;

comment on function public.rodeo_campaign_births is
  'INTERNA (revocada de public/anon/authenticated). ÚNICO dueño de "parto imputado a la campaña" (RCC.3.6): '
  'concepción = parto − 9 meses, año = p_year y mes ∈ service_months. UN parto por hembra (distinct on por '
  'concepción más temprana, molde 0106:466-476) → count(*) == `calved`, sin doble conteo de mellizos ni de '
  'partos repetidos. La consumen rodeo_calving_kpi, rodeo_calving_by_stage y rodeo_campaign_calves.';

-- El ÚNICO lugar de "cría de la campaña + destete" (RCC.3.7). Molde 0118:51-83.
create or replace function public.rodeo_campaign_calves (p_rodeo_id uuid, p_year int)
returns table (mother_profile_id uuid, calf_profile_id uuid, is_weaned boolean)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s campaign calves' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  return query
  select cb.animal_profile_id, bc.calf_profile_id,
         exists (select 1 from public.reproductive_events w
                  where w.animal_profile_id = bc.calf_profile_id
                    and w.event_type = 'weaning' and w.deleted_at is null)
    from public.rodeo_campaign_births(p_rodeo_id, p_year) cb
    join public.birth_calves bc on bc.birth_event_id = cb.birth_event_id;
end; $$;

comment on function public.rodeo_campaign_calves is
  'INTERNA (revocada de public/anon/authenticated). ÚNICO dueño del vínculo parto→cría→destete de la campaña '
  '(RCC.3.7). La consumen rodeo_weaning_kpi y el bucket `weaned` del detalle del snapshot. CONSECUENCIA '
  'DECLARADA de partir de rodeo_campaign_births (que es distinct-on por madre): si una madre tuviera DOS '
  'partos imputables a la misma campaña, solo cuentan las crías del de concepción más temprana — el as-built '
  'de 0118 contaba las de los dos, pero el de 0106 (by_stage) ya contaba un solo parto por madre. Se unifica '
  'en la convención de "un parto por hembra por campaña", que es la que sostiene calved == total_born.';

-- ============================================================================
-- (2) rodeo_serviced_females — el núcleo (§3.3, RCC.2.1–2.11, RCC.7.2)
-- ============================================================================
-- Cambios respecto del cuerpo vigente (0105:112-169), uno por fuga:
--   · p.rodeo_id = p_rodeo_id  →  join a rodeo_membership_history vigente a la fecha de corte     (F4)
--   · p.status = 'active'      →  ELIMINADO: la presencia la resuelve el intervalo de membresía   (F2)
--   · p.deleted_at is null     →  SE CONSERVA (RCC.2.5: borrado lógico = carga errónea, ≠ baja)
--   · c.id = p.category_id     →  animal_category_at(p.id, v_state_as_of)                         (F3)
--   · heifer_fitness sin cota  →  rv.event_date <= v_state_as_of                                  (F3)
--   · current_date - birth     →  v_state_as_of - birth_date                                      (F3-bis)
-- La frontera de TENANT sigue siendo `p.establishment_id = v_est` sobre animal_profiles (§5.5): el CTE
-- `member` filtra SOLO por mh.rodeo_id, sin filtro de tenant. Esa cláusula NO es redundante y no se saca.
-- (`animal_profiles.rodeo_id` tiene su propio guard de establecimiento —tg_animal_profiles_rodeo_check,
-- 0021:25-43, rechaza con 23514— así que el par cruzado no es alcanzable; pero la frontera de la query es
-- el filtro de establishment_id, y es la que hay que citar. Guard del invariante: TR.15.)
create or replace function public.rodeo_serviced_females (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, source text)
language plpgsql security definer stable set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_age_threshold_days int := 365;
  v_state_as_of date; v_snap uuid;
begin
  -- (1) tenant + guard + cota — IDÉNTICOS a 0105:101-110 (§5.1/§5.3).
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s serviced females' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- (2) DL3 — campaña CERRADA: se devuelve la foto y no se computa NADA. Va DESPUÉS del guard y de la cota:
  -- si estuviera antes, cualquier authenticated con un rodeo_id ajeno se llevaría el detalle por animal de
  -- un campo ajeno con la RLS en verde (las funciones son SECURITY DEFINER). Oráculo: TR.21.
  select s.id into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if v_snap is not null then
    return query
      select d.animal_profile_id, d.source
        from public.rodeo_campaign_snapshot_animals d
       where d.snapshot_id = v_snap and d.bucket = 'serviced'
       order by d.idv nulls last, d.animal_profile_id;
    return;
  end if;

  -- (3) DL6 — fecha de corte del estado histórico: último día del mayor mes de servicio del año; sin meses
  -- configurados, el 31/12 (DP-18).
  v_state_as_of := coalesce(
    (select c.window_end from public.rodeo_service_campaign(p_rodeo_id, p_year) c),
    make_date(p_year, 12, 31));

  -- (4) cómputo histórico (natural ∪ IA, DISTINCT).
  return query
  with member as (           -- ← F4 + F2 en UN predicado (DP-4)
    select mh.animal_profile_id
      from public.rodeo_membership_history mh
     where mh.rodeo_id = p_rodeo_id
       and mh.from_date <= v_state_as_of
       and (mh.to_date is null or mh.to_date > v_state_as_of)
  ),
  eligible_natural as (
    select distinct p.id as animal_profile_id, 'natural'::text as source
      from public.animal_profiles p
      join member m on m.animal_profile_id = p.id
      join public.animals a on a.id = p.animal_id
      join public.categories_by_system c
        on c.id = public.animal_category_at(p.id, v_state_as_of)     -- ← F3
     where p.establishment_id = v_est          -- §5.5: tenant por el JOIN a animal_profiles. NO SACAR.
       and p.deleted_at is null
       and a.sex = 'female'
       and v_months is not null and cardinality(v_months) >= 1
       and (
         c.code in ('vaquillona_prenada','vaca_segundo_servicio','multipara','vaca_cabana')
         or (
           c.code = 'vaquillona'
           and (
             (select rv.heifer_fitness from public.reproductive_events rv
                where rv.animal_profile_id = p.id and rv.event_type = 'tacto_vaquillona'
                  and rv.deleted_at is null
                  and rv.event_date <= v_state_as_of                       -- ← F3
                order by rv.event_date desc, rv.created_at desc limit 1) = 'apta'
             or (
               not exists (select 1 from public.reproductive_events rv
                            where rv.animal_profile_id = p.id
                              and rv.event_type = 'tacto_vaquillona'
                              and rv.deleted_at is null
                              and rv.event_date <= v_state_as_of)          -- ← F3
               and a.birth_date is not null
               and (v_state_as_of - a.birth_date) >= v_age_threshold_days  -- ← F3-bis
             )
           )
         )
       )
  ),
  ai_females as (
    select distinct p.id as animal_profile_id, 'ai'::text as source
      from public.animal_profiles p
      join member m on m.animal_profile_id = p.id
      join public.animals a on a.id = p.animal_id
      join public.reproductive_events rv on rv.animal_profile_id = p.id
     where p.establishment_id = v_est
       and p.deleted_at is null
       and a.sex = 'female'
       and rv.event_type = 'service' and rv.service_type = 'ai'
       and rv.deleted_at is null
       and extract(year from rv.event_date)::int = p_year
       and (v_months is null or extract(month from rv.event_date)::int = any(v_months))
  )
  select distinct on (u.animal_profile_id) u.animal_profile_id, u.source
    from (select * from eligible_natural union all select * from ai_females) u
   order by u.animal_profile_id, (u.source = 'natural') desc;
end; $$;

comment on function public.rodeo_serviced_females is
  'Conjunto SERVIDAS de una campaña (rodeo, año) — el ÚNICO lugar donde se expresa la elegibilidad del '
  'denominador (§5.7 de 0106, RCC.2.11). Delta campañas congeladas: con snapshot vigente devuelve el bucket '
  '`serviced` del detalle CONGELADO (RCC.7.2 — es pública y con grant, así que en vivo contradiría los KPI '
  'congelados que la pantalla muestra al lado); sin snapshot computa el estado HISTÓRICO a la fecha de corte '
  'de la campaña: membresía de rodeo por rodeo_membership_history (F4), categoría por animal_category_at '
  '(F3), aptitud de vaquillona y fallback por edad evaluados al corte (F3/F3-bis). NOTA DE COMPORTAMIENTO '
  '(F2): una vaca vendida hoy VUELVE A APARECER en las campañas en las que estaba en el rodeo al cierre de '
  'la ventana. Ese es el fix, no una regresión.';

-- ============================================================================
-- (3) rodeo_repro_denominator (§3.4, RCC.2.12, F7)
-- ============================================================================
create or replace function public.rodeo_repro_denominator (p_rodeo_id uuid, p_year int)
returns table (serviced int, retired int, entoradas int)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid; v_snap public.rodeo_campaign_snapshots%rowtype;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s denominator' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- DL3 — cortocircuito por snapshot, DESPUÉS del guard y de la cota.
  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if found then
    serviced := v_snap.serviced; retired := v_snap.retired; entoradas := v_snap.entoradas;
    return next; return;
  end if;

  serviced  := (select count(*)::int from public.rodeo_serviced_females(p_rodeo_id, p_year));
  -- F7: con el conjunto servidas evaluado a la FECHA DE CORTE, "retirada" ya no es computable sobre él —
  -- toda baja posterior al corte es posterior a la campaña, y las anteriores nunca entraron. Se devuelve 0
  -- explícito para no reintroducir un número dependiente de HOY en un reporte histórico. La columna se
  -- conserva solo por compatibilidad de contrato; la redefinición real de `entoradas` está anotada en
  -- docs/backlog.md (RCC.2.12).
  retired   := 0;
  entoradas := serviced;
  return next;
end; $$;

comment on function public.rodeo_repro_denominator is
  'Denominador explícito de la campaña. Delta campañas congeladas: con snapshot vigente devuelve los tres '
  'números congelados; sin snapshot, serviced = count(rodeo_serviced_females) y retired = 0 / entoradas = '
  'serviced (F7/RCC.2.12 — el conjunto servidas ya está evaluado a la fecha de corte, así que no hay '
  '"retiradas de la campaña" que contar sobre él). La redefinición de `entoradas` queda en docs/backlog.md.';

-- ============================================================================
-- (4) rodeo_pregnancy_kpi (molde: cuerpo vigente de 0106:216-269)
-- ============================================================================
create or replace function public.rodeo_pregnancy_kpi (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, serviced int, entoradas int, pregnant int, empty int)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid; v_cfg record; v_denom record; v_snap public.rodeo_campaign_snapshots%rowtype;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s pregnancy kpi' using errcode = '42501';
  end if;
  -- cota de p_year tras el guard (§5.3).
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if found then
    is_configured := v_snap.is_configured; serviced := v_snap.serviced; entoradas := v_snap.entoradas;
    pregnant := v_snap.pregnant; empty := v_snap.empty;
    return next; return;
  end if;

  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;
  entoradas     := v_denom.entoradas;

  -- numerador: del conjunto servidas, las con tacto+ vigente / vacías. La CTE `last_tacto` local se BORRÓ:
  -- su dueño es rodeo_campaign_tacto (RCC.3.5).
  select coalesce(sum(case when ct.is_pregnant then 1 else 0 end), 0)::int,
         coalesce(sum(case when ct.is_empty    then 1 else 0 end), 0)::int
    into pregnant, empty
    from public.rodeo_campaign_tacto(p_rodeo_id, p_year) ct;

  return next;
end; $$;

-- ============================================================================
-- (5) rodeo_calving_kpi (molde: cuerpo vigente de 0117 — NO 0106)
-- ============================================================================
create or replace function public.rodeo_calving_kpi (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, serviced int, entoradas int, pregnant int, calved int,
               status text, pending_pregnant int)
language plpgsql security definer stable set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_cfg record; v_denom record;
  v_window_start date; v_snap public.rodeo_campaign_snapshots%rowtype;
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

  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if found then
    is_configured := v_snap.is_configured; serviced := v_snap.serviced; entoradas := v_snap.entoradas;
    pregnant := v_snap.pregnant; calved := v_snap.calved;
    status := v_snap.calving_status; pending_pregnant := v_snap.pending_pregnant;
    return next; return;
  end if;

  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;
  entoradas     := v_denom.entoradas;

  -- Los tres numeradores salen de UNA sola invocación de cada set-function interna. Las CTE van
  -- `as materialized` a propósito: un `not exists (select … from f(…))` correlacionado puede hacer que el
  -- planner re-ejecute la función POR FILA, y cada re-ejecución arrastra otro rodeo_serviced_females entero
  -- (§5.B W8). Con la materialización, el costo queda en una pasada por concepto.
  -- Las FÓRMULAS no cambian (RCC.3.8): `calved` sigue siendo "hembras servidas con ≥1 parto imputado a la
  -- campaña" (un parto por hembra → count(*) == count(distinct madre)) y `pending_pregnant` sigue siendo
  -- "preñadas vigentes que todavía no parieron". Cambia de dónde salen los conjuntos.
  with tac as materialized (select * from public.rodeo_campaign_tacto (p_rodeo_id, p_year)),
       bir as materialized (select * from public.rodeo_campaign_births(p_rodeo_id, p_year))
  select coalesce(sum(case when t.is_pregnant then 1 else 0 end), 0)::int,
         (select count(*)::int from bir),
         coalesce(sum(case when t.is_pregnant
                            and not exists (select 1 from bir b
                                             where b.animal_profile_id = t.animal_profile_id)
                           then 1 else 0 end), 0)::int
    into pregnant, calved, pending_pregnant
    from tac t;

  if v_months is null or cardinality(v_months) < 1 then
    status := 'no_service_months';
  elsif cardinality(v_months) = 12 then
    status := 'not_applicable_12m';
  else
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

-- ============================================================================
-- (6) rodeo_ccl_distribution (molde: cuerpo vigente de 0106:358-404)
-- ============================================================================
create or replace function public.rodeo_ccl_distribution (p_rodeo_id uuid, p_year int)
returns table (n_months int, head int, body int, tail int, total int)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid; v_cfg record; v_snap public.rodeo_campaign_snapshots%rowtype;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s ccl distribution' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if found then
    -- F5: n_months CONGELADO. Si se leyera del rodeo de hoy, editar la estación de servicio cambiaría el
    -- número de barras de una campaña ya cerrada.
    n_months := v_snap.n_months; head := v_snap.ccl_head; body := v_snap.ccl_body;
    tail := v_snap.ccl_tail; total := v_snap.ccl_total;
    return next; return;
  end if;

  select * into v_cfg from public.rodeo_service_campaign(p_rodeo_id, p_year);
  n_months := v_cfg.n_months;

  select coalesce(sum(case when ct.pregnancy_status = 'large'  then 1 else 0 end), 0)::int,
         coalesce(sum(case when ct.pregnancy_status = 'medium' then 1 else 0 end), 0)::int,
         coalesce(sum(case when ct.pregnancy_status = 'small'  then 1 else 0 end), 0)::int,
         count(*)::int
    into head, body, tail, total
    from public.rodeo_campaign_tacto(p_rodeo_id, p_year) ct
   where ct.is_pregnant;   -- solo las PREÑADAS (tacto+ vigente), igual que 0106:215-226

  return next;
end; $$;

-- ============================================================================
-- (7) rodeo_calving_by_stage (molde: cuerpo vigente de 0106:419-499)
-- ============================================================================
-- El bucketing por tercios NO cambia (RCC.3.8): cambia de dónde salen los partos.
create or replace function public.rodeo_calving_by_stage (p_rodeo_id uuid, p_year int)
returns table (n_months int, head_born int, body_born int, tail_born int, total_born int)
language plpgsql security definer stable set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_n int; v_start int;
  v_snap public.rodeo_campaign_snapshots%rowtype;
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

  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if found then
    n_months := v_snap.n_months; head_born := v_snap.born_head; body_born := v_snap.born_body;
    tail_born := v_snap.born_tail; total_born := v_snap.born_total;
    return next; return;
  end if;

  v_n := coalesce(cardinality(v_months), 0);
  n_months := v_n;

  -- sin distinción de etapas (0/1/12 meses) → todo 0 (la UI no muestra el cruce). Espejo de calving-stage.ts.
  if v_n < 2 or v_n >= 12 then
    head_born := 0; body_born := 0; tail_born := 0; total_born := 0;
    return next; return;
  end if;

  -- inicio del run de servicio EN ORDEN DE SERVICIO (con wrap): el mes JUSTO DESPUÉS del único hueco
  -- circular grande (espejo de serviceRunBounds de service-months.ts).
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

  with positioned as (
    select ((cb.conc_month - v_start) % 12 + 12) % 12 as pos
      from public.rodeo_campaign_births(p_rodeo_id, p_year) cb
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

-- ============================================================================
-- (8) rodeo_weaning_kpi (molde: cuerpo vigente de 0118 — NO 0106)
-- ============================================================================
create or replace function public.rodeo_weaning_kpi (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, serviced int, weaned int, pending_weaning int, status text)
language plpgsql security definer stable set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_cfg record; v_denom record;
  v_snap public.rodeo_campaign_snapshots%rowtype;
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s weaning kpi' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if found then
    is_configured := v_snap.is_configured; serviced := v_snap.serviced; weaned := v_snap.weaned;
    pending_weaning := v_snap.pending_weaning; status := v_snap.weaning_status;
    return next; return;
  end if;

  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;

  -- weaned / pending_weaning de UNA sola pasada sobre el dueño único del vínculo parto→cría→destete.
  select coalesce(count(distinct cc.calf_profile_id) filter (where cc.is_weaned), 0)::int,
         coalesce(count(distinct cc.calf_profile_id) filter (where not cc.is_weaned), 0)::int
    into weaned, pending_weaning
    from public.rodeo_campaign_calves(p_rodeo_id, p_year) cc;

  -- status data-driven (CD-2 de 0118) — NO cambia.
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

-- ============================================================================
-- (9) Grants + smoke-check fail-closed (RCC.9.5, RCC.9.6, RCC.9.6.a — misma forma que 0128)
-- ============================================================================
-- CREATE OR REPLACE preserva privilegios, así que las 7 públicas conservan su grant; las 3 internas nuevas
-- nacen con EXECUTE a PUBLIC (MEDIDO: una función recién creada tiene proacl NULL → built-in → PUBLIC;
-- ver el bloque de premisa de 0128) y hay que revocarlas: es load-bearing. Se re-emite todo igual (el
-- smoke-check verifica el ESTADO FINAL en vez de confiar en la semántica de CREATE OR REPLACE).
revoke execute on function public.rodeo_campaign_tacto  (uuid, int) from public, anon, authenticated;
revoke execute on function public.rodeo_campaign_births (uuid, int) from public, anon, authenticated;
revoke execute on function public.rodeo_campaign_calves (uuid, int) from public, anon, authenticated;

do $$
declare
  -- ÚNICA enumeración de la migración (misma lista que 0128 y 0130).
  -- ÚNICA enumeración de la migración, y **POR FIRMA, NO POR NOMBRE** (misma lista que 0128 — ver el
  -- comentario largo de ahí: con la lista por nombre, una sobrecarga futura de una pública se auto-concede
  -- a `authenticated` en el loop (0) y encima queda fuera del barrido de internas).
  v_public constant text[] := array[
    'close_campaign(uuid,integer,boolean)',   -- ojo: 3 parámetros, no 2
    'reopen_campaign(uuid,integer)',
    'rodeo_campaign_status(uuid,integer)',
    'rodeo_service_campaign(uuid,integer)',
    'rodeo_serviced_females(uuid,integer)',
    'rodeo_repro_denominator(uuid,integer)',
    'rodeo_pregnancy_kpi(uuid,integer)',
    'rodeo_calving_kpi(uuid,integer)',
    'rodeo_ccl_distribution(uuid,integer)',
    'rodeo_calving_by_stage(uuid,integer)',
    'rodeo_weaning_kpi(uuid,integer)',
    'rodeo_sessions_list(uuid)',
    'rodeo_weight_by_category(uuid,uuid)',
    'is_owner_or_vet_of(uuid)'
  ];
  v_ns constant text[] := array['rodeo\_%','campaign\_%','close\_%','reopen\_%'];
  v_oids oid[] := '{}';
  v_sig text;
  v_oid oid;
  v_bad record;
begin
  -- (0) Resolver CADA FIRMA a su función y emitir el revoke/grant SOBRE ESA función. El statement se arma
  --     con `%s` sobre `regprocedure`, que imprime la función ya identificada por el catálogo: no depende de
  --     la gramática de nombres de parámetro ni puede alcanzar a otra sobrecarga.
  foreach v_sig in array v_public loop
    v_oid := to_regprocedure('public.' || v_sig);
    if v_oid is not null then
      execute format('revoke execute on function %s from public, anon', v_oid::regprocedure);
      execute format('grant  execute on function %s to authenticated',  v_oid::regprocedure);
      v_oids := v_oids || v_oid;
    end if;
  end loop;

  for v_bad in
    select p.oid::regprocedure::text as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public','authenticated']) as rolname) r
    where n.nspname = 'public'
      and (p.proname like any (v_ns) or p.proname = 'animal_category_at')
      and not (p.oid = any (v_oids))          -- por OID, no por nombre (M-C2)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RCC.9.6): % is EXECUTE-able by % (internal → must be revoked)',
      v_bad.fn, v_bad.rolname;
  end loop;

  -- (2) PÚBLICAS: la otra mitad de §5.8. ⚠ Viniendo después del loop (0), que acaba de revocarlas, NO es un
  --     oráculo independiente: verifica el ESTADO FINAL (reviewer H-5). Lo que verifica sí es load-bearing:
  --     con el default real de esta base (proacl NULL = EXECUTE a PUBLIC, medido — ver 0128), una pública sin
  --     su `revoke` queda invocable por `anon`. El typo en una FIRMA de la lista lo cierran el loop (1) (la
  --     función real cae en el barrido) y el loop (3) de `0130`, que la nombra.
  for v_bad in
    select p.oid::regprocedure::text as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.oid = any (v_oids)                -- por OID, no por nombre (M-C2)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RCC.9.6.a): % is EXECUTE-able by % (public RPC → must be revoked from anon/public)',
      v_bad.fn, v_bad.rolname;
  end loop;

  raise notice 'grant check OK (0129): 7 públicas concedidas a authenticated, 3 internas revocadas de los tres roles';
end$$;

-- Guard estructural del contrato de las 7 (RCC.7.5, RCC.9.1): CREATE OR REPLACE ya habría fallado si alguna
-- cambiara su `returns table`, y acá se verifica que ninguna perdió SECURITY DEFINER, STABLE ni search_path.
do $$
declare
  v_read constant text[] := array['rodeo_serviced_females','rodeo_repro_denominator','rodeo_pregnancy_kpi',
                                  'rodeo_calving_kpi','rodeo_ccl_distribution','rodeo_calving_by_stage',
                                  'rodeo_weaning_kpi','rodeo_campaign_tacto','rodeo_campaign_births',
                                  'rodeo_campaign_calves'];
  v_bad record;
begin
  for v_bad in
    select p.proname, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_read)
      and (p.prosecdef is not true or p.provolatile <> 's'
           or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%')
  loop
    raise exception 'contract check FAILED (RCC.9.1): % (secdef=%, volatile=%, cfg=%)',
      v_bad.proname, v_bad.prosecdef, v_bad.provolatile, v_bad.cfg;
  end loop;
  raise notice 'contract check OK (0129): las 10 funciones de lectura siguen SECURITY DEFINER STABLE con search_path';
end$$;

notify pgrst, 'reload schema';

commit;
