-- 0113_derive_breed_id_from_breed.sql  (spec 08 — export SIGSA, T18 / cierre del GAP breed_id)
--
-- PROBLEMA (design.md changelog 2026-06-25): el BreedPicker (alta + ficha) setea
-- `animal_profiles.breed` (TEXTO, el NOMBRE EXACTO del catálogo SENASA, ej. 'Aberdeen Angus') pero NO
-- `breed_id` — la RPC `create_animal` (0083, pre-spec-08) no tiene `p_breed_id` y `upload.ts` no lo
-- pasa. Sin `breed_id`, el animal aparece "Falta la raza" en el export (R8.2) y NO es exportable a SIGSA
-- (el código RAZA del TXT sale de breed_catalog vía breed_id, R5.2). El import (spec 08 capa pura) y la
-- edición de raza de la ficha tienen el mismo problema.
--
-- SOLUCIÓN (leader, centralizada — evita cambiar firmas de RPC y arregla alta+import+edición de forma
-- UNIFORME): un trigger que DERIVA `breed_id` desde `breed` por match de NOMBRE normalizado contra
-- breed_catalog. El cliente escribe SOLO `breed` (el nombre); el trigger pone el `breed_id`. Mismo
-- criterio de match que la migración best-effort de 0108 (lower(trim(name)) = lower(trim(breed))).
--
-- NO-MATCH → breed_id NULL (decisión del leader, MEDIUM de Gate 1 resuelto): si `breed` no-NULL no
-- matchea el catálogo, el escalar devuelve NULL → breed_id := NULL. Es la opción CORRECTA: preserva la
-- consistencia breed↔breed_id (si el breed cambió a algo no-catalogado, el breed_id viejo es STALE → un
-- COALESCE que lo conservara dejaría breed='X' / breed_id=código-de-Y, inconsistente y exportaría un
-- código que no corresponde al breed mostrado). Y es FAIL-SAFE para el TXT SENASA: NULL → "a completar"
-- → excluido del export (R8.2), NUNCA entra con un código equivocado. El BreedPicker setea el nombre
-- EXACTO del catálogo → nunca NULL-ea por esta vía; el NULL-eo solo ocurre en paths no-picker (PATCH
-- directo / import CSV con nombre no-matcheante / legacy), donde "a completar" es el comportamiento correcto.
--
-- ⚠️ GUARD DE LA HERENCIA DEL TERNERO AL PIE (riesgo #1 — verificado por test T18(c)):
--   El ternero al pie se crea (0108 mono `tg_reproductive_events_create_calf` / 0109 mellizos
--   `register_birth`) con `breed_id` HEREDADO de la madre y `breed` NULL (el INSERT del perfil del
--   ternero setea `breed_id => v_mother_breed_id` y NO toca `breed`). El guard `NEW.breed IS NOT NULL`
--   asegura que el trigger NO pise ese breed_id heredado: cuando `breed` es NULL, NO se toca `breed_id`
--   (NO hay rama ELSE que lo anule). Así el ternero conserva la raza de la madre.
--
-- INTERACCIÓN CON LOS TRIGGERS EXISTENTES DE animal_profiles (verificado contra el árbol de migraciones):
--   * Es `BEFORE INSERT OR UPDATE OF breed` → solo dispara cuando `breed` está en el SET del statement.
--     Los otros `BEFORE ... OF <col>` (0079 identidad denorm, 0084 is_castrated, 0085 future_bull,
--     0054 teeth_state/is_cut/category_id) disparan por SUS columnas → ortogonales (un UPDATE que toca
--     `breed` no dispara los de ellos y viceversa). En un INSERT, todos los BEFORE INSERT corren; el
--     orden entre ellos es alfabético por nombre de trigger, pero NINGUNO lee/escribe `breed`/`breed_id`
--     → sin interferencia.
--   * NO interfiere con compute_category / el espejo C6: `breed_id` NO entra en el cálculo de categoría
--     (la categoría deriva de sexo + edad + eventos + is_castrated, NO de la raza). Verificado: ningún
--     trigger de categoría (0046, 0086, 0104) referencia breed/breed_id.
--   * NO hay RECURSIÓN: setear `NEW.breed_id` dentro de un `BEFORE ... OF breed` NO re-dispara un
--     `UPDATE OF breed` (es la MISMA fila NEW en vuelo, no un nuevo statement; y aunque lo fuera, el
--     trigger escucha `OF breed`, no `OF breed_id`).
--
-- NO SECURITY DEFINER (a propósito): corre en el CONTEXTO DEL WRITER. `breed_catalog` tiene SELECT
-- abierto a `authenticated` (0107) → el writer puede leerlo sin elevar privilegios. SECURITY DEFINER
-- sería innecesario y ampliaría superficie. Igual se REVOCA execute (defensa: la función de trigger no
-- debe poder invocarse como RPC desde el cliente — no expone nada, pero alinea con el patrón 0084).
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER. Re-correr no rompe.

create or replace function public.tg_derive_breed_id_from_breed ()
returns trigger language plpgsql as $$
begin
  -- Solo derivamos cuando hay un texto de raza. Con breed NULL NO se toca breed_id (preserva el breed_id
  -- HEREDADO de la madre en el ternero al pie, que entra con breed NULL + breed_id seteado por 0108/0109).
  if new.breed is not null then
    new.breed_id := (
      select bc.id from public.breed_catalog bc
      where lower(trim(bc.name)) = lower(trim(new.breed))
      limit 1
    );
  end if;
  return new;
end; $$;

comment on function public.tg_derive_breed_id_from_breed () is
  'Trigger BEFORE INSERT OR UPDATE OF breed: DERIVA animal_profiles.breed_id desde breed (nombre del '
  'catálogo) por match normalizado contra breed_catalog (spec 08, T18). Guard breed IS NOT NULL → NO pisa '
  'el breed_id heredado de la madre en el ternero al pie (breed NULL). NO SECURITY DEFINER (corre en '
  'contexto del writer; breed_catalog tiene SELECT abierto). breed_id NO entra en compute_category.';

-- Defensa: la función de trigger no debe ser invocable como RPC desde el cliente (no expone nada, pero
-- alinea con el patrón de las trigger-fns de 0084). El trigger la sigue ejecutando normal (el GRANT no
-- afecta el firing del trigger).
revoke execute on function public.tg_derive_breed_id_from_breed () from public, authenticated, anon;

drop trigger if exists animal_profiles_derive_breed_id on public.animal_profiles;
create trigger animal_profiles_derive_breed_id
  before insert or update of breed on public.animal_profiles
  for each row execute function public.tg_derive_breed_id_from_breed();

notify pgrst, 'reload schema';
