-- 0050_sessions.sql  (spec 03 — MODO MANIOBRAS)
-- Jornada de maniobra. NO es "lote" (el lote es management_groups, ADR-020; ver design §2.1).
-- Una sesión = exactamente un rodeo del establecimiento (R1.1). IDs cliente (UUID) para
-- crear/operar offline (R1.11). Multi-tenant vía RLS canónico has_role_in (R11.1, R11.3).
-- created_by forzado server-side (R11.2, reusa tg_force_created_by_auth_uid de 0043).
-- updated_at vía tg_set_updated_at_generic (0016). CHECK de tamaño del jsonb (SEC-SPEC-03-06).

create type public.session_status as enum ('active', 'closed');

create table public.sessions (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  rodeo_id          uuid not null references public.rodeos(id),
  -- snapshot de la config de la jornada: maniobras elegidas + parametros fijos de tanda + preset_id origen
  config            jsonb not null default '{}'::jsonb,
  status            public.session_status not null default 'active',
  -- lote de trabajo informativo, NO-autoritativo (R9.4): texto libre, nunca FK asignadora a management_groups
  work_lot_label    text,
  -- contadores app-maintained (D5); el conteo autoritativo se recomputa con count(*)
  animal_count      int not null default 0,
  event_count       int not null default 0,
  notes             text,
  created_by        uuid references public.users(id),  -- forzado server-side a auth.uid()
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  -- SEC-SPEC-03-06: acota el jsonb libre del cliente encolado vía sync. 16 KiB sobra.
  constraint sessions_config_size check (octet_length(config::text) < 16384)
);

create index sessions_by_est    on public.sessions (establishment_id) where deleted_at is null;
create index sessions_by_rodeo  on public.sessions (rodeo_id)         where deleted_at is null;
create index sessions_active    on public.sessions (establishment_id, status) where deleted_at is null;

-- created_by audit-trail no spoofeable (R11.2): reusa el helper de spec 02 (0043).
create trigger sessions_force_created_by
  before insert on public.sessions
  for each row execute function public.tg_force_created_by_auth_uid();

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.tg_set_updated_at_generic();

-- el rodeo de la sesion debe ser del mismo establishment, activo y vivo (R1.1, R1.3).
create or replace function public.tg_sessions_rodeo_check ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.rodeos r
    where r.id = new.rodeo_id and r.establishment_id = new.establishment_id
      and r.active = true and r.deleted_at is null
  ) then
    raise exception 'session rodeo does not belong to establishment or is inactive'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke execute on function public.tg_sessions_rodeo_check () from public, authenticated, anon;

create trigger sessions_rodeo_check
  before insert or update on public.sessions
  for each row execute function public.tg_sessions_rodeo_check();

alter table public.sessions enable row level security;

create policy sessions_select on public.sessions
  for select using (has_role_in(establishment_id) and deleted_at is null);
create policy sessions_insert on public.sessions
  for insert with check (has_role_in(establishment_id));
create policy sessions_update on public.sessions
  for update using (has_role_in(establishment_id))
  with check (has_role_in(establishment_id));
-- sin DELETE de cliente: cerrar = status='closed'; borrar = soft-delete (deleted_at) via update.

grant select, insert, update on public.sessions to authenticated;
grant all on public.sessions to service_role;

notify pgrst, 'reload schema';
