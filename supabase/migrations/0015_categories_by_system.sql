-- 0015_categories_by_system.sql  (spec 02 lógico: 0014_categories_by_system)
-- Categorías por sistema productivo. `code` es la clave estable usada por los
-- triggers de transición; los `name` se pueden traducir sin tocar lógica.
-- Cubre R1.3, R1.4, R1.5.

create table public.categories_by_system (
  id                   uuid primary key default gen_random_uuid(),
  system_id            uuid not null references public.systems_by_species(id),
  code                 text not null,           -- 'ternero', 'vaca_segundo_servicio', etc.
  name                 text not null,
  parent_category_id   uuid references public.categories_by_system(id),
  sort_order           int not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (system_id, code)
);

comment on table public.categories_by_system is
  'Categorías por sistema. code es estable (lo usan los triggers); name es display.';

-- Seed para (bovino, cría) — categorías del MVP (R1.3).
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.categories_by_system (system_id, code, name, sort_order, active)
select sys.system_id, c.code, c.name, c.sort, true
from sys, (values
  ('ternero',              'Ternero',                10),
  ('ternera',              'Ternera',                20),
  ('vaquillona',           'Vaquillona',             30),
  ('vaquillona_prenada',   'Vaquillona preñada',     40),
  ('vaca_segundo_servicio','Vaca segundo servicio',  50),
  ('multipara',            'Multípara',              60),
  ('cut',                  'CUT',                    70),
  ('vaca_cabana',          'Vaca cabaña',            80),
  ('toro',                 'Toro',                   90),
  ('torito',               'Torito',                 95)
) as c(code, name, sort);

alter table public.categories_by_system enable row level security;

create policy categories_select on public.categories_by_system
  for select to authenticated using (true);

grant select on public.categories_by_system to authenticated;
grant all on public.categories_by_system to service_role;

notify pgrst, 'reload schema';
