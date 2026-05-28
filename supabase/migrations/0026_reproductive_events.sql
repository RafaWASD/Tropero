-- 0026_reproductive_events.sql  (spec 02 lógico: 0025)
-- Eventos reproductivos + tabla auxiliar semen_registry.
-- Cubre R6.2, R6.6, R6.7, R6.8 (parte).

create type public.repro_event_type as enum (
  'service','tacto','birth','abortion','weaning','drying','rejection'
);
create type public.service_type_enum as enum ('natural','ai','te');
create type public.pregnancy_status_enum as enum ('empty','small','medium','large');

-- Tabla auxiliar para semen (mínima, sin stock — fully fleshed en feature 03).
create table public.semen_registry (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  pajuela_name      text not null,
  bull_name         text,
  breed             text,
  supplier          text,
  notes             text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (establishment_id, pajuela_name)
);

alter table public.semen_registry enable row level security;
create policy semen_select on public.semen_registry for select using (has_role_in(establishment_id) and deleted_at is null);
create policy semen_insert on public.semen_registry for insert with check (has_role_in(establishment_id));
create policy semen_update on public.semen_registry for update using (is_owner_of(establishment_id));
grant select, insert, update on public.semen_registry to authenticated;
grant all on public.semen_registry to service_role;

create table public.reproductive_events (
  id                  uuid primary key default gen_random_uuid(),
  animal_profile_id   uuid not null references public.animal_profiles(id) on delete cascade,
  session_id          uuid,
  event_type          public.repro_event_type not null,
  event_date          date not null,
  service_type        public.service_type_enum,
  bull_id             uuid references public.animal_profiles(id),
  semen_id            uuid references public.semen_registry(id),
  pregnancy_status    public.pregnancy_status_enum,
  estimated_days      int,
  estimated_birth     date,
  calf_id             uuid references public.animal_profiles(id),
  calf_weight         numeric(7,2),
  calf_sex            text check (calf_sex in ('male','female')),
  calf_tag_electronic text,    -- opcional al cargar el parto (R9.3)
  notes               text,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index reproductive_events_by_profile_date
  on public.reproductive_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger reproductive_events_set_created_by
  before insert on public.reproductive_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.reproductive_events enable row level security;
create policy reproductive_events_select on public.reproductive_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy reproductive_events_insert on public.reproductive_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy reproductive_events_update on public.reproductive_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.reproductive_events to authenticated;
grant all on public.reproductive_events to service_role;

notify pgrst, 'reload schema';
