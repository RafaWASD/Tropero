-- 0125_health_status.sql — función de health server-side (spec 16 Run B, B6 / R7.2/R7.7/R6.4).
--
-- Reconciliación de numeración (as-built): la spec (design §5 / task B6) decía `0124_health_status.sql`,
-- pero 0124 lo tomó `0124_audit_log.sql` (spec 18, DONE, committeada antes de Run A). El siguiente número
-- libre es 0125. El contenido SQL es el del design §5; solo cambia el número. Ver progress/impl_16-runB.md.
--
-- Único objeto de schema numerado del feature. La invoca SOLO la Edge Function `health` con service_role
-- (createAdminClient → rpc('health_status')). NO expone datos de negocio ni PII: devuelve
-- {ok, schema_version} con schema_version = PREFIJO NUMÉRICO de 4 dígitos de la última migración del
-- ledger (L1: no filtra el filename completo → no revela nombres de features/roadmap en un endpoint público).
--
-- El ledger `ops.applied_migrations` NO lo crea esta migración: es tool-owned (lo bootstrapea
-- scripts/apply-all-migrations.mjs). Si aún no existe, la función es DEFENSIVA → 'unknown' sin romper ok:true.
--
-- ⚠️ NO aplicar desde acá: DEPLOY GATEADO (Raf/leader). A DEV vía apply-migration-mgmt.mjs --env dev (Run C);
--    a PROD dentro del replay ordenado (Run F).

begin;

create or replace function public.health_status()
returns json language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  begin
    -- L1: SOLO el prefijo numérico de 4 dígitos (^\d{4}), NO el filename completo. Alinea con el test
    -- de la Edge suite (^\d{4}$|^unknown$).
    select substring(max(filename) from '^\d{4}') into v from ops.applied_migrations;
  exception when undefined_table or invalid_schema_name then v := null;
  end;
  return json_build_object('ok', true, 'schema_version', coalesce(v, 'unknown'));
end $$;

-- M1: revocar EXECUTE FROM PUBLIC (toda función nace con EXECUTE a PUBLIC; revocar solo anon/authenticated
-- NO alcanza — heredan el grant de PUBLIC). FROM anon, authenticated queda como defensa en profundidad.
revoke all on function public.health_status() from public;
revoke all on function public.health_status() from anon, authenticated;
-- Tras revocar PUBLIC, el único caller (la Edge Function `health`, con service_role) necesita EXECUTE
-- explícito o el health rompe. Solo service_role; anon/authenticated NO.
grant execute on function public.health_status() to service_role;

commit;
