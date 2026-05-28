-- 0022_rls_animals_and_profiles.sql  (spec 02 lógico: 0021)
-- Policies de animal_profiles (RLS por establishment) y animals (derivado).
-- Cubre R3.5, R11.1, R11.2, R11.3, R11.5.

-- animal_profiles: RLS estándar por establishment.
create policy animal_profiles_select on public.animal_profiles
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy animal_profiles_insert on public.animal_profiles
  for insert with check (has_role_in(establishment_id));
  -- field_operator y veterinarian pueden insertar (R11.5).

create policy animal_profiles_update on public.animal_profiles
  for update using (has_role_in(establishment_id))
  with check (has_role_in(establishment_id));
-- El UPDATE de management_group_id (asignar lote) queda cubierto acá (cualquier
-- rol operativo, R11.5). El bulk-edit owner-only de R11.4 se valida desde Edge
-- Function dedicada (diferida); los updates puntuales los hace cualquier rol activo.

-- animals: visible si el usuario tiene rol en un establishment con perfil del animal.
create policy animals_select on public.animals
  for select using (
    deleted_at is null
    and exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id
        and has_role_in(ap.establishment_id)
    )
  );

create policy animals_insert on public.animals
  for insert with check (auth.uid() is not null);

create policy animals_update on public.animals
  for update using (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  ) with check (true);

notify pgrst, 'reload schema';
