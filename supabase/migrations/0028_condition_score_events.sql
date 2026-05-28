-- 0028_condition_score_events.sql  (spec 02 lógico: 0027)
-- Condición corporal (score discreto). Cubre R6.4, R6.6, R6.7, R6.8 (parte).

create table public.condition_score_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  score              numeric(3,2) not null
    check (score in (1.00,1.25,1.50,1.75,2.00,2.25,2.50,2.75,
                     3.00,3.25,3.50,3.75,4.00,4.25,4.50,4.75,5.00)),
  event_date         date not null,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index condition_score_by_profile_date
  on public.condition_score_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger condition_score_set_created_by
  before insert on public.condition_score_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.condition_score_events enable row level security;
create policy condition_score_select on public.condition_score_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy condition_score_insert on public.condition_score_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy condition_score_update on public.condition_score_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.condition_score_events to authenticated;
grant all on public.condition_score_events to service_role;

notify pgrst, 'reload schema';
