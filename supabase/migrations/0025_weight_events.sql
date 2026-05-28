-- 0025_weight_events.sql  (spec 02 lógico: 0024)
-- Evento de pesaje. Cubre R6.1, R6.6, R6.7, R6.8 (parte).

create type public.event_source as enum ('bluetooth', 'manual', 'import_xml');

create table public.weight_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,                 -- FK opcional, sessions viene en spec 03
  weight_kg          numeric(7,2) not null check (weight_kg > 0),
  weight_date        date not null,
  time               time,
  source             public.event_source not null default 'manual',
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index weight_events_by_profile_date
  on public.weight_events (animal_profile_id, weight_date desc)
  where deleted_at is null;

create trigger weight_events_set_created_by
  before insert on public.weight_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.weight_events enable row level security;

create policy weight_events_select on public.weight_events
  for select using (
    has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null
  );

create policy weight_events_insert on public.weight_events
  for insert with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );

create policy weight_events_update on public.weight_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  ) with check (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );

grant select, insert, update on public.weight_events to authenticated;
grant all on public.weight_events to service_role;

notify pgrst, 'reload schema';
