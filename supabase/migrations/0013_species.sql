-- 0013_species.sql  (spec 02 lógico: 0012_species)
-- Catálogo global de especies. Tabla de configuración: read-only desde cliente,
-- modificable solo vía migration. Cubre R1.1, R1.4, R1.5.

create table public.species (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,            -- 'bovino', 'equino', 'porcino'
  name        text not null,
  icon        text,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.species is
  'Catálogo global de especies. En MVP solo bovino activo. Read-only desde cliente.';

insert into public.species (code, name, icon, active) values
  ('bovino', 'Bovino', 'cow', true),
  ('equino', 'Equino', 'horse', false),
  ('porcino', 'Porcino', 'pig', false);

alter table public.species enable row level security;

create policy species_select on public.species
  for select to authenticated using (true);

grant select on public.species to authenticated;
grant all on public.species to service_role;
-- No GRANT insert/update/delete a authenticated: cambios vía migration (R1.4).

notify pgrst, 'reload schema';
