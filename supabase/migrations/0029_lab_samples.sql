-- 0029_lab_samples.sql  (spec 02 lógico: 0028)
-- Muestras de laboratorio. Cubre R6.5, R6.6, R6.7, R6.8 (parte).

create type public.lab_sample_type as enum ('blood','scrape_tricho','scrape_campylo','other');

create table public.lab_samples (
  id                     uuid primary key default gen_random_uuid(),
  animal_profile_id      uuid not null references public.animal_profiles(id) on delete cascade,
  session_id             uuid,
  sample_type            public.lab_sample_type not null,
  tube_number            text not null,
  collection_date        date not null,
  lab_destination        text,
  result                 text,
  result_interpretation  text,
  result_received_date   date,
  notes                  text,
  created_by             uuid references public.users(id),
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- Búsqueda por tubo para vinculación automática (feature 06 lab imports).
create index lab_samples_tube on public.lab_samples (tube_number) where deleted_at is null;
create index lab_samples_by_profile_date
  on public.lab_samples (animal_profile_id, collection_date desc)
  where deleted_at is null;

create trigger lab_samples_set_created_by
  before insert on public.lab_samples
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.lab_samples enable row level security;
create policy lab_samples_select on public.lab_samples
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy lab_samples_insert on public.lab_samples
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy lab_samples_update on public.lab_samples
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.lab_samples to authenticated;
grant all on public.lab_samples to service_role;

notify pgrst, 'reload schema';
