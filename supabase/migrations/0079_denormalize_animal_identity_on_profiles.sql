-- 0079_denormalize_animal_identity_on_profiles.sql  (feature 15-powersync, PASO 2 / T9.4 — decisión (b1) de Raf)
--
-- DENORMALIZACIÓN de la IDENTIDAD del animal global sobre `animal_profiles` (decisión (b1), ADR-026 §B):
-- `animal_tag_electronic`, `animal_sex`, `animal_birth_date`. Cubre R4.7, R13.7.
--
-- POR QUÉ: `animals` es GLOBAL (ADR-004): un animal puede tener perfiles en >1 campo -> NO tiene un único
-- `establishment_id` -> NO se puede sincronizar como tabla en el modelo JOIN-free (un device vería animales de
-- campos ajenos; o un INNER JOIN a animal_profiles = el patrón V2 que reventó, PSYNC_S2305). La UI lee de
-- `animals` SOLO identidad (`tag_electronic`/`sex`/`birth_date` — verificado en app/src/services/animals.ts;
-- `breed`/`coat_color` ya viven en animal_profiles). (b1): denormalizar esa identidad sobre la fila per-campo
-- (`animal_profiles`, que SÍ tiene establishment_id -> ya sincroniza JOIN-free) y NO sincronizar `animals`.
-- NO se agrega una stream `est_animals`: la identidad viaja DENTRO de `est_animal_profiles` (ya existente).
--
-- TIPOS: copiados EXACTOS de animals (0019): tag_electronic text, sex text (check male|female), birth_date date.
--   columnas nuevas: animal_tag_electronic text, animal_sex text, animal_birth_date date (nullables — un animal
--   sin tag/birth_date es válido as-built; el NOT NULL de animals.sex se preserva vía el force, pero la columna
--   denormalizada se deja nullable por robustez del backfill / fail-safe).
--
-- MANTENIMIENTO (dos triggers + backfill):
--   (1) FORCE en el INSERT y UPDATE del PERFIL (BEFORE INSERT OR UPDATE OF las 3 columnas on animal_profiles):
--       copia las 3 desde `animals WHERE id = NEW.animal_id`, ignorando cualquier valor del payload (anti-spoof;
--       el cliente no debe poder mentir la identidad del animal en su perfil — ni en el INSERT ni pisándola por
--       un UPDATE directo a PostgREST. Reconciliación al as-built vs design §2.4 (B), que solo mencionaba el
--       INSERT: animal_profiles tiene GRANT UPDATE, así que el force en UPDATE cierra el vector de spoofeo por
--       UPDATE; re-deriva el MISMO valor de animals, sin impacto en flujos legítimos).
--   (2) PROPAGACIÓN del re-tag/cambio de identidad (AFTER UPDATE OF tag_electronic, sex, birth_date on animals):
--       propaga los nuevos valores a TODOS los animal_profiles del animal. Re-tag es raro (verificado: ningún
--       code-path del cliente UPDATEa esas columnas hoy — 0036 hasta BLOQUEA el cambio de tag_electronic; solo
--       INSERT en createAnimal/import/register_birth) pero el trigger lo cubre por correctitud.
--   (3) BACKFILL de los perfiles existentes desde su animal.
--
-- NO-LOOP (verificado): el UPDATE de propagación toca SOLO animal_tag_electronic/animal_sex/animal_birth_date en
-- animal_profiles -> NO dispara record_category_change_upd (AFTER UPDATE OF category_id, 0030), NO dispara el
-- force (es INSERT, no UPDATE), NO toca `animals` de vuelta. El único trigger colateral es set_updated_at
-- (BEFORE UPDATE, refresca updated_at) — benigno y deseable. Cero recursión.
--
-- RLS AS-BUILT NO CAMBIA (R11.3): `animal_profiles` ya tiene su RLS por establishment_id; las 3 columnas nuevas
-- son datos extra de la misma fila, cubiertos por la policy de SELECT existente. No se toca ninguna policy.
--
-- NO aplicar al remoto desde acá: lo aplica el leader por Management API (BEGIN/COMMIT) tras gatear el SQL.

begin;

-- ---------------------------------------------------------------------------
-- (0) Columnas denormalizadas en animal_profiles (tipos = animals 0019).
-- ---------------------------------------------------------------------------
alter table public.animal_profiles
  add column if not exists animal_tag_electronic text,
  add column if not exists animal_sex            text,
  add column if not exists animal_birth_date     date;

comment on column public.animal_profiles.animal_tag_electronic is
  'Denormalizado de animals.tag_electronic (b1, ADR-026). Mantenido por trigger force (INSERT del perfil) + '
  'propagación (UPDATE de animals). Solo para que la UI lea la identidad offline desde animal_profiles sin '
  'sincronizar la tabla global animals. animals NO entra al sync set.';
comment on column public.animal_profiles.animal_sex is
  'Denormalizado de animals.sex (b1, ADR-026). Mantenido por trigger force + propagación.';
comment on column public.animal_profiles.animal_birth_date is
  'Denormalizado de animals.birth_date (b1, ADR-026). Mantenido por trigger force + propagación.';

-- ---------------------------------------------------------------------------
-- (1) Backfill de los perfiles existentes desde su animal. Idempotente: re-correrlo reescribe el mismo valor.
-- ---------------------------------------------------------------------------
update public.animal_profiles ap
   set animal_tag_electronic = a.tag_electronic,
       animal_sex            = a.sex,
       animal_birth_date     = a.birth_date
  from public.animals a
 where a.id = ap.animal_id;

-- ---------------------------------------------------------------------------
-- (2) FORCE en el INSERT (y UPDATE de las 3 columnas) del perfil: copia la identidad desde animals (anti-spoof).
--     `security definer` + `set search_path = public` (el SELECT a animals corre como owner del schema).
--     BEFORE UPDATE OF las 3 columnas (no en cualquier UPDATE): un caller con UPDATE permission en
--     animal_profiles podría intentar pisar animal_tag_electronic/animal_sex/animal_birth_date con un valor
--     falso → el force re-deriva desde animals (la fuente de verdad), manteniendo la columna FIEL. Como
--     animal_id es estable, re-deriva el valor correcto; cero impacto en UPDATEs legítimos. Solo dispara si el
--     UPDATE toca alguna de las 3 columnas (eficiente). El trigger de propagación (3) usa este mismo path:
--     cuando él UPDATEa animal_profiles con el valor nuevo de animals, este force re-deriva el MISMO valor
--     (idempotente, sin pelea entre triggers).
-- ---------------------------------------------------------------------------
create or replace function public.tg_force_animal_identity_on_profile ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag  text;
  v_sex  text;
  v_bd   date;
  v_found boolean;
begin
  select a.tag_electronic, a.sex, a.birth_date, true
    into v_tag, v_sex, v_bd, v_found
  from public.animals a
  where a.id = new.animal_id;
  if v_found is null then
    raise exception 'animal_id % not found (no se pudo derivar la identidad denormalizada)', new.animal_id
      using errcode = '23503';
  end if;
  new.animal_tag_electronic := v_tag;   -- FUERZA desde animals: ignora el payload (anti-spoof)
  new.animal_sex            := v_sex;
  new.animal_birth_date     := v_bd;
  return new;
end;
$$;

comment on function public.tg_force_animal_identity_on_profile is
  'Trigger BEFORE INSERT OR UPDATE OF (las 3 columnas) en animal_profiles: FUERZA '
  'animal_tag_electronic/animal_sex/animal_birth_date desde animals WHERE id = NEW.animal_id (ignora el payload '
  '— anti-spoof; también en UPDATE para que un caller no pueda pisar la identidad denormalizada con un valor '
  'falso). Denormalización (b1, ADR-026) para que la UI lea la identidad offline desde animal_profiles sin '
  'sincronizar la tabla global animals.';

drop trigger if exists animal_profiles_force_animal_identity on public.animal_profiles;
create trigger animal_profiles_force_animal_identity
  before insert or update of animal_tag_electronic, animal_sex, animal_birth_date on public.animal_profiles
  for each row execute function public.tg_force_animal_identity_on_profile();

-- ---------------------------------------------------------------------------
-- (3) PROPAGACIÓN: al cambiar la identidad de un animal, propagar a TODOS sus perfiles.
--     AFTER UPDATE OF (solo dispara cuando el UPDATE toca alguna de las 3 columnas de identidad).
-- ---------------------------------------------------------------------------
create or replace function public.tg_propagate_animal_identity_to_profiles ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.animal_profiles
     set animal_tag_electronic = new.tag_electronic,
         animal_sex            = new.sex,
         animal_birth_date     = new.birth_date
   where animal_id = new.id
     and (animal_tag_electronic is distinct from new.tag_electronic
       or animal_sex            is distinct from new.sex
       or animal_birth_date     is distinct from new.birth_date);
  return new;
end;
$$;

comment on function public.tg_propagate_animal_identity_to_profiles is
  'Trigger AFTER UPDATE OF tag_electronic, sex, birth_date en animals: propaga la nueva identidad a TODOS los '
  'animal_profiles del animal (re-tag/correccion). El guard is-distinct-from evita UPDATEs no-op. Denormalización '
  '(b1, ADR-026). No-loop: el UPDATE a animal_profiles no toca animals ni category_id (no re-dispara nada).';

drop trigger if exists animals_propagate_identity_to_profiles on public.animals;
create trigger animals_propagate_identity_to_profiles
  after update of tag_electronic, sex, birth_date on public.animals
  for each row execute function public.tg_propagate_animal_identity_to_profiles();

notify pgrst, 'reload schema';

commit;
