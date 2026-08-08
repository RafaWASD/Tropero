-- 0130_campaign_close_rpcs.sql
-- Delta CAMPAÑAS CONGELADAS (spec 07) — D1 / DL1 / DL2 / DL4 / DL9 / DL10 / ①. Las 3 RPC nuevas:
-- close_campaign y reopen_campaign (ESCRITURA, guard is_owner_or_vet_of) y rodeo_campaign_status (LECTURA,
-- guard has_role_in — leer no cambia de rol, RCC.7.3).
--
-- Cubre: RCC.4.1–4.3, RCC.4.7, RCC.4.8.a, RCC.4.11, RCC.5.*, RCC.6.*, RCC.7.6, RCC.7.6.a, RCC.7.7, RCC.8.3,
-- RCC.9.2–9.4, RCC.9.8, RCC.9.11, RCC.9.12, RCC.11.10.
--
-- 🔴 NO se aplica al remoto desde acá. Va ÚLTIMA (0127 → 0128 → 0129 → 0130): close_campaign invoca las 5
-- RPC de KPI YA HISTÓRICAS; si se aplicara antes de 0129, un cierre congelaría los números viejos — que es
-- justamente el "solo snapshot" que ADR-032 §6 descarta.

begin;

-- ============================================================================
-- (1) close_campaign — la foto (D1 / DL2 / RCC.5.*)
-- ============================================================================
-- SECURITY DEFINER **VOLATILE** (sin STABLE) — el STABLE de §5.2 de 0106 NO aplica: esta función ESCRIBE.
-- Declararla STABLE dejaría a Postgres cachear/reordenar su ejecución. Que nadie "uniformice" el estilo con
-- las funciones de lectura.
--
-- `set search_path = public, pg_temp` con pg_temp ÚLTIMO Y EXPLÍCITO: Postgres busca pg_temp PRIMERO para
-- nombres de relación aunque no esté en el search_path, y la guía oficial de *Writing SECURITY DEFINER
-- Functions Safely* exige listarlo último. Este delta es el PRIMERO del repo que crea y lee tablas
-- temporales dentro de un DEFINER, así que el as-built dejó de cubrir el caso por accidente. No es
-- explotable hoy (authenticated solo llega por PostgREST, que no hace DDL, así que nadie puede pre-crear
-- pg_temp.animal_profiles), pero el blindaje cuesta una palabra. NO se "uniformiza" con el
-- `set search_path = public` de las funciones de lectura, que no usan temporales.
create or replace function public.close_campaign (
  p_rodeo_id uuid,
  p_year int,
  p_acknowledge_incomplete boolean default false
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_est uuid; v_months smallint[];
  v_state_as_of date; v_tacto_from date; v_tacto_to date;
  v_snap_id uuid;
  v_cfg record; v_denom record; v_preg record; v_calv record; v_ccl record; v_stage record; v_wean record;
  v_complete boolean; v_missing text;
  v_n_serviced int; v_n_pregnant int; v_n_empty int; v_n_calved int; v_n_weaned int;
begin
  -- (1) tenant desde la FILA DEL RODEO (nunca del cliente — RCC.9.3).
  select r.establishment_id, r.service_months into v_est, v_months
  from public.rodeos r where r.id = p_rodeo_id and r.deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;

  -- (2) GUARD — primera sentencia ejecutable tras derivar el tenant. Fail-closed, nunca un no-op silencioso.
  -- Escritura ⇒ guard MÁS ESTRICTO que el de lectura (punto ①): owner o veterinario ACTIVO. El
  -- field_operator recibe 42501.
  if not public.is_owner_or_vet_of(v_est) then
    raise exception 'not authorized to close this rodeo''s campaign' using errcode = '42501';
  end if;

  -- (3) cota de p_year tras el guard (§5.3).
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- (4) parámetros del cómputo: fecha de corte (DL6) + ventana del tacto (DL5).
  select * into v_cfg from public.rodeo_service_campaign(p_rodeo_id, p_year);
  v_state_as_of := coalesce(v_cfg.window_end, make_date(p_year, 12, 31));
  select b.tacto_from, b.tacto_to into v_tacto_from, v_tacto_to
    from public.campaign_tacto_bounds(v_months, p_year) b;

  -- (5) G1 — GUARD DURO, NO RECONOCIBLE (§4.2-bis): la fecha de corte todavía no ocurrió. No es "cerrar
  -- temprano": es cerrar ANTES DE QUE LA CAMPAÑA EXISTA — el conjunto servidas sería el presente proyectado
  -- al futuro, y cualquier vientre que entre al rodeo antes de que termine el servicio quedaría afuera para
  -- siempre. Por eso p_acknowledge_incomplete NO lo sortea: no hay foto incompleta que reconocer.
  if v_state_as_of > current_date then
    raise exception 'campaign service window has not ended yet (state_as_of %): nothing to freeze', v_state_as_of
      using errcode = '23514';
  end if;

  -- (6) idempotencia (RCC.5.6): ya cerrada → devolver el snapshot vigente SIN escribir.
  select s.id into v_snap_id from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if v_snap_id is not null then
    return v_snap_id;
  end if;

  -- (7) COMPUTAR TODO ANTES DE ESCRIBIR (RCC.5.5). El orden importa: si la cabecera se insertara primero,
  -- las propias funciones que este RPC invoca encontrarían el snapshot y devolverían la foto A MEDIO HACER.
  --
  -- Temporales con el patrón CREAR-O-TRUNCAR (Gate 1 M-3b): `on commit drop` limpia al COMMIT, no al salir
  -- de la función, así que un SEGUNDO close_campaign en la MISMA transacción moriría con 42P07 — que es
  -- exactamente lo que hace el runbook del re-seed (§9: dos rodeos, una transacción). Nombre calificado
  -- `pg_temp.*` y SIN SQL dinámico (§5.10 intacto).
  if to_regclass('pg_temp._snap_serviced') is null then
    create temp table _snap_serviced on commit drop as
      select * from public.rodeo_serviced_females(p_rodeo_id, p_year);
  else
    truncate pg_temp._snap_serviced;
    insert into pg_temp._snap_serviced select * from public.rodeo_serviced_females(p_rodeo_id, p_year);
  end if;

  if to_regclass('pg_temp._snap_tacto') is null then
    create temp table _snap_tacto on commit drop as
      select * from public.rodeo_campaign_tacto(p_rodeo_id, p_year);
  else
    truncate pg_temp._snap_tacto;
    insert into pg_temp._snap_tacto select * from public.rodeo_campaign_tacto(p_rodeo_id, p_year);
  end if;

  if to_regclass('pg_temp._snap_births') is null then
    create temp table _snap_births on commit drop as
      select * from public.rodeo_campaign_births(p_rodeo_id, p_year);
  else
    truncate pg_temp._snap_births;
    insert into pg_temp._snap_births select * from public.rodeo_campaign_births(p_rodeo_id, p_year);
  end if;

  if to_regclass('pg_temp._snap_calves') is null then
    create temp table _snap_calves on commit drop as
      select * from public.rodeo_campaign_calves(p_rodeo_id, p_year);
  else
    truncate pg_temp._snap_calves;
    insert into pg_temp._snap_calves select * from public.rodeo_campaign_calves(p_rodeo_id, p_year);
  end if;

  -- Los 5 KPI se persisten TAL CUAL los devuelve la lectura en vivo (DL2): la foto es, por construcción,
  -- igual al reporte que el productor estaba viendo cuando apretó el botón.
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  select * into v_preg  from public.rodeo_pregnancy_kpi   (p_rodeo_id, p_year);
  select * into v_calv  from public.rodeo_calving_kpi     (p_rodeo_id, p_year);
  select * into v_ccl   from public.rodeo_ccl_distribution(p_rodeo_id, p_year);
  select * into v_stage from public.rodeo_calving_by_stage(p_rodeo_id, p_year);
  select * into v_wean  from public.rodeo_weaning_kpi     (p_rodeo_id, p_year);

  -- (7-bis-α) G2 — GUARD DURO, NO RECONOCIBLE (RCC.5.7.e): un año sin UNA SOLA hembra servida no es una
  -- campaña incompleta, es una campaña INEXISTENTE; congelar "0 de 0" no es la foto de nada y contamina el
  -- benchmarking con años fantasma. Además es el piso que impide materializar ~126 snapshots por rodeo
  -- iterando p_year (campaign_cycle_complete da true para cualquier año vacío por la rama de los 18 meses),
  -- cada uno pagando la amplificación de §5.B W8.
  if v_denom.serviced = 0 then
    raise exception 'campaign % has no serviced females: nothing to freeze', p_year
      using errcode = '23514';
  end if;

  -- (7-bis) G3 — GATE DEL CICLO INCOMPLETO (F8), con los KPI ya en la mano y ANTES de escribir nada.
  -- El predicado NO se reimplementa acá: su dueño único es campaign_cycle_complete (0128), el mismo que
  -- expone rodeo_campaign_status.cycle_complete. Si divergieran, la app sugeriría cerrar algo que el cierre
  -- rechaza.
  v_complete := public.campaign_cycle_complete(v_wean.status, v_wean.pending_weaning, v_state_as_of);
  v_missing  := public.campaign_missing_summary(v_calv.status, v_calv.pending_pregnant,
                                                v_wean.status, v_wean.pending_weaning);
  if not v_complete and not coalesce(p_acknowledge_incomplete, false) then
    -- El mensaje ENUMERA qué falta (no es un "no se puede" pelado): el cliente lo muestra tal cual como
    -- fallback, y en el camino feliz arma el texto en es-AR desde rodeo_campaign_status.
    raise exception 'campaign cycle incomplete (%): close again acknowledging it to freeze it anyway', v_missing
      using errcode = '23514';
  end if;

  -- (8) cabecera. establishment_id = v_est: el MISMO valor que derivó el guard de la fila de `rodeos`,
  -- nunca del cliente (RCC.4.8.a).
  begin
    insert into public.rodeo_campaign_snapshots (
      rodeo_id, campaign_year, establishment_id,
      closed_by, closed_incomplete, missing_at_close,
      service_months, state_as_of, tacto_from, tacto_to,
      is_configured, n_months,
      serviced, retired, entoradas, pregnant, empty,
      calved, pending_pregnant, calving_status,
      ccl_head, ccl_body, ccl_tail, ccl_total,
      born_head, born_body, born_tail, born_total,
      weaned, pending_weaning, weaning_status
    ) values (
      p_rodeo_id, p_year, v_est,
      auth.uid(), not v_complete, case when v_complete then null else v_missing end,
      v_cfg.months, v_state_as_of, v_tacto_from, v_tacto_to,
      v_cfg.is_configured, v_cfg.n_months,
      v_denom.serviced, v_denom.retired, v_denom.entoradas, v_preg.pregnant, v_preg.empty,
      v_calv.calved, v_calv.pending_pregnant, v_calv.status,
      v_ccl.head, v_ccl.body, v_ccl.tail, v_ccl.total,
      v_stage.head_born, v_stage.body_born, v_stage.tail_born, v_stage.total_born,
      v_wean.weaned, v_wean.pending_weaning, v_wean.status
    )
    on conflict (rodeo_id, campaign_year) where reopened_at is null do nothing
    returning id into v_snap_id;
  exception when unique_violation then
    v_snap_id := null;   -- carrera (RCC.9.8): la resuelve el re-select de abajo.
  end;

  if v_snap_id is null then
    -- Otro cierre concurrente ganó la carrera: se devuelve el SUYO en vez de propagar el error de unicidad
    -- ni crear una segunda foto vigente (RCC.9.8, §5.B W6).
    select s.id into v_snap_id from public.rodeo_campaign_snapshots s
     where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
    return v_snap_id;
  end if;

  -- (9) detalle por animal — cinco `insert … select` desde las temporales, uno por bucket. El
  -- establishment_id sale de la FILA DE SNAPSHOT PADRE (v_est, el mismo que acaba de escribir la cabecera),
  -- NO de animal_profiles.establishment_id de cada animal (RCC.4.8.a): si un día un camino moviera un perfil
  -- de establecimiento in-place, tomarlo del animal desalinearía la RLS del detalle respecto de su cabecera.
  -- La FK compuesta lo vuelve estructural, pero la fuente correcta se escribe igual.
  insert into public.rodeo_campaign_snapshot_animals
    (snapshot_id, establishment_id, bucket, animal_profile_id, idv, source)
  select v_snap_id, v_est, 'serviced', t.animal_profile_id, p.idv, t.source
    from pg_temp._snap_serviced t
    left join public.animal_profiles p on p.id = t.animal_profile_id;

  insert into public.rodeo_campaign_snapshot_animals
    (snapshot_id, establishment_id, bucket, animal_profile_id, idv, pregnancy_status)
  select v_snap_id, v_est, 'pregnant', t.animal_profile_id, p.idv, t.pregnancy_status
    from pg_temp._snap_tacto t
    left join public.animal_profiles p on p.id = t.animal_profile_id
   where t.is_pregnant;

  insert into public.rodeo_campaign_snapshot_animals
    (snapshot_id, establishment_id, bucket, animal_profile_id, idv)
  select v_snap_id, v_est, 'empty', t.animal_profile_id, p.idv
    from pg_temp._snap_tacto t
    left join public.animal_profiles p on p.id = t.animal_profile_id
   where t.is_empty;

  insert into public.rodeo_campaign_snapshot_animals
    (snapshot_id, establishment_id, bucket, animal_profile_id, idv)
  select v_snap_id, v_est, 'calved', b.animal_profile_id, p.idv
    from pg_temp._snap_births b
    left join public.animal_profiles p on p.id = b.animal_profile_id;

  -- El sujeto del bucket `weaned` es la CRÍA, no la madre: por eso lleva mother_profile_id/mother_idv.
  -- `distinct on (calf)` para que el conteo del detalle coincida con el `count(distinct calf)` congelado
  -- (RCC.4.7) aunque una cría estuviera vinculada a dos partos.
  insert into public.rodeo_campaign_snapshot_animals
    (snapshot_id, establishment_id, bucket, animal_profile_id, idv, mother_profile_id, mother_idv)
  select distinct on (c.calf_profile_id)
         v_snap_id, v_est, 'weaned', c.calf_profile_id, pc.idv, c.mother_profile_id, pm.idv
    from pg_temp._snap_calves c
    left join public.animal_profiles pc on pc.id = c.calf_profile_id
    left join public.animal_profiles pm on pm.id = c.mother_profile_id
   where c.is_weaned
   order by c.calf_profile_id;

  -- (10) EL DETALLE Y LA CABECERA TIENEN QUE COINCIDIR — VERIFICADO, NO PROMETIDO (RCC.4.7, reviewer H-4).
  -- `design` §2.4 justifica el detalle diciendo que "sale del MISMO select que calculó el número". En el
  -- as-built NO es literalmente el mismo select: esta función es VOLATILE, así que en READ COMMITTED **cada
  -- sentencia toma un snapshot de transacción nuevo** — las 4 temporales se materializan en unas sentencias
  -- y los 5 KPI (que DL2/RCC.5.4 obligan a leer de las MISMAS RPC que la lectura en vivo) en otras. Si un
  -- `reproductive_events` concurrente commitea en el medio, el conteo del detalle y el número congelado
  -- pueden diferir en una fila, y el artefacto que ADR-032 presenta como "la evidencia del número" quedaría
  -- mintiendo para siempre, sin que nada lo note (TR.20 corre sobre un fixture quieto y no lo puede ver).
  -- En vez de declarar la ventana y convivir con ella, se cierra: si los dos lados no coinciden, el cierre
  -- ABORTA y la transacción entera se va (no queda snapshot). Cuesta un `count(*)` sobre las filas que
  -- acabamos de insertar, y convierte una carrera que acuña un artefacto inconsistente en una carrera que
  -- falla y se reintenta. `40001` (serialization_failure) es reintentable por contrato.
  select count(*) filter (where d.bucket = 'serviced'),
         count(*) filter (where d.bucket = 'pregnant'),
         count(*) filter (where d.bucket = 'empty'),
         count(*) filter (where d.bucket = 'calved'),
         count(*) filter (where d.bucket = 'weaned')
    into v_n_serviced, v_n_pregnant, v_n_empty, v_n_calved, v_n_weaned
    from public.rodeo_campaign_snapshot_animals d
   where d.snapshot_id = v_snap_id;

  if v_n_serviced <> v_denom.serviced or v_n_pregnant <> v_preg.pregnant or v_n_empty <> v_preg.empty
     or v_n_calved <> v_calv.calved or v_n_weaned <> v_wean.weaned then
    raise exception
      'snapshot inconsistente (dato concurrente durante el cierre): detalle %/%/%/%/% vs cabecera %/%/%/%/% (serviced/pregnant/empty/calved/weaned) — cierre abortado, reintentá',
      v_n_serviced, v_n_pregnant, v_n_empty, v_n_calved, v_n_weaned,
      v_denom.serviced, v_preg.pregnant, v_preg.empty, v_calv.calved, v_wean.weaned
      using errcode = '40001';
  end if;

  return v_snap_id;
end; $$;

comment on function public.close_campaign is
  'Congela la campaña (rodeo, año) en un snapshot y devuelve su id (ADR-032). SECURITY DEFINER VOLATILE '
  '(escribe: NO es STABLE) con search_path = public, pg_temp (pg_temp último y explícito porque crea y lee '
  'temporales). Guard is_owner_or_vet_of como primera sentencia tras derivar el tenant de la fila del rodeo '
  '(42501); cota de p_year (22023); rodeo inexistente (P0002). TRES gates duros, todos 23514: G1 la fecha de '
  'corte no ocurrió, G2 no hay hembras servidas, G3 el ciclo está incompleto. Solo G3 lo sortea '
  'p_acknowledge_incomplete —G1 y G2 son "no hay campaña", G3 es "la campaña existe pero está a medias"— y '
  'cuando lo hace queda persistido en closed_incomplete/missing_at_close. Computa TODO antes de escribir '
  '(si insertara la cabecera primero, las RPC que invoca devolverían la foto a medio hacer). Idempotente: '
  'una campaña ya cerrada devuelve su snapshot sin escribir, y una carrera devuelve el del que ganó. Sus '
  'ÚNICAS escrituras son las 2 tablas de snapshot (RCC.5.9).';

-- ============================================================================
-- (2) reopen_campaign (DL4 / RCC.6.*)
-- ============================================================================
-- `set search_path = public, pg_temp` por uniformidad de las DOS RPC de escritura (no usa temporales).
create or replace function public.reopen_campaign (p_rodeo_id uuid, p_year int)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_est uuid; v_snap_id uuid;
begin
  select r.establishment_id into v_est
  from public.rodeos r where r.id = p_rodeo_id and r.deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.is_owner_or_vet_of(v_est) then
    raise exception 'not authorized to reopen this rodeo''s campaign' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  select s.id into v_snap_id from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if v_snap_id is null then
    return null;   -- ya está abierta: idempotente, no falla (RCC.6.4).
  end if;

  -- DL4: no se reabre una campaña si la SIGUIENTE ya está cerrada (los números de la siguiente se computaron
  -- sobre un estado que esta reapertura invalidaría).
  if exists (select 1 from public.rodeo_campaign_snapshots s2
              where s2.rodeo_id = p_rodeo_id and s2.campaign_year = p_year + 1 and s2.reopened_at is null) then
    raise exception 'campaign % is already closed: reopen it first', p_year + 1 using errcode = '23514';
  end if;

  -- La fila y su detalle QUEDAN (RCC.6.3): rastro completo, sin lógica de borrado. Un re-cierre inserta un
  -- snapshot NUEVO (RCC.6.5); el índice único parcial lo permite porque el viejo ya no está vigente.
  update public.rodeo_campaign_snapshots
     set reopened_at = now(), reopened_by = auth.uid()
   where id = v_snap_id;

  return v_snap_id;
end; $$;

comment on function public.reopen_campaign is
  'Reabre la campaña (rodeo, año): marca reopened_at/reopened_by en el snapshot vigente SIN borrar la fila '
  'ni su detalle (DL4/RCC.6.3) y devuelve su id. Mismo guard (is_owner_or_vet_of) y mismas cotas que '
  'close_campaign. Devuelve null si ya estaba abierta (idempotente). Rechaza con 23514 si la campaña '
  'siguiente ya está cerrada. Un re-cierre crea un snapshot NUEVO y el anterior queda como historia.';

-- ============================================================================
-- (3) rodeo_campaign_status (lectura — RCC.7.6, 7.6.a, 7.7, RCC.8.3, RCC.9.12)
-- ============================================================================
-- SECURITY DEFINER STABLE con guard has_role_in: leer NO cambia de rol (RCC.7.3/W3). El field_operator ve el
-- estado de la campaña; lo que no puede es cerrarla ni reabrirla.
create or replace function public.rodeo_campaign_status (p_rodeo_id uuid, p_year int)
returns table (
  is_closed boolean, snapshot_id uuid, closed_at timestamptz, closed_by uuid, closed_by_name text,
  closed_incomplete boolean, missing_at_close text,
  service_months smallint[], n_months int, state_as_of date,
  pending_pregnant int, pending_weaning int, missing_summary text,
  can_close boolean, can_reopen boolean, cycle_complete boolean, has_new_data boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_snap public.rodeo_campaign_snapshots%rowtype;
  v_cfg record; v_calv record; v_wean record;
  v_can_write boolean; v_serviced int;
begin
  select r.establishment_id, r.service_months into v_est, v_months
  from public.rodeos r where r.id = p_rodeo_id and r.deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s campaign status' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  v_can_write := public.is_owner_or_vet_of(v_est);

  select s.* into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  is_closed := found;

  if is_closed then
    snapshot_id       := v_snap.id;
    closed_at         := v_snap.closed_at;
    closed_by         := v_snap.closed_by;
    -- RCC.9.12 / DP-28: el nombre sale de user_roles.member_name DE ESTE ESTABLECIMIENTO (ADR-026 c2,
    -- migración 0080), NUNCA de la tabla global `users`: leerla desde un SECURITY DEFINER abriría una
    -- lectura cross-tenant innecesaria, y el nombre que corresponde mostrar es el que ESA MEMBRESÍA conoce.
    -- El join NO filtra por `active`: el autor de un cierre tiene que seguir resolviendo aunque después deje
    -- el campo (es un rastro de auditoría).
    closed_by_name    := (select ur.member_name from public.user_roles ur
                           where ur.user_id = v_snap.closed_by and ur.establishment_id = v_est
                           limit 1);
    closed_incomplete := v_snap.closed_incomplete;
    missing_at_close  := v_snap.missing_at_close;
    service_months    := v_snap.service_months;     -- F5: los CONGELADOS, no los del rodeo de hoy
    n_months          := v_snap.n_months;
    state_as_of       := v_snap.state_as_of;
    pending_pregnant  := v_snap.pending_pregnant;
    pending_weaning   := v_snap.pending_weaning;
    missing_summary   := public.campaign_missing_summary(v_snap.calving_status, v_snap.pending_pregnant,
                                                         v_snap.weaning_status, v_snap.pending_weaning);
    cycle_complete    := public.campaign_cycle_complete(v_snap.weaning_status, v_snap.pending_weaning,
                                                        v_snap.state_as_of);
    v_serviced        := v_snap.serviced;
    -- DL10 / RCC.8.3: ¿llegó un dato DE LA CAMPAÑA después de la foto? Acotado al conjunto congelado de
    -- animales y a la ventana congelada del tacto → barato (índice reproductive_events (animal_profile_id,
    -- event_date desc)) y preciso para el caso que importa. LIMITACIÓN DECLARADA: no detecta un dato de un
    -- animal que NO estaba en el snapshot (una vaca que debió estar y nunca se cargó); cubrirlo exigiría
    -- recomputar el conjunto histórico en cada carga de pantalla.
    has_new_data := exists (
      select 1
        from public.rodeo_campaign_snapshot_animals d
        join public.reproductive_events e on e.animal_profile_id = d.animal_profile_id
       where d.snapshot_id = v_snap.id
         and e.deleted_at is null
         and e.created_at > v_snap.closed_at
         and e.event_date between v_snap.tacto_from and v_snap.tacto_to);
  else
    snapshot_id := null; closed_at := null; closed_by := null; closed_by_name := null;
    closed_incomplete := false; missing_at_close := null; has_new_data := false;

    select * into v_cfg  from public.rodeo_service_campaign(p_rodeo_id, p_year);
    select * into v_calv from public.rodeo_calving_kpi     (p_rodeo_id, p_year);
    select * into v_wean from public.rodeo_weaning_kpi     (p_rodeo_id, p_year);

    service_months   := v_cfg.months;
    n_months         := v_cfg.n_months;
    state_as_of      := coalesce(v_cfg.window_end, make_date(p_year, 12, 31));
    pending_pregnant := v_calv.pending_pregnant;
    pending_weaning  := v_wean.pending_weaning;
    missing_summary  := public.campaign_missing_summary(v_calv.status, v_calv.pending_pregnant,
                                                        v_wean.status, v_wean.pending_weaning);
    cycle_complete   := public.campaign_cycle_complete(v_wean.status, v_wean.pending_weaning, state_as_of);
    v_serviced       := v_wean.serviced;
  end if;

  -- RCC.7.6.a / DP-31: can_close refleja los TRES gates duros de close_campaign (rol · G1 · G2). El cliente
  -- distingue el 23514 RECONOCIBLE del que no lo es MIRANDO can_close (§5.C), no parseando el mensaje: si
  -- faltara G2, un rodeo sin servicio ofrecería "Cerrar campaña", fallaría, la UI mostraría "Cerrar igual
  -- con estos datos incompletos" y también fallaría → entrenaría al usuario a clickear el reconocimiento,
  -- que es justo el control que DP-10 existe para proteger. Costo cero: `serviced` ya vino de un KPI.
  can_close  := v_can_write and not is_closed and state_as_of <= current_date and coalesce(v_serviced, 0) > 0;
  can_reopen := v_can_write and is_closed
                and not exists (select 1 from public.rodeo_campaign_snapshots s2
                                 where s2.rodeo_id = p_rodeo_id and s2.campaign_year = p_year + 1
                                   and s2.reopened_at is null);

  return next;
end; $$;

comment on function public.rodeo_campaign_status is
  'Estado de la campaña (rodeo, año) para la pantalla de reportes: si está cerrada, cuándo, por quién '
  '(user_roles.member_name, NO la tabla global users), si se cerró a medias y qué faltaba, los '
  'service_months CONGELADOS (F5), qué falta hoy para completar el ciclo, y si el invocador puede cerrar y '
  'reabrir. SECURITY DEFINER STABLE con guard has_role_in (leer no cambia de rol). cycle_complete sale de '
  'campaign_cycle_complete —el MISMO predicado que usa el gate de close_campaign— y can_close refleja los '
  'TRES gates duros del cierre, para que la pantalla nunca ofrezca un cierre que el server va a rechazar.';

-- ============================================================================
-- (4) DL10, la otra mitad: AUSENCIA DE CÓDIGO (RCC.8.1, RCC.8.2)
-- ============================================================================
-- NO se agrega ningún trigger que rechace escrituras de una campaña cerrada. El dato de una campaña cerrada
-- que llega tarde SE ACEPTA (rechazarlo rompería el offline-first: el peón cargó bien, la sincronización
-- llegó tarde), no toca el snapshot, y la pantalla avisa vía has_new_data + ofrece reabrir. Se testea
-- explícitamente en TR.16.

-- ============================================================================
-- (5) Grants + smoke-check fail-closed (RCC.9.5, 9.6, 9.6.a — misma forma y misma lista que 0128/0129)
-- ============================================================================
do $$
declare
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
  v_missing text[] := '{}';
  v_sig text;
  v_oid oid;
  v_bad record;
begin
  -- Los revoke/grant salen del catálogo con la firma de identidad EXACTA. Ojo que close_campaign es
  -- (uuid, integer, boolean) y no (uuid, integer): un revoke/grant escrito a mano con la firma vieja falla
  -- con 42883 y deja la función con el default de Postgres (EXECUTE a PUBLIC — medido en esta base: una
  -- función recién creada tiene proacl NULL, o sea alcanzable por anon). Resolviendo la FIRMA con
  -- to_regprocedure, esa clase de error deja de existir: si la firma no resuelve, el loop (3) aborta.
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

  -- (3) CADA NOMBRE DE LA LISTA BLANCA TIENE QUE RESOLVER A ≥1 FUNCIÓN (reviewer H-5).
  --     Es el único hueco que los otros dos loops NO pueden cubrir, y no es teórico: una entrada con un
  --     TYPO cuyo nombre no matchee ninguno de los 4 prefijos queda fuera de los DOS loops —el (0) no le
  --     emite el `revoke` porque no la encuentra, el (1) no la barre porque el nombre real sí está en la
  --     lista, y el (2) itera sobre los oid encontrados, que no la incluyen— y la función nace con el ACL
  --     que le toque, sin que nada se ponga rojo. Hoy hay exactamente UNA función en la lista blanca que no
  --     matchea ningún prefijo: `is_owner_or_vet_of`.
  --     Este check vive SOLO en `0130` porque es la única de las tres migraciones en la que ya existen las
  --     14 (en `0128`/`0129` todavía no están creadas close_campaign/reopen_campaign/rodeo_campaign_status);
  --     como las tres listas son idénticas, verificar acá cubre el typo de las tres.
  foreach v_sig in array v_public loop
    if to_regprocedure('public.' || v_sig) is null then
      v_missing := v_missing || v_sig;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    raise exception 'grant check FAILED (RCC.9.6): la lista blanca nombra funciones que NO existen: % — '
      'un typo acá deja a la función real fuera de los dos loops', array_to_string(v_missing, ', ');
  end if;

  raise notice 'grant check OK (0130): las 14 de la lista blanca existen, están cerradas a anon/public, y las internas revocadas';
end$$;

-- Guard estructural de la volatilidad y el search_path de las 3 nuevas (RCC.9.2). Resuelve el VALOR del
-- catálogo, no el texto del cuerpo.
do $$
declare v_bad record;
begin
  for v_bad in
    select p.proname, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        (p.proname in ('close_campaign','reopen_campaign')
         and (p.provolatile = 's' or p.prosecdef is not true
              or coalesce(array_to_string(p.proconfig, ','), '') not like '%pg\_temp%'))
        or
        (p.proname = 'rodeo_campaign_status'
         and (p.provolatile <> 's' or p.prosecdef is not true
              or coalesce(array_to_string(p.proconfig, ','), '') not like '%search\_path%'))
      )
  loop
    raise exception 'contract check FAILED (RCC.9.2): % (volatile=%, cfg=%)',
      v_bad.proname, v_bad.provolatile, v_bad.cfg;
  end loop;
  raise notice 'contract check OK (0130): escrituras VOLATILE con pg_temp; status STABLE con search_path';
end$$;

notify pgrst, 'reload schema';

commit;
