-- 0005_rls_helpers.sql
-- Helpers security-definer usados desde las policies de RLS.
-- Evitan recursión: las policies de user_roles no pueden referenciar user_roles
-- vía select normal (sería evaluado bajo la misma policy). Estas funciones
-- corren con privilegios del owner del schema y devuelven boolean.
-- Cubre: utilidades para R7.2, R7.3, R4.4.

-- has_role_in: ¿el usuario actual tiene rol activo en este establishment?
create or replace function public.has_role_in (est_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.establishments e on e.id = ur.establishment_id
    where ur.user_id = auth.uid()
      and ur.establishment_id = est_id
      and ur.active = true
      and e.deleted_at is null
  );
$$;

comment on function public.has_role_in is
  'true si auth.uid() tiene un user_roles activo en el establishment dado y el establishment no está soft-deleted.';

-- is_owner_of: ¿el usuario actual es owner activo de este establishment?
create or replace function public.is_owner_of (est_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.establishments e on e.id = ur.establishment_id
    where ur.user_id = auth.uid()
      and ur.establishment_id = est_id
      and ur.role = 'owner'
      and ur.active = true
      and e.deleted_at is null
  );
$$;

comment on function public.is_owner_of is
  'true si auth.uid() es owner activo del establishment y el establishment no está soft-deleted.';

-- Permisos: las funciones son security definer, los grants controlan quién las puede invocar.
grant execute on function public.has_role_in (uuid) to authenticated;
grant execute on function public.is_owner_of (uuid) to authenticated;

-- Revocamos execute al rol public (defensa, debería estar por default)
revoke execute on function public.has_role_in (uuid) from public;
revoke execute on function public.is_owner_of (uuid) from public;
