-- 0067_nursing_birth_calves_trigger.sql — Tier 2/3 spec 02. Fix de cría al pie para mellizos.
-- Cubre RT2.9.1 (refuerzo). NO edita 0061 (regla dura) — migración nueva.
--
-- PROBLEMA (cazado en autorrevisión): el trigger de nursing de 0061 recomputa al insertar el
-- evento `birth`. En el camino MELLIZOS (RPC register_birth, 0045), el evento `birth` se inserta
-- ANTES de poblar birth_calves (el loop crea los terneros + filas puente después). El AFTER INSERT
-- de nursing corre con birth_calves AÚN VACÍO para ese parto → compute_nursing = false → la madre
-- queda nursing=false pese a haber parido. (El camino MONO no sufre: tg_reproductive_events_create_calf
-- es BEFORE INSERT y puebla birth_calves antes del AFTER INSERT.)
--
-- FIX: recomputar nursing también al insertar una fila en birth_calves. Resuelve la madre vía
-- birth_event_id -> reproductive_events.animal_profile_id y recomputa. Cubre ambos caminos:
--   - mono:     birth_calves ya existe al AFTER INSERT del birth (sin cambio); este trigger reafirma.
--   - mellizos: cada birth_calves insertado dispara el recompute con la fila ya visible → nursing=true.
-- El UPDATE de nursing solo ocurre si cambia (guard nursing is distinct from), idempotente.
-- birth_calves se puebla SOLO server-side (sin GRANT INSERT al cliente), así que este trigger no
-- abre superficie nueva. SECURITY DEFINER + search_path=public, EXECUTE revocado de clientes.

create or replace function public.tg_birth_calves_recompute_nursing ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mother uuid;
  v_new boolean;
begin
  select be.animal_profile_id into v_mother
  from public.reproductive_events be
  where be.id = new.birth_event_id and be.event_type = 'birth';
  if v_mother is null then return new; end if;
  v_new := public.compute_nursing(v_mother);
  update public.animal_profiles
    set nursing = v_new
    where id = v_mother and nursing is distinct from v_new;
  return new;
end; $$;
revoke execute on function public.tg_birth_calves_recompute_nursing () from public, authenticated, anon;

create trigger birth_calves_recompute_nursing
  after insert on public.birth_calves
  for each row execute function public.tg_birth_calves_recompute_nursing();

notify pgrst, 'reload schema';
