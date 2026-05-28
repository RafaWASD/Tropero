-- 0027_sanitary_events.sql  (spec 02 lógico: 0026)
-- Eventos sanitarios. Cubre R6.3, R6.6, R6.7, R6.8 (parte).

create type public.sanitary_event_type as enum ('vaccination','deworming','treatment','test','other');
create type public.sanitary_route as enum ('intramuscular','subcutaneous','oral','topical','other');

create table public.sanitary_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  campaign_id        uuid,  -- TODO: FK a sanitary_campaigns cuando exista (feature posterior).
  event_type         public.sanitary_event_type not null,
  product_name       text not null,
  active_ingredient  text,
  dose_ml            numeric(7,2),
  route              public.sanitary_route,
  event_date         date not null,
  next_dose_date     date,
  result             text,
  adverse_reaction   boolean not null default false,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index sanitary_events_by_profile_date
  on public.sanitary_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger sanitary_events_set_created_by
  before insert on public.sanitary_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.sanitary_events enable row level security;
create policy sanitary_events_select on public.sanitary_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy sanitary_events_insert on public.sanitary_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy sanitary_events_update on public.sanitary_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.sanitary_events to authenticated;
grant all on public.sanitary_events to service_role;

notify pgrst, 'reload schema';
