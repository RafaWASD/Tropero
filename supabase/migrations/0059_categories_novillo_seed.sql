-- 0059_categories_novillo_seed.sql — Tier 2/3 spec 02 (modelo de categorías de cría).
-- Categorías de macho castrado (ADR-008 enmendado 2026-06-03): novillito (<=2 años) y
-- novillo (>2 años). Cubre RT2.1.1, RT2.1.2, RT2.1.3, RT2.13.2.
--
-- Idempotente: on conflict (system_id, code) do nothing sobre el unique de 0015.
-- L1 (Gate 1): join por .code ('bovino'/'cria'), NUNCA por .name (lección 0015/spec 10).
-- NO toca el code ni el active de las 10 categorías ya sembradas por 0015.

with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.categories_by_system (system_id, code, name, sort_order, active)
select sys.system_id, c.code, c.name, c.sort, true
from sys, (values
  ('novillito', 'Novillito', 96),   -- entre torito (95) y los castrados; macho castrado <=2 años
  ('novillo',   'Novillo',   97)    -- macho castrado >2 años
) as c(code, name, sort)
on conflict (system_id, code) do nothing;

notify pgrst, 'reload schema';
