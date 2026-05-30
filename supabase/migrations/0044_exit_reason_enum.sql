-- 0044_exit_reason_enum.sql  (fold Tier 1 spec 02, sesión 20)
-- Item 2 del Tier 1: exit_reason text→enum + RPC exit_animal_profile (baja/egreso).
-- Cubre R4.14 (baja vía RPC, authz owner|created_by con rol activo) / R4.15 (preserva vínculos).
-- Depende de 0043 (created_by): el RPC lo lee para autorizar al operario que cargó el animal.

create type public.exit_reason_enum as enum (
  'sale','death','transfer','culling','theft','other'   -- venta/muerte/transferencia/descarte/robo/otro
);

-- Backfill seguro: la columna texto está vacía en MVP, pero se normaliza por defensa
-- antes del ALTER (cualquier string no mapeable se rebaja a 'other' para no abortar la migration).
update public.animal_profiles
   set exit_reason = case
         when exit_reason in ('sale','death','transfer','culling','theft','other') then exit_reason
         when exit_reason is null or trim(exit_reason) = '' then null
         else 'other'
       end
 where exit_reason is not null;

alter table public.animal_profiles
  alter column exit_reason type public.exit_reason_enum
  using nullif(trim(exit_reason), '')::public.exit_reason_enum;

-- RPC de baja (SECURITY DEFINER, patrón as-built 0041). No es soft-delete: deleted_at
-- queda NULL; el perfil sale del rodeo activo por el filtro status='active' de las queries
-- operativas pero sigue visible en historial (R4.12/R4.15).
create or replace function public.exit_animal_profile (
  p_profile_id  uuid,
  p_status      public.animal_status,        -- 'sold' | 'dead' | 'transferred'
  p_exit_reason public.exit_reason_enum,
  p_exit_date   date,
  p_exit_weight numeric default null,
  p_exit_price  numeric default null
) returns void language plpgsql security definer
set search_path = public as $$
declare v_est uuid; v_creator uuid;
begin
  select establishment_id, created_by into v_est, v_creator
  from public.animal_profiles where id = p_profile_id and deleted_at is null;
  if v_est is null then
    raise exception 'animal_profile not found' using errcode = '23503';
  end if;
  -- R4.14: owner del campo O el operario que cargó el animal — pero SIEMPRE con rol activo.
  -- (SEC-SPEC-01, Gate 1 s20) has_role_in(v_est) es OBLIGATORIO: filtra al autor cuyo rol
  -- fue desactivado/revocado (user_roles.active = false). Sin él, un ex-operario que sigue
  -- matcheando v_creator = auth.uid() podría dar de baja un animal de un campo del que ya no
  -- forma parte. Mismo patrón que soft_delete_animal_event (0041) y misma clase que SEC-HIGH-01.
  if not (public.has_role_in(v_est)
          and (public.is_owner_of(v_est) or v_creator = auth.uid())) then
    raise exception 'not authorized to exit this animal' using errcode = '42501';
  end if;
  if p_status = 'active' then
    raise exception 'exit status must be sold/dead/transferred' using errcode = '23514';
  end if;
  update public.animal_profiles
     set status = p_status, exit_reason = p_exit_reason, exit_date = p_exit_date,
         exit_weight = coalesce(p_exit_weight, exit_weight),
         exit_price  = coalesce(p_exit_price, exit_price)
   where id = p_profile_id;
  -- deleted_at queda NULL: NO es soft-delete. El perfil queda archivado y visible (R4.12/R4.15).
end; $$;

-- SEG (SEC-SPEC-01, Gate 1 s20): revoke/grant con la FIRMA TIPADA COMPLETA + notify pgrst,
-- igual que 0041/0042. exit_animal_profile SÍ debe ser invocable por authenticated (R4.14:
-- el owner y el autor dan de baja desde la ficha) — por eso se concede a authenticated, a
-- diferencia de apply_auto_transition (0042) que se revocó a los tres.
revoke execute on function public.exit_animal_profile (uuid, public.animal_status, public.exit_reason_enum, date, numeric, numeric) from public, anon;
grant  execute on function public.exit_animal_profile (uuid, public.animal_status, public.exit_reason_enum, date, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
