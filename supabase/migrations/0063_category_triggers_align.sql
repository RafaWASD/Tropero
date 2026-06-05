-- 0063_category_triggers_align.sql — Tier 2/3 spec 02. Incremental + recálculo delegan a compute_category.
-- Cubre RT2.5.1-RT2.5.3, RT2.6.1-RT2.6.4, RT2.7.1, RT2.7.3, RT2.7.4, RT2.7.6,
--       RT2.10.1, RT2.10.2, RT2.10.3.
--
-- (A) Trigger incremental: el as-built (0031) hardcodea cada target. Con servicio/destete/
--     parto-desde-cualquier-categoría/aborto el árbol de if se vuelve frágil y diverge del
--     recompute. Decisión (design §3.2): el incremental DELEGA a compute_category y aplica el
--     resultado vía apply_auto_transition. Así incremental y recompute usan la MISMA función →
--     RT2.10.1 es cierto por construcción.
--     compute_category cuenta los eventos deleted_at IS NULL del perfil. En AFTER INSERT, la
--     fila NEW ya está visible en la transacción → el conteo/existencia ya incluye el evento
--     recién insertado. (El trigger es AFTER INSERT, 0031 l.130.)
--
-- (B) Trigger de recálculo (0046): se RE-CREA (drop+create, NO se edita 0046) ampliando el OF
--     a event_date — un aborto cuya fecha se mueve antes/después de un tacto cambia RT2.7.5.
--     La función tg_reproductive_events_recompute_on_change NO cambia (ya delega a
--     compute_category). El trigger AFTER DELETE de 0046 se conserva.

-- (A) Incremental delega a compute_category.
create or replace function public.tg_reproductive_events_apply_transition ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_override boolean;
  v_current uuid;
  v_target uuid;
begin
  -- solo event_type que participan de transiciones (evita recomputar de gusto).
  if new.event_type not in ('tacto','service','weaning','birth','abortion') then
    return new;
  end if;
  select category_override, category_id into v_override, v_current
  from public.animal_profiles where id = new.animal_profile_id;
  if v_override is null or v_override = true then
    return new;  -- override manda (R4.9) — cláusulas de override de RT2.5.3/2.6.4/2.7.6/2.11.1
  end if;
  v_target := public.compute_category(new.animal_profile_id);
  if v_target is not null and v_target is distinct from v_current then
    perform public.apply_auto_transition(new.animal_profile_id, v_target);  -- GUC + history auto_transition
  end if;
  return new;
end; $$;
-- El trigger AFTER INSERT reproductive_events_apply_transition (0031) ya existe; se conserva su
-- definición (apunta a esta misma función, recién reemplazada con CREATE OR REPLACE).

-- (B) Recrear el trigger de recálculo on-update ampliando el OF a event_date.
drop trigger if exists reproductive_events_recompute_on_update on public.reproductive_events;
create trigger reproductive_events_recompute_on_update
  after update of event_type, pregnancy_status, event_date, deleted_at on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_on_change();
-- El trigger AFTER DELETE reproductive_events_recompute_on_delete (0046) se conserva.

notify pgrst, 'reload schema';
