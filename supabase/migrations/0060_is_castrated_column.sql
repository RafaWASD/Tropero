-- 0060_is_castrated_column.sql — Tier 2/3 spec 02. Atributo is_castrated (DD-2).
-- Cubre RT2.2.1, RT2.12.1, RT2.13.1.
--
-- is_castrated vive en `animals` (atributo físico del animal, junto a sex/birth_date), NO
-- en animal_profiles: la castración no cambia al moverse de campo (DD-2). Default false NOT
-- NULL: ningún animal existente cambia de categoría por el solo ADD COLUMN (RT2.13.1/2.13.2).
--
-- RLS/grants: hereda la policy de `animals` (0022: SELECT/UPDATE derivados de la presencia de
-- un perfil del animal con has_role_in). NO se agrega policy ni grant nuevo → no abre camino
-- cross-tenant (RT2.12.1). La inmutabilidad de identificadores (0036) NO aplica a is_castrated
-- (no es identificador): el toggle castrado/entero debe poder corregirse.

alter table public.animals
  add column if not exists is_castrated boolean not null default false;

comment on column public.animals.is_castrated is
  'Atributo físico del animal (DD-2 spec 02 Tier 2/3). Eje torito<->novillito / toro<->novillo. Su efecto de categoría lo aplica el trigger 0064 (false->true) y compute_category (al destete).';

notify pgrst, 'reload schema';
