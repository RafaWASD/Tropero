-- 0098_scrotal_measurements.sql  (spec 03 — MODO MANIOBRAS, chunk M6 / US-14) — transcribe design.md §12.3
-- ⚠️ TABLA DE EVENTO TIPADA NUEVA + data_key/seed/gating (0099/0100) → Gate 1 OBLIGATORIO
--    (PASS, ver progress/security_spec_03-m6-circunferencia.md, 0 HIGH).
--
-- Circunferencia escrotal (CE) del toro entero (R14.5–R14.18). Append-only, longitudinal: una medición
-- numérica per-animal en el tiempo + la edad-acompañante (snapshot per-medida). Espeja EXACTO el patrón de
-- weight_events (0025) / condition_score_events (0028) + la denormalización de establishment_id de 0077:
--   - circumference_cm numeric(4,1) CHECK 20–50 (rango de la rueda R14.5; cap autoritativo server-side).
--   - age_months int nullable CHECK 0–600 (snapshot R14.8; null = edad desconocida).
--   - session_id FK ON DELETE SET NULL + tenant-check (R5.11) — reusa tg_event_session_tenant_check (0056).
--   - establishment_id DENORMALIZADO (ADR-026) para el sync JOIN-free, FORZADO por el MISMO trigger
--     anti-spoof de 0077 (tg_force_establishment_id_from_profile, before insert OR update) → NOT NULL al final.
--   - recorded_by FORZADO a auth.uid() por un trigger dedicado (la columna se llama distinto que created_by).
--   - RLS canónico tenant (R14.15): SELECT/INSERT has_role_in(establishment_id); UPDATE owner o recorded_by
--     (corrección/soft-delete append-only, R14.17) — espeja weight_events (is_owner_of OR created_by).
--
-- POR QUÉ la RLS deriva el tenant por la COLUMNA DENORM (has_role_in(establishment_id)) y no por FK
-- (has_role_in(establishment_of_profile(animal_profile_id)) como weight_events 0025): M6 espeja el patrón
-- POST-M5 (custom_measurements 0094), donde establishment_id ya es load-bearing (forzado por trigger) y el
-- WITH CHECK del INSERT lo ve YA FORZADO (el BEFORE INSERT corre antes del RLS WITH CHECK) → un INSERT con
-- animal_profile_id de otro tenant termina con el establishment del perfil real y has_role_in lo rechaza.
-- Gate 1 Foco 1 verificó que NO es una divergencia (es la fórmula de 0094, ya gateada PASS).
--
-- SEGURIDAD (security_spec M6, PASS):
--   - anti-spoof establishment_id (R14.9): tg_force_establishment_id_from_profile (0077), INSERT *Y* UPDATE.
--   - anti-spoof recorded_by (R14.9): tg_scrotal_force_recorded_by, SECDEF + search_path + EXECUTE revocado.
--   - session_id tenant-check (R5.11): tg_event_session_tenant_check (0056) — genérico por animal_profile_id/
--     session_id (Gate 1 Foco 4 verificó que NO lee columnas que scrotal_measurements no tenga → reuso, no clon).
--     Forma `before insert or update` (sin `OF session_id`) = la forma del trigger _ins de 0056 que SÍ dispara
--     en INSERT (no recae en el bug de 0052 que 0056 arregló; el test de no-bypass B.5 (i) lo garantiza).
--   - cap autoritativo de notes (texto libre del operario por PostgREST directo, paridad 0070/custom_measurements).
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear (Gate 1 spec hecho + Gate 2 + reviewer).
-- NO `supabase db push`.

begin;

create table public.scrotal_measurements (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  establishment_id   uuid references public.establishments(id) on delete cascade,  -- denorm (forzado, NOT NULL al final)
  session_id         uuid,                 -- maniobra en una jornada (FK + tenant-check abajo); null = carga desde ficha
  circumference_cm   numeric(4,1) not null check (circumference_cm >= 20 and circumference_cm <= 50),  -- rango de la rueda (R14.5)
  age_months         int check (age_months is null or (age_months >= 0 and age_months <= 600)),         -- snapshot, nullable (R14.8)
  measured_at        date not null,
  source             public.event_source not null default 'manual',  -- reusa el enum de 0025 (manual MVP)
  notes              text,
  recorded_by        uuid references public.users(id),               -- forzado a auth.uid()
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint scrotal_measurements_notes_len check (notes is null or char_length(notes) <= 500)  -- paridad 0070
);

create index scrotal_measurements_by_profile_date
  on public.scrotal_measurements (animal_profile_id, measured_at desc) where deleted_at is null;
create index scrotal_measurements_by_session
  on public.scrotal_measurements (session_id) where session_id is not null;
create index scrotal_measurements_by_est
  on public.scrotal_measurements (establishment_id) where deleted_at is null;

-- recorded_by forzado server-side (R14.9): patrón tg_force_created_by_auth_uid (0043) — un trigger análogo
-- que setea recorded_by := auth.uid() (la columna se llama distinto que created_by → trigger dedicado).
create or replace function public.tg_scrotal_force_recorded_by ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.recorded_by := auth.uid();   -- ignora cualquier valor que venga en el INSERT del cliente (anti-spoof)
  return new;
end; $$;
revoke execute on function public.tg_scrotal_force_recorded_by () from public, authenticated, anon;
create trigger scrotal_force_recorded_by
  before insert on public.scrotal_measurements
  for each row execute function public.tg_scrotal_force_recorded_by();

-- establishment_id forzado desde el perfil (anti-spoof, R14.9): REUSA tg_force_establishment_id_from_profile (0077).
-- before insert OR update: cierra el vector "pisar la columna con un UPDATE por PostgREST directo" (mismo
-- criterio que 0077 documenta como crítico para la frontera WAL).
create trigger scrotal_force_establishment_id
  before insert or update on public.scrotal_measurements
  for each row execute function public.tg_force_establishment_id_from_profile();

-- (orden seguro: la columna nace nullable; al ser tabla nueva no hay backfill; SET NOT NULL tras el trigger
--  force → el BEFORE INSERT siempre setea un valor no-NULL antes de evaluar el constraint; cero ventana de NULL)
alter table public.scrotal_measurements alter column establishment_id set not null;

-- FK + tenant-check de session_id (R5.11) — espeja §2.3 (eventos de spec 02). ON DELETE SET NULL.
alter table public.scrotal_measurements
  add constraint scrotal_measurements_session_fk foreign key (session_id) references public.sessions(id) on delete set null;
-- tenant-check intra/cross (REUSA tg_event_session_tenant_check de 0052/0056, genérico por animal_profile_id/
-- session_id/rodeo — Gate 1 Foco 4): el session_id debe ser del mismo establishment que el animal + sesión
-- active + rodeo coincidente. La forma `before insert or update` SÍ dispara en INSERT (test B.5 (i)).
create trigger scrotal_measurements_session_tenant_check
  before insert or update on public.scrotal_measurements
  for each row execute function public.tg_event_session_tenant_check();

alter table public.scrotal_measurements enable row level security;
create policy scrotal_measurements_select on public.scrotal_measurements
  for select using (has_role_in(establishment_id) and deleted_at is null);
create policy scrotal_measurements_insert on public.scrotal_measurements
  for insert with check (has_role_in(establishment_id));   -- cualquier rol operativo (R11.6)
create policy scrotal_measurements_update on public.scrotal_measurements   -- corrección/soft-delete owner o recorded_by (R14.17)
  for update using (is_owner_of(establishment_id) or recorded_by = auth.uid())
  with check (is_owner_of(establishment_id) or recorded_by = auth.uid());
grant select, insert, update on public.scrotal_measurements to authenticated;
grant all on public.scrotal_measurements to service_role;

notify pgrst, 'reload schema';

commit;
