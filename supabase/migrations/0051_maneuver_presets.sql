-- 0051_maneuver_presets.sql  (spec 03 — MODO MANIOBRAS)
-- Presets de maniobra (scope establishment, R2.4). config es el mismo shape que sessions.config;
-- al aplicarse se COPIA dentro de una sesión (by-value, en la capa app). IDs cliente (R2.5).
-- Multi-tenant vía RLS has_role_in. created_by forzado (R11.2). updated_at_generic (0016).
-- CHECK de tamaño del jsonb (SEC-SPEC-03-06).

create table public.maneuver_presets (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  config            jsonb not null default '{}'::jsonb,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint maneuver_presets_name_not_empty check (length(trim(name)) > 0),
  -- SEC-SPEC-03-06: mismo limite de tamano que sessions.config.
  constraint maneuver_presets_config_size check (octet_length(config::text) < 16384)
);

create index maneuver_presets_by_est on public.maneuver_presets (establishment_id) where deleted_at is null;

create trigger maneuver_presets_force_created_by
  before insert on public.maneuver_presets
  for each row execute function public.tg_force_created_by_auth_uid();

create trigger maneuver_presets_set_updated_at
  before update on public.maneuver_presets
  for each row execute function public.tg_set_updated_at_generic();

alter table public.maneuver_presets enable row level security;

create policy maneuver_presets_select on public.maneuver_presets
  for select using (has_role_in(establishment_id) and deleted_at is null);
create policy maneuver_presets_insert on public.maneuver_presets
  for insert with check (has_role_in(establishment_id));
create policy maneuver_presets_update on public.maneuver_presets
  for update using (has_role_in(establishment_id))
  with check (has_role_in(establishment_id));

grant select, insert, update on public.maneuver_presets to authenticated;
grant all on public.maneuver_presets to service_role;

notify pgrst, 'reload schema';
