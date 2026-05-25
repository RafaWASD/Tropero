-- 0010_grants_fix.sql
-- Re-aplica grants explícitos a todas las tablas del spec 01.
-- Necesario porque con la config del proyecto "Automatically expose new tables: OFF"
-- los grants de tablas viejas no se replican automáticamente al rol authenticated/anon
-- vía PostgREST schema reload. Este re-grant fuerza el refresh de privilegios.
--
-- Idempotente: GRANT no falla si ya existe.

-- public.users: solo select/update via cliente (insert por trigger, no delete).
grant usage on schema public to anon, authenticated, service_role;

grant select, update on public.users to authenticated;
grant select, insert, update on public.establishments to authenticated;
grant select, insert, update on public.user_roles to authenticated;
grant select, insert, update on public.invitations to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- service_role: bypassea RLS pero igual necesita grants table-level.
grant all on public.users to service_role;
grant all on public.establishments to service_role;
grant all on public.user_roles to service_role;
grant all on public.invitations to service_role;
grant all on public.push_tokens to service_role;

-- Otorgar uso de los enums.
grant usage on type public.user_role to anon, authenticated, service_role;
grant usage on type public.invitation_status to anon, authenticated, service_role;

-- Forzar reload del schema cache de PostgREST.
notify pgrst, 'reload schema';
