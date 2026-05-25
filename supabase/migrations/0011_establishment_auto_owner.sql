-- 0011_establishment_auto_owner.sql
-- Cuando un usuario autenticado inserta una fila en `public.establishments`,
-- creamos automáticamente su `user_roles` con role='owner' y active=true.
-- Cubre: R3.2.
--
-- Beneficio operativo: el cliente puede hacer `insert(...).select()` en una
-- sola roundtrip sin que la policy de select rechace la fila por has_role_in
-- todavía false (el trigger AFTER INSERT corre en la misma transacción antes
-- del RETURNING).

create or replace function public.handle_new_establishment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Idempotente: si ya hay un rol activo (raro, pero por las dudas), no falla.
  if not exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and establishment_id = new.id and active = true
  ) then
    insert into public.user_roles (user_id, establishment_id, role, active)
    values (auth.uid(), new.id, 'owner', true);
  end if;

  return new;
end;
$$;

comment on function public.handle_new_establishment is
  'AFTER INSERT en establishments crea user_roles owner para auth.uid(). Cubre R3.2.';

create trigger on_establishment_created
  after insert on public.establishments
  for each row execute function public.handle_new_establishment();

-- Permitir que el rol authenticated invoque la función (security definer escala).
grant execute on function public.handle_new_establishment () to authenticated;
