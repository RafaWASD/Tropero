-- 0014_systems_by_species.sql  (spec 02 lógico: 0013_systems_by_species)
-- Sistemas productivos por especie. Catálogo de configuración read-only.
-- Cubre R1.2, R1.4, R1.5.

create table public.systems_by_species (
  id          uuid primary key default gen_random_uuid(),
  species_id  uuid not null references public.species(id),
  code        text not null,                   -- 'cria', 'invernada', 'feedlot', 'tambo', 'cabana'
  name        text not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (species_id, code)
);

comment on table public.systems_by_species is
  'Sistemas productivos por especie. En MVP solo (bovino, cria) activo.';

-- Seed para bovino: cria activo; resto inactivo.
insert into public.systems_by_species (species_id, code, name, active)
select id, 'cria', 'Cría', true from public.species where code = 'bovino';

insert into public.systems_by_species (species_id, code, name, active)
select s.id, t.code, t.name, false from (
  values ('invernada', 'Invernada'),
         ('feedlot', 'Feedlot'),
         ('tambo', 'Tambo'),
         ('cabana', 'Cabaña')
) as t(code, name), public.species s where s.code = 'bovino';

alter table public.systems_by_species enable row level security;

create policy systems_select on public.systems_by_species
  for select to authenticated using (true);

grant select on public.systems_by_species to authenticated;
grant all on public.systems_by_species to service_role;

notify pgrst, 'reload schema';
