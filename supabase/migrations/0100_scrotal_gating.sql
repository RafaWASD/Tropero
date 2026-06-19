-- 0100_scrotal_gating.sql  (spec 03 — MODO MANIOBRAS, chunk M6 / R14.11, R14.12) — design.md §12.4
-- ⚠️ Corazón de seguridad de M6: gating capa 2 (DB) fail-closed de la CE. Defensa en profundidad sobre la UI.
--
-- single-key: REUSA assert_data_keys_enabled (0054) — NO se crea helper nuevo. El single-key
-- array['circunferencia_escrotal'] entra limpio en el assert genérico (igual que tg_weight_events_gating
-- con ['peso']). El helper de 0054 es fail-closed por construcción (Gate 1 Foco 3):
--   - rodeo no resoluble (perfil inexistente o deleted_at IS NOT NULL) → raise 23514, NUNCA pasa (sin
--     early-return fail-open, SEC-SPEC-03-03);
--   - data_key faltante / no-enabled → raise 23514.
--
-- Independiente de la UI / no-bypass por rol (R14.12): es un trigger BEFORE INSERT server-side → un INSERT
-- directo por PostgREST/sync sobre un rodeo sin 'circunferencia_escrotal' enabled se rechaza aunque la UI
-- nunca lo hubiera ofrecido. SECURITY DEFINER + search_path=public + EXECUTE revocado (R11.4) → no es RPC.
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear. NO `supabase db push`.

begin;

create or replace function public.tg_scrotal_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_data_keys_enabled(new.animal_profile_id, array['circunferencia_escrotal']);
  return new;
end; $$;
revoke execute on function public.tg_scrotal_gating () from public, authenticated, anon;
create trigger scrotal_gating
  before insert on public.scrotal_measurements
  for each row execute function public.tg_scrotal_gating();

notify pgrst, 'reload schema';

commit;
