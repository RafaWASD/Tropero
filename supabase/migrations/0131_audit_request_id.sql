-- 0131_audit_request_id.sql — Correlación request_id end-to-end (spec 23). ADITIVA sobre 0124 (spec 18).
--
-- ⚠️ NO aplicar desde acá: DEPLOY GATEADO (Raf/leader) tras Puerta 1 + Gate 1. Re-CREA
--    insert_update_delete_trigger → re-correr TODAS las suites que tocan audit (spec 18 / user_roles).
--
-- QUÉ AGREGA (todo aditivo — no rompe ningún write existente):
--   1. Columna audit.record_version.request_id uuid NULLABLE + índice parcial (where request_id is not null).
--   2. Función audit.resolve_request_id() ANÁLOGA a resolve_actor(): lee request.headers->>'x-rafaq-request-id'
--      del GUC SOLO bajo service_role, valida uuid, TOTAL (nunca lanza) → NULL ante cualquier fallo.
--   3. Re-CREATE de audit.insert_update_delete_trigger() sumando request_id al INSERT en AMBOS modos.
--
-- BASE del re-CREATE = 0124 (VERIFICADO 2026-08-14 por grep: 0125-0130 no redefinen esas funciones).
-- ANTI-SPOOF: resolve_request_id confía el header SOLO bajo service_role (request.jwt.claims->>'role'). Un
--   write con JWT de usuario NO puede inyectar request_id. Consistente con el modelo de actor (0124).

begin;

-- ── 1. Columna aditiva + índice parcial (D4 / R3.1, R3.2) ─────────────────────────────────────────────
-- NULL honesto: la mayoría de los writes (JWT de usuario / PowerSync / EF sin requestId) no lo traen.
alter table audit.record_version add column if not exists request_id uuid;

create index if not exists record_version_request_id
  on audit.record_version (request_id) where request_id is not null;

-- ── 2. resolve_request_id() — ANÁLOGA a resolve_actor (H1). TOTAL: NUNCA lanza (D6 / R3.3–R3.6) ────────
-- El header SOLO se confía si el rol de sesión es service_role (GUC request.jwt.claims, no current_user →
-- correcto bajo SECURITY DEFINER; anti-spoof). Sin fallback a auth.uid(): un request_id no tiene equivalente
-- de "usuario logueado" → si no hay header confiable, NULL honesto.
create or replace function audit.resolve_request_id ()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  v_role text;
  v_hdr  text;
  v_rid  uuid;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    if v_role = 'service_role' then
      -- PostgREST expone request.headers con las claves en minúscula.
      v_hdr := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-rafaq-request-id';
      if v_hdr ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_rid := v_hdr::uuid;
      end if;
    end if;
    return v_rid;   -- header ausente / basura / write con JWT de usuario → NULL honesto
  exception when others then
    return null;    -- cualquier fallo de parse (claim/header no-JSON, cast) → NULL, jamás bloquea el write
  end;
end; $$;

-- ── 3. Re-CREATE del trigger de audit sumando request_id en AMBOS modos (R3.7–R3.9) ───────────────────
-- MOLDEADO sobre el cuerpo de 0124. ÚNICO cambio: se agrega la columna request_id (posición fija tras
-- auth_uid) y su valor audit.resolve_request_id() al INSERT, en best_effort y en strict. Todo lo demás
-- (record_id estable, actor, guard airtight del best-effort, return coalesce) queda idéntico.
create or replace function audit.insert_update_delete_trigger ()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_best_effort boolean := (tg_nargs > 0 and tg_argv[0] = 'best_effort');
begin
  if v_best_effort then
    -- CAMINO CALIENTE (R1.11 de 0124): la manga NUNCA se traba por el audit. TODO dentro del guard.
    begin
      insert into audit.record_version (
        record_id, old_record_id, op, auth_uid, request_id,
        table_oid, table_schema, table_name, record, old_record)
      values (
        audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end),
        audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end),
        tg_op::audit.operation, audit.resolve_actor(), audit.resolve_request_id(),
        tg_relid, tg_table_schema, tg_table_name,
        case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
        case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end);
    exception when others then
      null;   -- best-effort: se acepta perder esta fila de audit antes que bloquear la carga.
    end;
  else
    -- ESTRICTO (user_roles): errores propagan → sin huecos en el log de membresías.
    insert into audit.record_version (
      record_id, old_record_id, op, auth_uid, request_id,
      table_oid, table_schema, table_name, record, old_record)
    values (
      audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
        case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end),
      audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
        case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end),
      tg_op::audit.operation, audit.resolve_actor(), audit.resolve_request_id(),
      tg_relid, tg_table_schema, tg_table_name,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end);
  end if;
  return coalesce(new, old);
end; $$;

-- NO se re-crea el trigger en public.user_roles: apunta a la función por nombre (CREATE OR REPLACE conserva
-- el oid) → toma el cuerpo nuevo automáticamente. enable_tracking NO se vuelve a llamar (user_roles ya está).

-- ── Fail-closed: revoke EXECUTE de la función nueva (R3.12) ────────────────────────────────────────────
revoke execute on function audit.resolve_request_id() from public, anon, authenticated;

-- ── Smoke-check DOBLE (patrón 0124 / R3.12, R3.13): (a) resolve_request_id no EXECUTE-able por cliente,
--    (b) muro de LECTURA sigue cerrado. Aborta la migración si algo quedó abierto. ────────────────────
do $$
begin
  if has_function_privilege('anon',          'audit.resolve_request_id()', 'EXECUTE')
     or has_function_privilege('authenticated','audit.resolve_request_id()', 'EXECUTE')
     or has_function_privilege('public',       'audit.resolve_request_id()', 'EXECUTE') then
    raise exception 'grant check FAILED (R3.12): audit.resolve_request_id es EXECUTE-able por un rol cliente';
  end if;
  if has_schema_privilege('anon','audit','USAGE')
     or has_schema_privilege('authenticated','audit','USAGE')
     or has_table_privilege('anon','audit.record_version','SELECT')
     or has_table_privilege('authenticated','audit.record_version','SELECT') then
    raise exception 'audit read-wall FAILED (R3.13): anon/authenticated tienen USAGE/SELECT sobre audit';
  end if;
  -- Sanity aditivo: la columna existe y es NULLABLE (no rompe writes existentes).
  if not exists (
    select 1 from information_schema.columns
    where table_schema='audit' and table_name='record_version'
      and column_name='request_id' and is_nullable='YES') then
    raise exception 'request_id no quedó como columna NULLABLE de audit.record_version (R3.1/R3.11)';
  end if;
  raise notice 'audit request_id OK (R3.x): columna NULLABLE + resolve_request_id cerrado a cliente';
end$$;

commit;
