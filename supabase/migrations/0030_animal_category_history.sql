-- 0030_animal_category_history.sql  (spec 02 lógico: 0029)
-- Historial de cambios de categoría (auditoría + origen 'category_change' del timeline).
-- Cubre R10.3, R12.4.

create type public.category_change_reason as enum (
  'initial','auto_transition','manual_override','revert_to_auto'
);

create table public.animal_category_history (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  from_category_id   uuid references public.categories_by_system(id),
  to_category_id     uuid not null references public.categories_by_system(id),
  changed_at         timestamptz not null default now(),
  changed_by         uuid references public.users(id),
  reason             public.category_change_reason not null
);

create index animal_category_history_by_profile
  on public.animal_category_history (animal_profile_id, changed_at desc);

-- Cada cambio en animal_profiles.category_id graba historial.
create or replace function public.tg_animal_profiles_record_category_change ()
returns trigger language plpgsql
security definer set search_path = public as $$
declare v_reason public.category_change_reason;
begin
  if tg_op = 'INSERT' then
    v_reason := 'initial';
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, null, new.category_id, auth.uid(), v_reason);
  elsif tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') = 'on' then
      v_reason := 'auto_transition';
    elsif old.category_override = true and new.category_override = false then
      v_reason := 'revert_to_auto';
    else
      v_reason := 'manual_override';
    end if;
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, old.category_id, new.category_id, auth.uid(), v_reason);
  end if;
  return new;
end; $$;

create trigger animal_profiles_record_category_change_ins
  after insert on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_category_change();

create trigger animal_profiles_record_category_change_upd
  after update of category_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_category_change();

alter table public.animal_category_history enable row level security;
create policy animal_category_history_select on public.animal_category_history
  for select using (has_role_in(establishment_of_profile(animal_profile_id)));
-- Insert solo vía trigger (security definer). No grant insert al cliente.
grant select on public.animal_category_history to authenticated;
grant all on public.animal_category_history to service_role;

notify pgrst, 'reload schema';
