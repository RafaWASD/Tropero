-- 0031_category_transitions.sql  (spec 02 lógico: 0030)
-- Transiciones automáticas de categoría (ADR-008). Ortogonalidad: solo tocan
-- category_id, nunca rodeo_id ni management_group_id (R7.7).
-- Cubre R7.1..R7.7, R4.9, R4.10 (compute_category), R7.6.

-- compute_category(profile_id): recalcula desde cero (R7.6).
create or replace function public.compute_category (profile_id uuid)
returns uuid language plpgsql security definer stable
set search_path = public as $$
declare
  v_sex text;
  v_birth_date date;
  v_system_id uuid;
  v_births int;
  v_has_pos_tacto boolean;
  v_target_code text;
begin
  select a.sex, a.birth_date, r.system_id
    into v_sex, v_birth_date, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  if v_sex = 'male' then
    if v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternero';
    else
      v_target_code := 'torito';   -- conservador, owner puede cambiar a 'toro'
    end if;
  else
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id
      and event_type = 'birth'
      and deleted_at is null;

    select exists (
      select 1 from public.reproductive_events
      where animal_profile_id = profile_id
        and event_type = 'tacto'
        and pregnancy_status is not null
        and pregnancy_status <> 'empty'
        and deleted_at is null
    ) into v_has_pos_tacto;

    if v_births >= 2 then
      v_target_code := 'multipara';
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';
    elsif v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternera';
    else
      v_target_code := 'vaquillona';
    end if;
  end if;

  return (select id from public.categories_by_system
          where system_id = v_system_id and code = v_target_code and active = true
          limit 1);
end; $$;

grant execute on function public.compute_category (uuid) to authenticated;

-- apply_auto_transition: setea GUC y hace el UPDATE de SOLO category_id (R7.7).
create or replace function public.apply_auto_transition (profile_id uuid, target_category_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  perform set_config('rafaq.is_auto_transition', 'on', true);
  update public.animal_profiles
    set category_id = target_category_id
    where id = profile_id;
  perform set_config('rafaq.is_auto_transition', 'off', true);
end; $$;

-- Trigger sobre reproductive_events: transición incremental (R7.1..R7.3).
create or replace function public.tg_reproductive_events_apply_transition ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_override boolean;
  v_current_code text;
  v_system_id uuid;
  v_target_code text;
  v_target_id uuid;
begin
  select p.category_override, c.code, r.system_id
    into v_override, v_current_code, v_system_id
  from public.animal_profiles p
  join public.categories_by_system c on c.id = p.category_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  if v_override is null or v_override = true then
    return new;  -- override activo => no tocamos (R4.9)
  end if;

  if new.event_type = 'tacto'
     and new.pregnancy_status is not null
     and new.pregnancy_status <> 'empty'
     and v_current_code = 'vaquillona' then
    v_target_code := 'vaquillona_prenada';
  elsif new.event_type = 'birth'
        and v_current_code = 'vaquillona_prenada' then
    v_target_code := 'vaca_segundo_servicio';
  elsif new.event_type = 'birth'
        and v_current_code = 'vaca_segundo_servicio' then
    v_target_code := 'multipara';
  else
    return new;
  end if;

  select id into v_target_id from public.categories_by_system
    where system_id = v_system_id and code = v_target_code and active = true;

  if v_target_id is null then
    -- R7.5: log y NO bloquear el insert.
    raise warning 'auto transition target % not found for system %', v_target_code, v_system_id;
    return new;
  end if;

  perform public.apply_auto_transition(new.animal_profile_id, v_target_id);
  return new;
end; $$;

create trigger reproductive_events_apply_transition
  after insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_apply_transition();
