-- 0104_compute_category_drop_service.sql  (spec 02 — Stream A, RPS.4)
-- Reconciliación del Gate 0 §2.1: el backstop servicio→vaquillona se ELIMINA. El destete (has_weaning) es
-- la vía canónica ternera→vaquillona y el corte de edad (≥365) + el cron nocturno targeted (0066) cubren
-- "se olvidaron de destetar". Las transiciones grandes (tacto+→preñada, parto→vaca, aborto-revierte RT2.7.5,
-- castración) NO dependían de service → el ripple es chico.
--
-- DIFF vs 0062 (ÚNICO cambio, quirúrgico — DD-PS-4): se borra (a) la declaración `v_has_service`, (b) su
-- `SELECT EXISTS ... event_type='service'`, y (c) el término `or v_has_service` de la rama vaquillona
-- (0062 línea 93). NADA MÁS cambia. Se conserva LITERAL de 0062: SECURITY DEFINER STABLE, set search_path =
-- public, conteo de PARTOS (eventos 'birth', NUNCA terneros/birth_calves), is_castrated, rama macho (cortes
-- 1/2 años), tacto+ vigente RT2.7.5, precedencia LOAD-BEARING de ramas, grant execute a authenticated, y la
-- derivación de todo dato del profile_id recibido vía joins (no lee ni escribe otro tenant, RT2.12.3 / RPS.4.6).
-- Su contrato de retorno (uuid del category_id) NO cambia (RPS.4.6).
--
-- NO se toca 0063 (guard del trigger incremental: se DEJA 'service' en la lista — recomendación firme
-- DD-PS-4): la IA se almacena como service+ai y dejar el recompute es la opción conservadora; la
-- recomputación es IDEMPOTENTE (recomputa la MISMA categoría porque esta función ya no lee 'service'). Así
-- el delta toca SOLO compute_category, minimizando la superficie sobre backend deployado. RT2.10.1 (consis-
-- tencia incremental↔recompute) queda garantizada por construcción: ambos caminos delegan en esta función.
--
-- Eventos `service` históricos (RPS.4.5): NO se borran (siguen en el timeline) pero dejan de influir — esta
-- función ya no los lee. La IA (service+ai, 0054) sigue almacenándose igual; deja de promover a vaquillona
-- por el solo evento (RPS.4.8, intencional: categoría ≠ elegibilidad, Gate 0 §2). La elegibilidad
-- reproductiva (denominador, 0105) es independiente de la categoría.
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el leader por Management API tras Gate 1 (PASS) + reviewer +
-- Gate 2 + Puerta 2 + autorización de Raf. CONSIDERACIÓN DE DEPLOY (regresión de datos, RPS.4.5): al aplicar,
-- las categorías GUARDADAS de los animales existentes NO se recalculan automáticamente (el cron 0066 solo
-- recomputa hembras ternera age-stale). El único caso real de reversión = hembra <365d con un evento
-- service/IA, SIN destete, SIN tacto+ → hoy está 'vaquillona' por service, tras 0104 recomputaría 'ternera'.
-- (Una hembra sin birth_date cae en el default vaquillona RT2.4.6 → no cambia; una servida ≥365d o destetada
-- sigue vaquillona por edad/destete → no cambia.) Probablemente conjunto VACÍO en datos reales (no se sirve
-- una hembra de <1 año). ACCIÓN PARA EL LEADER AL DEPLOY: (a) ANTES de aplicar, consultar el remoto si existe
-- alguna fila así; (b) si existen, decidir recompute targeted one-time (estilo refresh_age_categories acotado)
-- vs dejar que recompute lazily en el próximo evento/cron. Ver nota de cierre del ledger.

begin;

create or replace function public.compute_category (profile_id uuid)
returns uuid language plpgsql security definer stable
set search_path = public as $$
declare
  v_sex text;
  v_birth_date date;
  v_is_castrated boolean;
  v_system_id uuid;
  v_age_days int;
  v_births int;
  v_has_weaning boolean;
  -- v_has_service ELIMINADA (RPS.4.1)
  v_has_pos_tacto boolean;   -- tacto+ NO revertido por aborto posterior (RT2.7.5)
  v_target_code text;
begin
  select a.sex, a.birth_date, a.is_castrated, r.system_id
    into v_sex, v_birth_date, v_is_castrated, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  v_age_days := case when v_birth_date is not null then (current_date - v_birth_date) else null end;

  -- destete: existencia de evento no borrado. (El SELECT EXISTS de event_type='service' fue ELIMINADO, RPS.4.1.)
  select exists (select 1 from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'weaning' and deleted_at is null)
    into v_has_weaning;

  if v_sex = 'male' then
    -- rama macho IDÉNTICA a 0062 (cortes 2 años / 1 año / <1 año / default; is_castrated). [SIN CAMBIO]
    -- corte 2 años: toro/novillo (solo con birth_date conocido) — DD-1 / RT2.3.3.
    if v_age_days is not null and v_age_days >= 730 then
      v_target_code := case when v_is_castrated then 'novillo' else 'toro' end;
    -- graduado: destete cargado, O >=1 año por edad — torito/novillito (RT2.3.2).
    elsif v_has_weaning or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    -- ternero: <1 año conocido y sin destete (RT2.3.1).
    elsif v_age_days is not null and v_age_days < 365 then
      v_target_code := 'ternero';
    else
      -- birth_date NULL, sin destete: default conservador por sexo (R4.7.1 base; RT2.3.4).
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    end if;
  else
    -- conteo de PARTOS (eventos birth distintos, NUNCA terneros / birth_calves) — RT2.7.2 / as-built 0045.
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'birth' and deleted_at is null;

    -- tacto+ vigente = existe un tacto positivo SIN un aborto posterior (por event_date, desempate
    -- created_at). RT2.7.5. IDÉNTICO a 0062. [SIN CAMBIO]
    select exists (
      select 1 from public.reproductive_events t
      where t.animal_profile_id = profile_id
        and t.event_type = 'tacto'
        and t.pregnancy_status is not null and t.pregnancy_status <> 'empty'
        and t.deleted_at is null
        and not exists (
          select 1 from public.reproductive_events ab
          where ab.animal_profile_id = profile_id
            and ab.event_type = 'abortion'
            and ab.deleted_at is null
            and (ab.event_date, ab.created_at) > (t.event_date, t.created_at)
        )
    ) into v_has_pos_tacto;

    -- Orden de ramas LOAD-BEARING (precedencia de la máquina de estados), IDÉNTICO a 0062 SALVO que la rama
    -- vaquillona YA NO incluye `or v_has_service`:
    --   partos>=2 > partos=1 > tacto+ > vaquillona(destete | >=1año) > ternera(<1año) > default.
    if v_births >= 2 then
      v_target_code := 'multipara';                         -- RT2.4.1
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';             -- RT2.4.2 (desde cualquier categoría, incl. ternera)
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';                -- RT2.4.3
    elsif v_has_weaning or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := 'vaquillona';                        -- RT2.4.4 (RPS.4.1: SIN `or v_has_service`)
    elsif v_age_days is not null and v_age_days < 365 then
      v_target_code := 'ternera';                           -- RT2.4.5
    else
      v_target_code := 'vaquillona';                        -- RT2.4.6 (sin birth_date, sin eventos)
    end if;
  end if;

  return (select id from public.categories_by_system
          where system_id = v_system_id and code = v_target_code and active = true
          limit 1);
end; $$;

grant execute on function public.compute_category (uuid) to authenticated;  -- [SIN CAMBIO vs 0062]

notify pgrst, 'reload schema';

commit;
