-- 0006_rls_users.sql
-- RLS policies para public.users.
-- Cubre: R7.2 (aislamiento), R2.1 (editar propio perfil), R8.3 (soft-delete invisible).

-- SELECT propio: el user ve su propio perfil completo (no soft-deleted).
create policy users_select_self on public.users
  for select
  to authenticated
  using (id = auth.uid() and deleted_at is null);

-- SELECT compañeros: un user puede ver perfiles mínimos de otros users con los que
-- comparte al menos un establishment activo. Esto habilita pantallas como "Miembros".
-- La definición de "perfil mínimo" se hace vía view en una migration futura (T5.1);
-- en SQL la policy igualmente cubre la fila completa porque RLS no filtra columnas.
-- Por ahora, los clientes deben hacer `select id, name from users where ...`.
create policy users_select_coworkers on public.users
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.user_roles me
      join public.user_roles them
        on them.establishment_id = me.establishment_id
      where me.user_id = auth.uid()
        and me.active = true
        and them.user_id = public.users.id
        and them.active = true
    )
  );

-- UPDATE propio: el user solo puede modificar su propia fila.
create policy users_update_self on public.users
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
