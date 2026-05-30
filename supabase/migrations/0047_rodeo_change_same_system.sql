-- 0047_rodeo_change_same_system.sql  (fold Tier 1 spec 02, sesión 20)
-- Item 5 del Tier 1: R4.5.1 relajada — permitir cambio de rodeo DENTRO del mismo sistema
-- productivo; rechazar el cruce de sistemas a nivel DB.
--
-- La verificación de mismo-sistema es exclusiva del UPDATE de rodeo_id (necesita old.rodeo_id),
-- así que vive en un trigger before update of rodeo_id separado, sin tocar el camino del alta.
-- La pertenencia al establecimiento + rodeo activo (R4.5) ya la enforce tg_animal_profiles_rodeo_check
-- (0021), que corre en before insert or update. SECURITY DEFINER: lee rodeos (RLS) para resolver
-- system_id de ambos rodeos sin rebotar por la policy durante el UPDATE.

create or replace function public.tg_animal_profiles_rodeo_same_system_check ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_old_system uuid; v_new_system uuid;
begin
  -- Solo aplica cuando el rodeo cambia en un UPDATE.
  if new.rodeo_id is not distinct from old.rodeo_id then
    return new;
  end if;
  select system_id into v_old_system from public.rodeos where id = old.rodeo_id;
  select system_id into v_new_system from public.rodeos where id = new.rodeo_id;
  if v_new_system is distinct from v_old_system then
    raise exception 'rodeo change across productive systems is not allowed (category dead-end, R4.6); same system_id required'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_rodeo_same_system_check
  before update of rodeo_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_rodeo_same_system_check();

notify pgrst, 'reload schema';
