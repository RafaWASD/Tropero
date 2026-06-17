-- 0094_custom_measurements.sql  (spec 03 — MODO MANIOBRAS, chunk M5 / R13.11) — transcribe design.md §11.2
-- Captura de maniobra/evento custom (append-only, time-series): habilita seguimiento/gráficos (spec 07).
-- Una fila por captura. data_type='maniobra' custom escribe acá.
--
-- SEGURIDAD (security_spec M5):
--   - audit forzado server-side: recorded_by = auth.uid() (R13.23); establishment_id derivado del PERFIL
--     (anti-spoof, paridad 0077) — NO del payload → un INSERT con animal_profile_id ajeno termina con el
--     establishment del perfil real y la RLS has_role_in lo bloquea.
--   - tg_custom_measurements_force_audit: SECURITY DEFINER + search_path=public + EXECUTE revocado (R13.24).
--   - M5-SEC-05: cap autoritativo de notes (texto libre del operario por PostgREST directo).
--   - RLS canónico tenant has_role_in en SELECT/INSERT/UPDATE (R13.13/R13.22).
--   - el gating capa 2 genérico + la validación de value viven en 0096 (tg_custom_measurements_gating).
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear.

begin;

create table public.custom_measurements (
  id                  uuid primary key default gen_random_uuid(),
  animal_profile_id   uuid not null references public.animal_profiles(id) on delete cascade,
  field_definition_id uuid not null references public.field_definitions(id),
  establishment_id    uuid not null references public.establishments(id) on delete cascade,  -- denorm (ADR-026) sync JOIN-free
  value               jsonb not null,           -- validado por ui_component server-side (0096)
  session_id          uuid references public.sessions(id) on delete set null,  -- maniobra custom en una jornada
  recorded_by         uuid references public.users(id),                         -- forzado a auth.uid()
  recorded_at         timestamptz not null default now(),
  notes               text,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint custom_measurements_value_size check (octet_length(value::text) < 4096),  -- cap (R13.16/R13.17)
  -- M5-SEC-05: notes es texto libre del operario (cualquier rol con has_role_in, R13.13) escrito por
  -- PostgREST directo → cap autoritativo (paridad con los *.notes de 0070).
  constraint custom_measurements_notes_len check (notes is null or char_length(notes) <= 500)
);

create index custom_measurements_by_field_animal
  on public.custom_measurements (field_definition_id, animal_profile_id, recorded_at) where deleted_at is null;
create index custom_measurements_by_session
  on public.custom_measurements (session_id) where session_id is not null;
create index custom_measurements_by_est
  on public.custom_measurements (establishment_id) where deleted_at is null;

-- recorded_by forzado server-side (R13.23). establishment_id derivado del perfil (anti-spoof, patrón 0077).
create or replace function public.tg_custom_measurements_force_audit ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.recorded_by := auth.uid();
  new.establishment_id := public.establishment_of_profile(new.animal_profile_id);  -- helper 0023
  return new;
end; $$;
revoke execute on function public.tg_custom_measurements_force_audit () from public, authenticated, anon;
create trigger custom_measurements_force_audit
  before insert on public.custom_measurements
  for each row execute function public.tg_custom_measurements_force_audit();

alter table public.custom_measurements enable row level security;
create policy custom_measurements_select on public.custom_measurements
  for select using (has_role_in(establishment_id) and deleted_at is null);
create policy custom_measurements_insert on public.custom_measurements
  for insert with check (has_role_in(establishment_id));   -- cualquier rol operativo (R13.13)
create policy custom_measurements_update on public.custom_measurements   -- soft-delete/corrección por rol activo (DM5-3)
  for update using (has_role_in(establishment_id)) with check (has_role_in(establishment_id));
grant select, insert, update on public.custom_measurements to authenticated;
grant all on public.custom_measurements to service_role;

notify pgrst, 'reload schema';

commit;
