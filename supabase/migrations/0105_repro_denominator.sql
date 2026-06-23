-- 0105_repro_denominator.sql  (spec 02 — Stream A, RPS.5)
-- Contrato de derivación del denominador reproductivo (servidas/entoradas) que consume Stream C (spec 07).
-- Read-only (RPS.5.9). Tenant-scoped (RPS.5.6). 3 funciones SECURITY DEFINER STABLE + guard has_role_in(est
-- del rodeo) al entrar (patrón 0066/0041) + cota de p_year tras el guard (RPS.5.10) + revoke/grant + smoke-check.
--
-- DD-PS-5: función(es) SQL parametrizadas por (p_rodeo_id, p_year), NO vista plana — el denominador es "de
-- esta campaña" (rodeo+año); la función centraliza authz + lógica de elegibilidad en un lugar auditable.
--
-- [FIRME] (de Stream A): unión distinct natural∪IA; elegibilidad = aptitud+ventana (NO categoría sola);
--   fallback por edad; tenant-scoping. [TENTATIVO] (Stream C/spec 07 afina): ventana temporal de "retirada",
--   cruce de fin de año (se trata la campaña como CONJUNTO de meses, no rango contiguo con wrap), umbral de
--   "edad de servicio" del fallback (365d), membresía histórica (se usa membresía ACTUAL del rodeo).
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el leader por Management API tras Gate 1 (PASS) + reviewer +
-- Gate 2 + Puerta 2 + autorización de Raf. Depende de 0102 (columna service_months). La suite
-- supabase/tests/puesta-en-servicio/run.cjs FALLA hasta el apply — ESPERADO (patrón 0075-0082 / 0093-0097).

begin;

-- ============================================================================
-- (1) Ventana de campaña — rodeo_service_campaign (RPS.5.8, RPS.2.3, RPS.5.6 parte)
-- ============================================================================
-- Deriva la ventana de service_months + p_year. window_start = primer día del menor mes de servicio del año;
-- window_end = último día del mayor mes. [TENTATIVO] Cruce de fin de año (ej. service_months={12,1,2}): el MVP
-- trata la campaña como el CONJUNTO de meses {12,1,2} del año p_year (NO un rango contiguo) → la pertenencia
-- se evalúa por "mes del evento/membresía ∈ service_months", NO por un BETWEEN de fechas. Así Dic+Ene+Feb
-- cuentan sin lógica de wrap. window_start/window_end se exponen como ayuda de DISPLAY; la pertenencia REAL
-- usa el conjunto de meses (ver función 2). Stream C confirma si necesita el rango contiguo con wrap.
create or replace function public.rodeo_service_campaign (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, n_months int, months smallint[], window_start date, window_end date)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_months smallint[];
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;
  -- GUARD tenant (RPS.5.6): cualquier rol del establecimiento puede LEER el denominador (reportes).
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s campaign' using errcode = '42501';
  end if;
  -- Cota de p_year (RPS.5.10, Gate 1 MEDIUM-1) — DESPUÉS del guard de tenant. Las OTRAS DOS funciones de
  -- derivación replican este mismo check tras su guard. Evita que make_date(p_year, ...) reciba años absurdos.
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  is_configured := v_months is not null;                       -- RPS.2.3
  n_months      := coalesce(cardinality(v_months), 0);
  months        := v_months;
  if v_months is null or cardinality(v_months) = 0 then
    window_start := null; window_end := null;                  -- sin configurar / sin meses → sin ventana
  else
    window_start := make_date(p_year, (select min(m) from unnest(v_months) m)::int, 1);
    window_end   := (make_date(p_year, (select max(m) from unnest(v_months) m)::int, 1)
                     + interval '1 month - 1 day')::date;
  end if;
  return next;
end; $$;

comment on function public.rodeo_service_campaign is
  'Ventana de campaña de un rodeo en un año (RPS.5.8). Read-only/STABLE, SECURITY DEFINER con guard '
  'has_role_in(est del rodeo) + cota de p_year (1900..current+1, RPS.5.10). Devuelve is_configured (RPS.2.3, '
  'NULL = sin configurar), n_months (insumo de bucketing CCL para Stream C), months, y window_start/window_end '
  '(DISPLAY; la pertenencia real usa el conjunto de meses). Cruce de fin de año = conjunto de meses, sin wrap.';

-- ============================================================================
-- (2) Servidas — rodeo_serviced_females (RPS.5.1, .2, .3, .4, .7, .9)
-- ============================================================================
-- Conjunto SERVIDAS de un rodeo en una campaña = UNIÓN DISTINCT (RPS.5.7) de:
--   (a) NATURAL: vientres del rodeo elegibles + rodeo con ventana activa ese año (service_months no vacío).
--       Elegibilidad (RPS.5.2, Gate 0 §2/§3 — aptitud+ventana, NO categoría sola):
--         - PROBADAMENTE SERVIDAS → elegibles SIN gate de aptitud (su categoría prueba el servicio):
--           vaquillona_prenada (concibió en 1er servicio), vaca_segundo_servicio, multipara, vaca_cabana.
--           [FIX veto leader 2026-06-23: vaquillona_prenada estaba OMITIDA → una vaquillona de 1er servicio
--            que concebía SALÍA del denominador al diagnosticarse preñada → inflaba %preñez/%parición.]
--         - vaquillonas APTAS aún no diagnosticadas (último heifer_fitness='apta', RPS.5.3) → CON gate;
--         - FALLBACK por edad (RPS.5.4): vaquillona de edad de servicio SIN veredicto de aptitud registrado
--           → elegible (para no dejar fuera al campo que no tactea aptitud).
--         - NO_APTA / DIFERIDA vigente → NO elegible por aptitud (RPS.6.2), y NO cae al fallback (tiene
--           veredicto registrado, distinto de "sin chequeo").
--   (b) AI: hembras del rodeo con un evento de inseminación (event_type='service' AND service_type='ai', no
--       borrado) cuyo event_date cae en un mes de la campaña (RPS.5.1). La IA NO se toca (per-vaca, intacta).
--   DISTINCT por animal_profile_id → una hembra en ambas ramas cuenta UNA vez (RPS.5.7).
--
-- [TENTATIVO] "presente durante la ventana": el MVP toma la MEMBRESÍA ACTUAL del rodeo (animal_profiles.
-- rodeo_id = p_rodeo_id, status='active', deleted_at IS NULL). El historial de membresía por fecha NO se
-- modela en MVP (no hay tabla de historia de rodeo_id; transferencia = UPDATE in-place, spec 11). La "edad de
-- servicio" para el fallback (RPS.5.4) se parametriza como umbral en días [TENTATIVO: 365 = corte de edad de
-- categoría]. CUT: se DEJA FUERA del set incondicional (TENTATIVO) — una CUT post-parto en el rodeo no se
-- re-sirve, y como el MVP usa membresía+ventana ACTUAL, incluirla la contaría en campañas donde no se la
-- sirvió. Stream C/Facundo afinan.
create or replace function public.rodeo_serviced_females (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, source text)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_months smallint[]; v_age_threshold_days int := 365;
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s serviced females' using errcode = '42501';
  end if;
  -- Cota de p_year (RPS.5.10) — DESPUÉS del guard de tenant.
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  return query
  with eligible_natural as (
    -- (a) servicio natural: solo si el rodeo tiene ventana ese año (months no vacío). Rodeo NULL/{} → vacío.
    select distinct p.id as animal_profile_id, 'natural'::text as source
    from public.animal_profiles p
    join public.animals a on a.id = p.animal_id
    join public.categories_by_system c on c.id = p.category_id
    where p.rodeo_id = p_rodeo_id
      and p.establishment_id = v_est          -- tenant (defensa; ya derivado)
      and p.status = 'active'
      and p.deleted_at is null
      and a.sex = 'female'
      and v_months is not null and cardinality(v_months) >= 1   -- ventana activa (RPS.2.2)
      and (
        -- probadamente servidas: elegibles SIN gate (vaquillona_prenada incluida — fix veto leader 2026-06-23)
        c.code in ('vaquillona_prenada','vaca_segundo_servicio','multipara','vaca_cabana')
        or (
          c.code = 'vaquillona'
          and (
            -- APTA: último veredicto = 'apta' (RPS.5.3)
            (select rv.heifer_fitness from public.reproductive_events rv
               where rv.animal_profile_id = p.id and rv.event_type = 'tacto_vaquillona'
                 and rv.deleted_at is null
               order by rv.event_date desc, rv.created_at desc limit 1) = 'apta'
            -- FALLBACK por edad (RPS.5.4): SIN veredicto registrado + edad de servicio
            or (
              not exists (select 1 from public.reproductive_events rv
                          where rv.animal_profile_id = p.id and rv.event_type = 'tacto_vaquillona'
                            and rv.deleted_at is null)
              and a.birth_date is not null and (current_date - a.birth_date) >= v_age_threshold_days
            )
          )
        )
      )
  ),
  ai_females as (
    -- (b) IA per-vaca (no se toca): event_type='service' AND service_type='ai', event_date en mes de campaña.
    --     Filtra a.sex='female' (la función es serviced_FEMALES y RPS.5.1 dice "hembras con un evento de IA");
    --     defensa contra un dato inconsistente (un service+ai sobre un macho no debe inflar el denominador).
    select distinct p.id as animal_profile_id, 'ai'::text as source
    from public.animal_profiles p
    join public.animals a on a.id = p.animal_id
    join public.reproductive_events rv on rv.animal_profile_id = p.id
    where p.rodeo_id = p_rodeo_id
      and p.establishment_id = v_est
      and p.deleted_at is null
      and a.sex = 'female'
      and rv.event_type = 'service' and rv.service_type = 'ai'
      and rv.deleted_at is null
      and extract(year from rv.event_date)::int = p_year
      and (v_months is null or extract(month from rv.event_date)::int = any(v_months))
      -- nota: si el rodeo no declara meses (NULL), la IA igual cuenta (es un dato real per-vaca de esa
      --       campaña-año); si declara meses, la IA fuera de esos meses NO cuenta para esta campaña.
  )
  -- UNIÓN DISTINCT por animal_profile_id (RPS.5.7): si está en ambas ramas, gana 'natural' (orden estable).
  select distinct on (u.animal_profile_id) u.animal_profile_id, u.source
  from (select * from eligible_natural union all select * from ai_females) u
  order by u.animal_profile_id, (u.source = 'natural') desc;
end; $$;

comment on function public.rodeo_serviced_females is
  'Conjunto SERVIDAS de un rodeo en una campaña (RPS.5.1/.2/.7): unión DISTINCT de servicio natural (vientres '
  'elegibles del rodeo con ventana activa: probadamente servidas SIN gate — incl. vaquillona_prenada, fix veto '
  '— + vaquillonas APTAS o fallback por edad) ∪ IA per-vaca (service+ai en la campaña). Read-only/STABLE, '
  'SECURITY DEFINER con guard has_role_in(est) + cota p_year (RPS.5.10). source ∈ {natural,ai} para diagnóstico.';

-- ============================================================================
-- (3) Entoradas — rodeo_repro_denominator (RPS.5.5)
-- ============================================================================
-- Denominador explícito (Gate 0 §7, convención Bavera). Entoradas = servidas − retiradas (RPS.5.5).
-- "Retiradas": hembras que ENTRARON a servicio (están en el conjunto servidas) pero salieron del padrón
-- (status <> 'active' o baja con deleted_at). [TENTATIVO] el MVP cuenta como retirada a la que YA NO está
-- activa hoy; el recorte fino por "salió DURANTE la ventana" lo afina Stream C con exit_date vs la ventana.
-- Devuelve los 3 números para que la UI muestre el denominador explícito (entoradas/preñadas/paridas — Gate 0
-- §7, lo arma Stream C sobre estos).
-- NOTA: rodeo_serviced_females ya filtra status='active'/deleted_at IS NULL en la rama NATURAL, pero la rama
-- AI no filtra status (una hembra inseminada que luego se vendió SÍ entró a servicio → cuenta como servida y
-- como retirada). Por eso `retired` re-evalúa el status sobre el conjunto servidas completo (natural∪ai).
create or replace function public.rodeo_repro_denominator (p_rodeo_id uuid, p_year int)
returns table (serviced int, retired int, entoradas int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s denominator' using errcode = '42501';
  end if;
  -- Cota de p_year (RPS.5.10) — DESPUÉS del guard de tenant. (rodeo_serviced_females la re-valida igual.)
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  serviced := (select count(*)::int from public.rodeo_serviced_females(p_rodeo_id, p_year));
  retired  := (select count(*)::int
               from public.rodeo_serviced_females(p_rodeo_id, p_year) s
               join public.animal_profiles p on p.id = s.animal_profile_id
               where p.status <> 'active' or p.deleted_at is not null);  -- [TENTATIVO] ver header
  entoradas := serviced - retired;
  return next;
end; $$;

comment on function public.rodeo_repro_denominator is
  'Denominador explícito (Gate 0 §7, Bavera): entoradas = servidas − retiradas (RPS.5.5). Read-only/STABLE, '
  'SECURITY DEFINER con guard has_role_in(est) + cota p_year. Delega en rodeo_serviced_females (que re-guarda '
  'el tenant). "Retiradas" = del conjunto servidas, las que ya no están activas hoy [TENTATIVO: Stream C afina '
  'el recorte por ventana]. Devuelve (serviced, retired, entoradas) para el denominador explícito de la UI.';

-- ============================================================================
-- (4) Grants/revokes + smoke-check fail-closed (RPS.5.6, patrón 0066/0074/0097)
-- ============================================================================
-- Las 3 funciones son READ-ONLY y tenant-scoped por el guard has_role_in al entrar (cualquier rol del
-- establecimiento LEE reportes). SECURITY DEFINER → la RLS no las protege; el guard interno SÍ. Se exponen a
-- authenticated (Stream C las llama desde el cliente o una vista de reportes); anon/public revocados.
revoke execute on function public.rodeo_service_campaign (uuid, int)  from public, anon;
revoke execute on function public.rodeo_serviced_females (uuid, int)  from public, anon;
revoke execute on function public.rodeo_repro_denominator (uuid, int) from public, anon;
grant  execute on function public.rodeo_service_campaign (uuid, int)  to authenticated;
grant  execute on function public.rodeo_serviced_females (uuid, int)  to authenticated;
grant  execute on function public.rodeo_repro_denominator (uuid, int) to authenticated;

-- Smoke-check fail-closed: anon/public NUNCA deben poder ejecutar las 3 funciones del denominador. Si alguna
-- quedó EXECUTE-able por anon/public → la migración FALLA (el tenant-scoping descansa en el guard interno,
-- pero la superficie RPC se cierra a anon/public por prolijidad / defensa en profundidad).
do $$
declare v_bad record;
begin
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname in ('rodeo_service_campaign', 'rodeo_serviced_females', 'rodeo_repro_denominator')
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (Stream A RPS.5.6): % is EXECUTE-able by % (must be revoked from anon/public)', v_bad.proname, v_bad.rolname;
  end loop;
  raise notice 'grant check OK (Stream A RPS.5.6): rodeo_service_campaign/rodeo_serviced_females/rodeo_repro_denominator revoked from anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
