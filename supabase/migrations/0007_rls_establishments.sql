-- 0007_rls_establishments.sql
-- RLS policies para public.establishments.
-- Cubre: R3.1, R3.4, R3.5, R3.6, R7.2, R7.3, R8.3, R8.4.

-- SELECT: cualquier user con rol activo (helper has_role_in que ya excluye soft-deleted).
create policy establishments_select on public.establishments
  for select
  to authenticated
  using (public.has_role_in(id));

-- INSERT: cualquier usuario autenticado puede crear un establecimiento.
-- La validación de email-verified vive en el cliente / Edge Function de creación.
-- RLS solo exige auth.uid() not null.
create policy establishments_insert on public.establishments
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- UPDATE: solo owners. Cubre R3.4 (editar) y R3.6 (soft-delete via update de deleted_at).
create policy establishments_update on public.establishments
  for update
  to authenticated
  using (public.is_owner_of(id))
  with check (public.is_owner_of(id));
