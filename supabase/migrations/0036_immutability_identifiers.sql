-- 0036_immutability_identifiers.sql  (spec 02 lógico: 0035)
-- Inmutabilidad post-completitud de identificadores formales (R4.13):
-- - NULL -> valor permitido (completar caravana que faltaba al alta; spec 09 R7/R8).
-- - valor -> otro valor prohibido (reescribir identidad rompe trazabilidad SENASA).
-- - valor -> NULL prohibido (defensivo).
-- visual_id_alt queda fuera del bloqueo (texto libre).
-- Cubre R4.13.

create or replace function public.tg_animals_block_tag_change ()
returns trigger language plpgsql as $$
begin
  -- Permitir NULL -> valor (asignación inicial de caravana).
  if old.tag_electronic is null then
    return new;
  end if;
  if new.tag_electronic is distinct from old.tag_electronic then
    raise exception 'tag_electronic is immutable once set (animal %); use soft-delete + new insert to correct an erroneous TAG', old.id
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animals_block_tag_change
  before update of tag_electronic on public.animals
  for each row execute function public.tg_animals_block_tag_change();

create or replace function public.tg_animal_profiles_block_idv_change ()
returns trigger language plpgsql as $$
begin
  if old.idv is null then
    return new;
  end if;
  if new.idv is distinct from old.idv then
    raise exception 'idv is immutable once set (profile %); use soft-delete + new insert to correct an erroneous IDV', old.id
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_block_idv_change
  before update of idv on public.animal_profiles
  for each row execute function public.tg_animal_profiles_block_idv_change();
