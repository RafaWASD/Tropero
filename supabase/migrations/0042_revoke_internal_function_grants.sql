-- 0042_revoke_internal_function_grants.sql  (fix de seguridad de spec 02 — SEC-HIGH-01)
--
-- PROBLEMA (Gate 2, security_code_02-modelo-animal.md § SEC-HIGH-01):
-- `public.apply_auto_transition(profile_id uuid, target_category_id uuid)` (0031)
-- es SECURITY DEFINER y NO valida autorización adentro (hace
-- `update animal_profiles set category_id = ... where id = profile_id` directo).
-- Es un helper INTERNO del trigger `tg_reproductive_events_apply_transition` (R7.7),
-- pero quedó expuesto como RPC de PostgREST con `EXECUTE TO PUBLIC` por default
-- (nunca se le hizo revoke). Un usuario `authenticated` del tenant A que conozca un
-- `profile_id` del tenant B puede cambiarle la categoría cross-tenant vía
-- `POST /rest/v1/rpc/apply_auto_transition` (CWE-862 / CWE-639). Viola
-- "multi-tenant desde día 1" y R11.x.
--
-- FIX: cerrar la superficie RPC revocando EXECUTE a public/authenticated/anon.
-- El trigger `tg_reproductive_events_apply_transition` es SECURITY DEFINER y corre
-- como owner del schema, así que CONSERVA su EXECUTE y sigue pudiendo invocar
-- `apply_auto_transition`. Es decir: las transiciones automáticas de categoría
-- (R7.1..R7.3) siguen funcionando (validado por T2.4 y T2.5). El cliente nunca
-- invocó esta función directamente, así que el revoke no rompe ningún flujo.
-- Mismo patrón de "revoke defensivo" que `0005_rls_helpers.sql` (has_role_in/is_owner_of).

revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;

-- Forzar reload del schema cache de PostgREST.
notify pgrst, 'reload schema';
