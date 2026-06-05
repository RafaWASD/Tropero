-- 0064_castration_transition.sql — Tier 2/3 spec 02. Efecto de categoría de is_castrated (DD-2).
-- Cubre RT2.2.2, RT2.2.3, RT2.2.4, RT2.2.5, RT2.2.6, RT2.10.4.
--
-- is_castrated vive en `animals`; la categoría en `animal_profiles`. El trigger reacciona al
-- cambio de is_castrated sobre `animals` (AFTER UPDATE OF is_castrated) y aplica la transición
-- sobre el perfil ACTIVO de ese animal (a lo sumo uno, unique parcial 0020).
--   - Solo actúa en false->true (RT2.2.3/2.2.4). true->false NO revierte (RT2.2.6).
--   - Para ternero/ternera no cambia nada (compute_category devuelve ternero/ternera mientras no
--     haya destete/edad) → RT2.2.2: el efecto se difiere al destete.
--   - Respeta override (RT2.2.5).
--   - DELEGA a compute_category: para torito/toro da novillito/novillo según el corte de 2 años;
--     hardcodear torito->novillito mandaría mal un toro recién castrado de >2 años. RT2.10.4: la
--     transición queda en animal_category_history como auto_transition (vía apply_auto_transition).
--
-- Seguridad (RT2.12.4/2.12.5): deriva el perfil de la FILA REAL del animal (where animal_id =
-- new.id), no de un parámetro del cliente. La RLS de `animals` (0022) ya filtró el UPDATE antes
-- de que el trigger corra → el perfil afectado es del propio tenant del usuario.

create or replace function public.tg_animals_apply_castration ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_profile_id uuid;
  v_override boolean;
  v_current uuid;
  v_target uuid;
begin
  -- solo nos interesa el cambio false -> true (RT2.2.3/2.2.4); true->false no revierte (RT2.2.6).
  if not (old.is_castrated = false and new.is_castrated = true) then
    return new;
  end if;
  -- perfil ACTIVO de este animal (a lo sumo uno, unique parcial 0020). DD-2.
  select id, category_override, category_id
    into v_profile_id, v_override, v_current
  from public.animal_profiles
  where animal_id = new.id and status = 'active' and deleted_at is null
  limit 1;
  if v_profile_id is null then return new; end if;
  if v_override is null or v_override = true then return new; end if;  -- R4.9 / RT2.2.5

  -- compute_category ya lee is_castrated; delegar garantiza consistencia (RT2.10.1).
  -- torito/toro -> novillito/novillo; ternero/ternera -> sin cambio (RT2.2.2).
  v_target := public.compute_category(v_profile_id);
  if v_target is not null and v_target is distinct from v_current then
    perform public.apply_auto_transition(v_profile_id, v_target);  -- history auto_transition (RT2.10.4)
  end if;
  return new;
end; $$;

create trigger animals_apply_castration
  after update of is_castrated on public.animals
  for each row execute function public.tg_animals_apply_castration();

notify pgrst, 'reload schema';
