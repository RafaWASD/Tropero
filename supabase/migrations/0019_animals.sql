-- 0019_animals.sql  (spec 02 lógico: 0018_animals)
-- Animal global (ADR-004). Identificado por tag_electronic cuando existe.
-- Policies de SELECT/INSERT/UPDATE se definen en 0022 (la SELECT depende de
-- animal_profiles que se crea en 0020).
-- Cubre R3.1, R3.2, R3.3, R3.4.

create table public.animals (
  id              uuid primary key default gen_random_uuid(),
  tag_electronic  text,
  species_id      uuid not null references public.species(id),
  sex             text not null check (sex in ('male', 'female')),
  birth_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

comment on table public.animals is
  'Animal global (ADR-004). tag_electronic único globalmente cuando existe.';

-- R3.2: TAG único globalmente cuando existe y no soft-deleted.
create unique index animals_tag_unique
  on public.animals (tag_electronic)
  where tag_electronic is not null and deleted_at is null;

-- R3.3: rechazar species_id inactiva.
create or replace function public.tg_animals_validate_species ()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.species where id = new.species_id and active = true) then
    raise exception 'species inactive or not found' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animals_validate_species
  before insert or update on public.animals
  for each row execute function public.tg_animals_validate_species();

create trigger animals_set_updated_at
  before update on public.animals
  for each row execute function public.tg_set_updated_at_generic();

alter table public.animals enable row level security;
-- policies en 0022_rls_animals_and_profiles.sql
grant select, insert, update on public.animals to authenticated;
grant all on public.animals to service_role;

notify pgrst, 'reload schema';
