-- 0120_male_category_order.sql — Reordenar las categorías MACHO del alta (sistema cría).
-- Cambio CHICO (Nivel A, ADR-028 — sin delta-spec). Decisión de Raf.
--
-- El picker de categoría del alta (crear-animal.tsx paso 3 → buildSystemCategoriesQuery,
-- local-reads.ts:113 "ORDER BY sort_order ASC") muestra las categorías del sistema del rodeo en
-- el orden de sort_order. El orden macho VIGENTE era un accidente de cuándo se sembró cada una:
--   Ternero(10) → Toro(90) → Torito(95) → Novillito(96) → Novillo(97).
-- Raf lo reordena a la rama ENTERA/reproductiva primero, después la CASTRADA/invernada, edad
-- joven→adulto dentro de cada rama:
--   Ternero → Torito → Toro → Novillito → Novillo.
--
-- Solo se tocan los 4 codes MACHO (torito/toro/novillito/novillo) del sistema cría. Ternero queda
-- PRIMERO sin cambio (sort_order 10). Las categorías HEMBRA (sort_order 20-80) NO se tocan — no
-- aparecen en el picker de macho (categoriesForSex las filtra por code). Otros sistemas NO se tocan.
--
-- SCOPE por join-by-code (bovino/cria) igual que los seeds 0015/0059: NUNCA por name, y NO por un
-- UUID hardcodeado (system_id se genera con gen_random_uuid() → distinto en cada DB fresca; el
-- join-by-code lo resuelve robusto en remoto y en cualquier reset). En el remoto compartido el
-- system_id de cría es '7babeff4-9d95-49ce-881e-346ea1fdfa6c'.
--
-- Idempotente por naturaleza: UPDATE por (system_id, code) → re-correrlo deja los mismos valores.
-- NO aplicar desde acá: lo aplica el LEADER por MCP tras el veto del implementer + Gate 2 + Gate 2.5.

begin;

with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
update public.categories_by_system c
set sort_order = v.sort,
    updated_at = now()
from sys, (values
  ('torito',    91),   -- entera joven (<2 años)  → tras ternero
  ('toro',      92),   -- entera adulta (>=2 años)
  ('novillito', 93),   -- castrada joven (<=2 años)
  ('novillo',   94)    -- castrada adulta (>2 años)
) as v(code, sort)
where c.system_id = sys.system_id
  and c.code = v.code;

notify pgrst, 'reload schema';

commit;
