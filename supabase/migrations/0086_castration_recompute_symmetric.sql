-- 0086_castration_recompute_symmetric.sql — spec 10 Fase 1, design §4.3. Cubre R13.5, R5.7.
--
-- D10: castrado es ESTADO editable y reversible → el recompute debe ser SIMÉTRICO. Supersede
-- RT2.2.6 ("true->false no revierte") de spec 02 Tier 2 — la nota de reconciliación en esa spec la
-- coordina el LEADER (no se editan docs de spec 02 desde esta spec).
--
-- Verificado contra 0064 (as-built en remoto, pre-flight): el guard era
--   if not (old.is_castrated = false and new.is_castrated = true) then return new; end if;
-- → el revert true->false no recalculaba. Fix: reemplazar SOLO EL CUERPO de la función real
-- tg_animals_apply_castration (CREATE OR REPLACE) con guard dirección-agnóstico (IS NOT DISTINCT FROM),
-- conservando todo lo demás (perfil activo único, respeto de override, delegación a compute_category
-- y apply_auto_transition + history). El trigger animals_apply_castration (AFTER UPDATE OF is_castrated,
-- 0064) NO se re-crea.
--
-- NO aplicar al remoto desde acá: vía scripts/apply-migration.mjs (Management API). Idempotente.

begin;

create or replace function public.tg_animals_apply_castration ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_profile_id uuid;
  v_override boolean;
  v_current uuid;
  v_target uuid;
begin
  -- SIMÉTRICO (spec 10 R13.5): cualquier cambio real de is_castrated recalcula.
  -- false->true: torito->novillito / toro->novillo. true->false: novillito->torito / novillo->toro.
  if new.is_castrated is not distinct from old.is_castrated then
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

  v_target := public.compute_category(v_profile_id);   -- delega: consistencia con 0062 (RT2.10.1)
  if v_target is not null and v_target is distinct from v_current then
    perform public.apply_auto_transition(v_profile_id, v_target);      -- history auto_transition
  end if;
  return new;
end; $$;
-- revoke ya emitido en 0064; re-emitir idempotente (patrón 0055):
revoke execute on function public.tg_animals_apply_castration () from public, authenticated, anon;

notify pgrst, 'reload schema';

commit;
