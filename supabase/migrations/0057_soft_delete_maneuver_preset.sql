-- 0057_soft_delete_maneuver_preset.sql — spec 03 (Modo Maniobras), fix de soft-delete.
--
-- PROBLEMA (mismo que 0041 de spec 02): PostgREST exige que, tras un UPDATE, la fila
-- resultante siga siendo visible según la policy de SELECT de la tabla. La policy
-- `maneuver_presets_select` incluye `deleted_at is null`, así que un soft-delete por
-- UPDATE (set deleted_at = now()) deja la fila fuera del SELECT y el write es rechazado
-- con 42501. Es DETERMINISTA (no flake del remoto compartido).
--
-- DECISIÓN: exponemos una función SECURITY DEFINER de soft-delete que (a) re-valida la
-- misma autorización que la policy de UPDATE (`has_role_in` — cualquier rol operativo
-- activo, NO owner-only) y (b) hace el UPDATE de deleted_at por dentro (bypass de la
-- verificación de visibilidad de PostgREST). Patrón idéntico a `soft_delete_management_group`
-- de 0041 (spec 02). El comportamiento de autorización y de lectura (R12.3) queda igual.

-- maneuver_preset: cualquier rol operativo activo del establishment (has_role_in),
-- consistente con la policy `maneuver_presets_update` (R2.4/R2.5).
create or replace function public.soft_delete_maneuver_preset (p_preset_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.maneuver_presets where id = p_preset_id and deleted_at is null;
  if v_est is null then
    raise exception 'maneuver_preset not found' using errcode = 'P0002';
  end if;
  if not public.has_role_in(v_est) then
    raise exception 'not allowed to delete this maneuver_preset' using errcode = '42501';
  end if;
  update public.maneuver_presets set deleted_at = now() where id = p_preset_id;
end; $$;

grant execute on function public.soft_delete_maneuver_preset (uuid) to authenticated;

notify pgrst, 'reload schema';
