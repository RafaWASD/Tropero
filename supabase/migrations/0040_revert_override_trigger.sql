-- 0040_revert_override_trigger.sql  (fix de implementación de spec 02)
-- R4.10: revertir el override (set category_override = false) y recalcular categoría.
-- El trigger BEFORE tg_animal_profiles_set_override_on_manual (0021) marcaba
-- category_override = true en CUALQUIER cambio de category_id fuera de transición
-- automática, incluso cuando el UPDATE de revert seteaba explícitamente
-- category_override = false en el mismo statement. Eso pisaba el revert y hacía que
-- el historial registrara 'manual_override' en vez de 'revert_to_auto'.
--
-- Refinamiento: si el statement está clareando el override explícitamente
-- (old.category_override = true AND new.category_override = false), respetamos el
-- false (es un revert R4.10, no un override manual). En el resto de los casos, el
-- comportamiento original se mantiene (cambio manual de categoría marca override).

create or replace function public.tg_animal_profiles_set_override_on_manual ()
returns trigger language plpgsql as $$
begin
  if new.category_id is distinct from old.category_id then
    -- Revert explícito (R4.10): el usuario clarea el override en el mismo update.
    if old.category_override = true and new.category_override = false then
      return new;  -- respetar el revert; no re-marcar override.
    end if;
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') <> 'on' then
      new.category_override := true;
    end if;
  end if;
  return new;
end; $$;
