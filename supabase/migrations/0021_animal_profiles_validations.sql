-- 0021_animal_profiles_validations.sql  (spec 02 lógico: 0020)
-- Triggers de validación e identificación de animal_profiles.
-- Cubre R4.2, R4.5, R4.6, R4.8.

-- (a) R4.2: al menos uno de tag/idv/visual_alt tiene texto (mirando animals.tag_electronic).
create or replace function public.tg_animal_profiles_identity_check ()
returns trigger language plpgsql as $$
declare v_tag text;
begin
  select tag_electronic into v_tag from public.animals where id = new.animal_id;
  if coalesce(nullif(trim(v_tag), ''),
              nullif(trim(new.idv), ''),
              nullif(trim(new.visual_id_alt), '')) is null then
    raise exception 'animal must have at least one of tag_electronic, idv or visual_id_alt'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_identity_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_identity_check();

-- (b) R4.5: rodeo del mismo establishment, no soft-deleted, activo.
create or replace function public.tg_animal_profiles_rodeo_check ()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.rodeos r
    where r.id = new.rodeo_id
      and r.establishment_id = new.establishment_id
      and r.active = true
      and r.deleted_at is null
  ) then
    raise exception 'rodeo does not belong to establishment or is inactive'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_rodeo_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_rodeo_check();

-- (c) R4.6: category_id debe pertenecer al system del rodeo.
create or replace function public.tg_animal_profiles_category_check ()
returns trigger language plpgsql as $$
declare v_system_id uuid;
begin
  select system_id into v_system_id from public.rodeos where id = new.rodeo_id;
  if not exists (
    select 1 from public.categories_by_system c
    where c.id = new.category_id and c.system_id = v_system_id and c.active = true
  ) then
    raise exception 'category does not belong to rodeo system'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_category_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_category_check();

-- R4.8: si UPDATE de category_id fuera de transición automática, marcar override.
create or replace function public.tg_animal_profiles_set_override_on_manual ()
returns trigger language plpgsql as $$
begin
  if new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') <> 'on' then
      new.category_override := true;
    end if;
  end if;
  return new;
end; $$;

create trigger animal_profiles_set_override
  before update of category_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_set_override_on_manual();
