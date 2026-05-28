-- 0039_identity_check_security_definer.sql  (fix de implementación de spec 02)
-- El trigger BEFORE INSERT tg_animal_profiles_identity_check (0021) lee
-- animals.tag_electronic, pero un animal recién insertado es invisible vía RLS
-- (animals_select deriva de la existencia de un animal_profile, que todavía no
-- existe en ese instante). Sin security definer, el SELECT del trigger respeta
-- la RLS del usuario y devuelve NULL para el TAG, haciendo fallar el check R4.2
-- aun cuando el animal SÍ tiene TAG. Lo redefinimos como security definer para
-- que vea la fila real. Mismo comportamiento de validación, sin el falso negativo.

create or replace function public.tg_animal_profiles_identity_check ()
returns trigger language plpgsql
security definer set search_path = public as $$
declare v_tag text;
begin
  select tag_electronic into v_tag from public.animals where id = new.animal_id;
  if coalesce(nullif(trim(v_tag), ''),
              nullif(trim(new.idv), ''),
              nullif(trim(new.visual_id_alt), '')) is null then
    raise exception 'animal must have at least one of tag_electronic, idv or visual_id_alt'
      using errcode = '23514';
  end if;
  return new;
end; $$;
