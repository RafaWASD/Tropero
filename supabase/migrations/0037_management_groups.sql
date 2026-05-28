-- 0037_management_groups.sql  (spec 02 lógico: 0036)
-- Lote: tercer eje de organización (ADR-020). Scope establishment (cruza rodeos).
-- Se materializa al final porque animal_profiles ya existe (0020) y se le agrega
-- la columna management_group_id vía ALTER.
-- Cubre R2.14, R2.15, R2.16 (sustrato), R2.17, R2.18, R4.1 (columna), R7.7 (la columna no la tocan las transiciones).

create table public.management_groups (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint management_groups_name_not_empty check (length(trim(name)) > 0)
);

comment on table public.management_groups is
  'Lote (ADR-020). Scope establishment (cruza rodeos). La UI lo muestra como "Lote".';

create index management_groups_by_est
  on public.management_groups (establishment_id) where deleted_at is null;

create trigger management_groups_set_updated_at
  before update on public.management_groups
  for each row execute function public.tg_set_updated_at_generic();

-- Columna en animal_profiles (eje lote). Nullable: NULL = "sin grupo de manejo custom".
alter table public.animal_profiles
  add column management_group_id uuid references public.management_groups(id);

create index animal_profiles_by_management_group
  on public.animal_profiles (management_group_id) where deleted_at is null;

-- R2.15: el lote debe ser del mismo establishment que el perfil (asignación exclusiva = FK simple).
create or replace function public.tg_animal_profiles_management_group_check ()
returns trigger language plpgsql as $$
declare v_est uuid;
begin
  if new.management_group_id is null then return new; end if;
  select establishment_id into v_est
  from public.management_groups
  where id = new.management_group_id and deleted_at is null;
  if v_est is null then
    raise exception 'management_group % not found or deleted', new.management_group_id using errcode = '23503';
  end if;
  if v_est <> new.establishment_id then
    raise exception 'management_group belongs to a different establishment' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_management_group_check
  before insert or update of management_group_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_management_group_check();

-- RLS: SELECT a todo rol activo; INSERT/UPDATE/soft-DELETE solo owner.
alter table public.management_groups enable row level security;

create policy management_groups_select on public.management_groups
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy management_groups_insert on public.management_groups
  for insert with check (is_owner_of(establishment_id));

create policy management_groups_update on public.management_groups
  for update using (is_owner_of(establishment_id))
  with check (is_owner_of(establishment_id));

grant select, insert, update on public.management_groups to authenticated;
grant all on public.management_groups to service_role;
-- La ASIGNACIÓN de un animal a un lote = UPDATE de animal_profiles.management_group_id,
-- cubierto por animal_profiles_update (has_role_in) — cualquier rol operativo (R2.17, R11.5).

notify pgrst, 'reload schema';
