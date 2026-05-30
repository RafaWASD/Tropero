-- 0046_category_recompute_on_event_change.sql  (fold Tier 1 spec 02, sesión 20)
-- Item 4 del Tier 1: recálculo de categoría al editar/borrar un evento que disparó
-- transición (típicamente un reproductive_events de tacto positivo o birth).
-- Cubre R6.14 (recálculo), R6.8.1 (corrección sin ventana), R4.7.1.
--
-- Solo sobre reproductive_events (única tipada que participa de transiciones en Tier 1).
-- Recomputa vía compute_category SOLO si category_override = false (NULL conservador = no
-- recalcula). Reusa apply_auto_transition → registra en animal_category_history como
-- auto_transition y NO marca override. SECURITY DEFINER conserva el derecho de invocar
-- apply_auto_transition pese al revoke de 0042 (corre como owner del schema).

create or replace function public.tg_reproductive_events_recompute_on_change ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_override boolean; v_target uuid; v_profile uuid;
begin
  v_profile := coalesce(new.animal_profile_id, old.animal_profile_id);
  select category_override into v_override from public.animal_profiles where id = v_profile;
  if v_override is null or v_override = true then
    return coalesce(new, old);   -- override manda (R4.9); NULL conservador = no recalcula
  end if;
  v_target := public.compute_category(v_profile);
  if v_target is not null then
    perform public.apply_auto_transition(v_profile, v_target);  -- reusa GUC + history (auto_transition)
  end if;
  return coalesce(new, old);
end; $$;

-- AFTER UPDATE: solo cuando cambia algo relevante a una transición (incl. deleted_at = soft-delete).
create trigger reproductive_events_recompute_on_update
  after update of event_type, pregnancy_status, deleted_at on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_on_change();

-- AFTER DELETE: cubre el hard-delete (raro; el flujo normal es soft-delete vía UPDATE de
-- deleted_at, que ya entra por el trigger de UPDATE de arriba).
create trigger reproductive_events_recompute_on_delete
  after delete on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_on_change();

notify pgrst, 'reload schema';
