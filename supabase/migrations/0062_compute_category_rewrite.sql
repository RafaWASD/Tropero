-- 0062_compute_category_rewrite.sql — Tier 2/3 spec 02. Reescritura completa (ADR-008 enmendado).
-- Cubre RT2.3.1-RT2.3.5, RT2.4.1-RT2.4.6, RT2.7.2, RT2.7.5, RT2.8.1, RT2.12.3.
--
-- Conserva: SECURITY DEFINER STABLE, set search_path = public, conteo de PARTOS (eventos
-- 'birth' distintos, NUNCA terneros / birth_calves), grant execute a authenticated.
-- Agrega: is_castrated (de animals, DD-2), disparadores weaning/service, aborto-revierte-tacto
-- (RT2.7.5), cortes de edad 1/2 años (DD-1, materializados on-recompute).
--
-- La función NO tiene lógica de reloj: usa birth_date + current_date para resolver el punto de
-- la máquina de estados al momento del recálculo (RT2.3.5). La invoca el on-event (triggers) o
-- el job nocturno refresh_age_categories (0066). Deriva todo del profile_id recibido vía sus
-- joins (animal_profiles/animals/rodeos): no lee ni escribe otro tenant (RT2.12.3).

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
  v_has_service boolean;
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

  -- destete y servicio: existencia de evento no borrado.
  select exists (select 1 from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'weaning' and deleted_at is null)
    into v_has_weaning;
  select exists (select 1 from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'service' and deleted_at is null)
    into v_has_service;

  if v_sex = 'male' then
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
      -- El corte de 2 años NO se aplica sin birth_date (no hay edad para evaluarlo).
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    end if;
  else
    -- conteo de PARTOS (eventos birth distintos, NUNCA terneros / birth_calves) — RT2.7.2 / as-built 0045.
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'birth' and deleted_at is null;

    -- tacto+ vigente = existe un tacto positivo SIN un aborto posterior (por event_date, desempate
    -- created_at). RT2.7.5: un aborto posterior a un tacto+ hace que ese tacto deje de contar como
    -- preñez. Si el aborto es ANTERIOR a un tacto+ (otro servicio/preñez), el tacto vuelve a contar.
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

    -- Orden de ramas LOAD-BEARING (precedencia de la máquina de estados):
    -- partos>=2 > partos=1 > tacto+ > vaquillona(destete/servicio/>=1año) > ternera(<1año) > default.
    if v_births >= 2 then
      v_target_code := 'multipara';                         -- RT2.4.1
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';             -- RT2.4.2 (desde cualquier categoría, incl. ternera)
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';                -- RT2.4.3
    elsif v_has_weaning or v_has_service
          or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := 'vaquillona';                        -- RT2.4.4
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

grant execute on function public.compute_category (uuid) to authenticated;

notify pgrst, 'reload schema';
