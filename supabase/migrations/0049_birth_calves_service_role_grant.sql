-- 0049_birth_calves_service_role_grant.sql  (fix del fold Tier 1, sesión 20)
--
-- PROBLEMA: el bloque de design de 0045 solo emitió `grant select ... to authenticated`
-- para birth_calves, pero la convención dura RAFAQ (Auto-expose / default privileges OFF)
-- exige GRANT explícito a service_role en cada tabla nueva — como hacen todas las tablas
-- de spec 02 (`grant all on public.<tabla> to service_role`, ver 0019/0025/etc). Sin él,
-- el cliente service_role (fixtures + lecturas de verificación de la suite) recibe
-- "42501 permission denied for table birth_calves".
--
-- FIX: grant explícito a service_role. birth_calves es de origen server (se puebla por
-- trigger/RPC SECURITY DEFINER, que corren como owner del schema), así que para
-- service_role alcanza SELECT (verificación de estado en tests + lecturas administrativas);
-- el cleanup de datos se hace por CASCADE desde reproductive_events / establishments.
-- La superficie del CLIENTE (authenticated) NO cambia: sigue select-only, sin INSERT
-- (SEC-SPEC-04 intacto).

grant select on public.birth_calves to service_role;

notify pgrst, 'reload schema';
