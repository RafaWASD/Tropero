-- 0095_custom_attributes.sql  (spec 03 — MODO MANIOBRAS, chunk M5 / R13.12) — transcribe design.md §11.3
-- Valor ACTUAL de una propiedad custom (upsert, sin historial; patrón teeth_state). data_type='propiedad'
-- custom escribe acá. Editable en cualquier momento (R13.12).
--
-- SEGURIDAD (security_spec M5):
--   - audit forzado: updated_by = auth.uid() (R13.23); establishment_id derivado del PERFIL (anti-spoof, 0077);
--     updated_at = now(). BEFORE INSERT *Y* UPDATE → cubre el vector "pisar establishment_id con UPDATE".
--   - tg_custom_attributes_force_audit: SECURITY DEFINER + search_path=public + EXECUTE revocado (R13.24).
--   - RLS canónico tenant has_role_in en SELECT/INSERT/UPDATE (R13.13/R13.22).
--   - DM5-2 (confirmado por Raf): EDIT de propiedad custom = cualquier rol operativo activo (has_role_in),
--     paridad con la captura (R13.13) y con teeth_state. NO se restringe a owner+creador.
--   - el gating capa 2 genérico + la validación de value viven en 0096 (tg_custom_attributes_gating).
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear.

begin;

create table public.custom_attributes (
  animal_profile_id   uuid not null references public.animal_profiles(id) on delete cascade,
  field_definition_id uuid not null references public.field_definitions(id),
  establishment_id    uuid not null references public.establishments(id) on delete cascade,  -- denorm para sync
  value               jsonb not null,           -- validado por ui_component server-side (0096)
  updated_by          uuid references public.users(id),                         -- forzado a auth.uid()
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  primary key (animal_profile_id, field_definition_id),
  constraint custom_attributes_value_size check (octet_length(value::text) < 4096)
);

create index custom_attributes_by_field on public.custom_attributes (field_definition_id);
create index custom_attributes_by_est   on public.custom_attributes (establishment_id);

create or replace function public.tg_custom_attributes_force_audit ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.establishment_id := public.establishment_of_profile(new.animal_profile_id);  -- helper 0023
  new.updated_at := now();
  return new;
end; $$;
revoke execute on function public.tg_custom_attributes_force_audit () from public, authenticated, anon;
create trigger custom_attributes_force_audit
  before insert or update on public.custom_attributes
  for each row execute function public.tg_custom_attributes_force_audit();

alter table public.custom_attributes enable row level security;
create policy custom_attributes_select on public.custom_attributes
  for select using (has_role_in(establishment_id));
create policy custom_attributes_insert on public.custom_attributes
  for insert with check (has_role_in(establishment_id));   -- cualquier rol operativo (R13.13); editable anytime (R13.12)
create policy custom_attributes_update on public.custom_attributes
  for update using (has_role_in(establishment_id)) with check (has_role_in(establishment_id));
grant select, insert, update on public.custom_attributes to authenticated;
grant all on public.custom_attributes to service_role;

notify pgrst, 'reload schema';

commit;
