-- 0008_rls_membership.sql
-- RLS policies para public.user_roles y public.invitations.
-- Cubre: R4.1, R4.5, R4.7, R5.1, R5.7, R7.2, R7.3.

-- =========================
-- public.user_roles
-- =========================

-- SELECT: el propio user ve sus roles; owners de un establishment ven todos los
-- roles activos de ese establishment (para pantalla Members).
create policy user_roles_select on public.user_roles
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_owner_of(establishment_id)
  );

-- INSERT: la creación normal va por Edge Functions con service_role (T2.*).
-- Excepción permitida: el primer user_roles cuando un user crea su propio
-- establishment desde el cliente (T4.4) — auth.uid() coincide y rol='owner'.
-- Esto evita necesitar una Edge Function solo para la creación inicial.
create policy user_roles_insert_self_owner on public.user_roles
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and active = true
  );

-- UPDATE: solo owners del establishment pueden mutar (cambiar rol = desactivar+insert
-- en transacción vía Edge Function; remove = desactivar).
create policy user_roles_update_owner on public.user_roles
  for update
  to authenticated
  using (public.is_owner_of(establishment_id))
  with check (public.is_owner_of(establishment_id));

-- =========================
-- public.invitations
-- =========================

-- SELECT: owners del establishment, o el invitado (match por email del JWT).
-- auth.jwt() ->> 'email' es el email confirmado del user actual.
create policy invitations_select on public.invitations
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      public.is_owner_of(establishment_id)
      or email = lower(auth.jwt() ->> 'email')
    )
  );

-- INSERT: solo owners del establishment, y el invited_by debe ser auth.uid().
create policy invitations_insert_owner on public.invitations
  for insert
  to authenticated
  with check (
    public.is_owner_of(establishment_id)
    and invited_by = auth.uid()
  );

-- UPDATE: solo owners (cancelar / reenviar). La aceptación va por Edge Function
-- con service_role (transacción atómica con user_roles).
create policy invitations_update_owner on public.invitations
  for update
  to authenticated
  using (public.is_owner_of(establishment_id))
  with check (public.is_owner_of(establishment_id));
