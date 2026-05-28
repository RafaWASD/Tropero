-- 0017_rodeos.sql  (spec 02 lógico: 0015_rodeos)
-- Jerarquía intermedia establishments -> rodeos -> animal_profiles (ADR-016).
-- Un rodeo es (establishment_id, species_id, system_id, name) + su config de datos
-- (rodeo_data_config, ver 0018). NO hay rodeo default (R2.6).
-- Cubre R2.1, R2.2, R2.3, R2.4.

create table public.rodeos (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  species_id        uuid not null references public.species(id),
  system_id         uuid not null references public.systems_by_species(id),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint rodeos_name_not_empty check (length(trim(name)) > 0)
);

create index rodeos_by_est on public.rodeos (establishment_id) where deleted_at is null;
create index rodeos_lookup on public.rodeos (establishment_id, active) where deleted_at is null;

-- R2.4: la combinación (species_id, system_id) debe existir en systems_by_species y estar activa.
create or replace function public.tg_rodeos_validate_species_system ()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.systems_by_species s
    where s.id = new.system_id
      and s.species_id = new.species_id
      and s.active = true
  ) then
    raise exception 'invalid species/system combination or system inactive'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rodeos_validate_species_system
  before insert or update on public.rodeos
  for each row execute function public.tg_rodeos_validate_species_system();

create trigger rodeos_set_updated_at
  before update on public.rodeos
  for each row execute function public.tg_set_updated_at_generic();

alter table public.rodeos enable row level security;

create policy rodeos_select on public.rodeos
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy rodeos_insert on public.rodeos
  for insert with check (is_owner_of(establishment_id));

create policy rodeos_update on public.rodeos
  for update using (is_owner_of(establishment_id))
  with check (is_owner_of(establishment_id));

grant select, insert, update on public.rodeos to authenticated;
grant all on public.rodeos to service_role;

notify pgrst, 'reload schema';
