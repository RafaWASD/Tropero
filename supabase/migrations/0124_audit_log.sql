-- 0124_audit_log.sql — Audit forense server-side (spec 18). Cubre R1..R8.
--
-- ⚠️ NO aplicar desde acá: DEPLOY GATEADO (Raf/leader) tras Puerta 1 + ratificación de la reconciliación
--    R4.x (ver abajo). append-only + fail-closed a todo cliente + retención 90d.
--
-- ── FRONTERA WAL / PowerSync (D5, R4.x — RECONCILIADO CONTRA LA INFRA REAL) ───────────────────────────
--   La spec asumió que la publication de PowerSync era `FOR TABLE <lista>` (puballtables=false). VERIFICADO
--   en dev (2026-07-13, read-only `pg_publication`): la publication `powersync` es **FOR ALL TABLES**
--   (puballtables=true). En este proyecto el FRONTIER de sincronización NO es la publication sino las
--   **sync streams** (`sync-streams/rafaq.yaml`): el WAL replica TODA la base al servicio de PowerSync, y
--   cada stream scopea explícitamente qué llega a cada device (ADR-025/026; header de rafaq.yaml). Una tabla
--   que NO aparece en ninguna stream (y no hay stream catch-all) nunca llega a un device — mismo mecanismo
--   que mantiene fuera a `animals`/`users`/`import_log` hoy. Por eso `audit.record_version` NO se agrega a
--   `rafaq.yaml` (R4.2 intent). No se puede excluir del FOR ALL TABLES → residual = costo de WAL menor
--   (INSERT-only, retención 90d). El objetivo de D5 (audit no fuga a devices) SE CUMPLE por el frontier de
--   streams. Ver progress/impl_18-audit-log.md § "T1 / R4.1 discrepancia" (requiere ratificación de Raf).
--
-- ── SEMÁNTICA TEMPORAL + ACTOR (D2 + H1 — leer antes de usar el log) ──────────────────────────────────
--   * auth_uid = el ACTOR REAL:
--       - write con JWT de usuario (RPC/PowerSync) → auth.uid().
--       - write por Edge Function (service_role) → actor propagado por el header X-Rafaq-Actor, usado
--         SOLO si el rol de sesión es service_role (un usuario NO puede spoofear el header). El actor es el
--         user.id del JWT validado del llamante de la EF (requireUser), NUNCA del body.
--     Vale aun con SECURITY DEFINER: auth.uid()/request.headers/request.jwt.claims son GUCs de SESIÓN, no
--     cambian con el privilegio del definer (R2.3).
--   * ts = hora del SYNC (cuándo llegó al server), NO cuándo pasó la acción en campo. Un tacto cargado
--     offline 08:00 que sincroniza 14:00 deja ts=14:00. El "cuándo pasó" real vive en las columnas
--     fechadas por el DEVICE de las tablas de evento (event_date/weight_date/started_at/…). Para la línea
--     de tiempo forense se cruza auth_uid/record/old_record (qué + quién) con esas fechas (cuándo).
--   * Modo de falla (R1.11): best-effort para el camino caliente (animals/eventos) — si el insert de audit
--     falla, el write del operario procede IGUAL (la manga nunca se traba; mismo criterio que
--     ble/logging.ts y upload-rejections.ts, que jamás propagan). ESTRICTO para user_roles (admin, EF, bajo
--     volumen → sin huecos en el log de membresías).
--
-- Vendoreado de supa_audit (la extensión NO está en el catálogo hosted de Supabase) + columna auth_uid
-- (supa_audit no captura actor) + modo de falla por tabla. Ver design.md § "Schema SQL".

begin;

-- ── Schema + enum + tabla append-only ───────────────────────────────────────────────────────────────
create schema if not exists audit;

do $$
begin
  create type audit.operation as enum ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
exception when duplicate_object then null;
end$$;

-- SIN FK ni CHECK (R1.10): la fila de audit debe insertarse SIEMPRE (auth_uid es un uuid pelado, NO fk a
-- public.users → un usuario borrado no rompe el write trackeado). Tipos holgados. ts = HORA DE SYNC.
create table if not exists audit.record_version (
  id             bigint generated always as identity primary key,
  record_id      uuid,                        -- estable por fila (derivado de la PK); NULL si sin PK
  old_record_id  uuid,
  op             audit.operation not null,
  ts             timestamptz not null default now(),   -- HORA DE SYNC (ver header)
  auth_uid       uuid,                        -- ACTOR real (ver header); NULL honesto si no resoluble
  table_oid      oid not null,
  table_schema   name not null,
  table_name     name not null,
  record         jsonb,
  old_record     jsonb
);

create index if not exists record_version_record_id on audit.record_version (record_id) where record_id is not null;
create index if not exists record_version_ts        on audit.record_version (ts);
create index if not exists record_version_table_ts  on audit.record_version (table_oid, ts);

-- ── Helpers de record_id estable (R1.6/R1.7) ─────────────────────────────────────────────────────────
create or replace function audit.primary_key_columns (entity_oid oid)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(pa.attname order by pa.attnum), array[]::text[])
  from pg_index pi
  join pg_attribute pa on pa.attrelid = pi.indrelid and pa.attnum = any(pi.indkey)
  where pi.indrelid = entity_oid and pi.indisprimary;
$$;

-- record_id ESTABLE: uuid v5 (namespace fijo) sobre table_oid + valores de PK → determinístico e idéntico
-- entre versiones (INSERT→UPDATE→DELETE) de la misma fila. Sin PK → NULL (R1.6/R1.7).
create or replace function audit.to_record_id (entity_oid oid, pkey_cols text[], rec jsonb)
returns uuid language sql stable set search_path = '' as $$
  select case
    when rec is null then null
    when pkey_cols = array[]::text[] then null
    else extensions.uuid_generate_v5(
      'fd62bc3d-8d6e-43c2-919c-802ba3762271'::uuid,
      entity_oid::text || ':' ||
      (select string_agg(coalesce(rec ->> col, ''), ':' order by col) from unnest(pkey_cols) x(col))
    )
  end;
$$;

-- Resuelve el ACTOR real (H1 / R2.1/R2.6/R2.8). **TOTAL: NUNCA lanza** (Gate 2 M2-a) → no puede trabar el
-- write trackeado ni en el hot path. El header SOLO se confía si el rol de sesión es service_role (GUC de
-- sesión request.jwt.claims, no current_user → correcto bajo SECURITY DEFINER; anti-spoof R2.8).
create or replace function audit.resolve_actor ()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  v_role  text;
  v_hdr   text;
  v_actor uuid;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    if v_role = 'service_role' then
      -- PostgREST expone request.headers con las claves en minúscula.
      v_hdr := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-rafaq-actor';
      if v_hdr ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_actor := v_hdr::uuid;
      end if;
    end if;
    return coalesce(v_actor, auth.uid());   -- writes con JWT de usuario: auth.uid() (header ignorado)
  exception when others then
    -- Cualquier fallo de parse (claim/header no-JSON, cast) → NULL honesto, nunca bloquea el write.
    begin
      return auth.uid();
    exception when others then
      return null;
    end;
  end;
end; $$;

-- Trigger de auditoría. AFTER I/U/D FOR EACH ROW. SECURITY DEFINER (inserta en audit aunque el caller no
-- tenga grant; el trigger NO requiere EXECUTE del invocante). TG_ARGV[0] elige el modo de falla (R1.11).
-- Gate 2 M2-a: en best-effort TODO (pk + actor + insert) va DENTRO del guard → airtight, el write del
-- operario nunca se traba ni si resolve_actor/pk fallaran.
create or replace function audit.insert_update_delete_trigger ()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_best_effort boolean := (tg_nargs > 0 and tg_argv[0] = 'best_effort');
begin
  if v_best_effort then
    -- CAMINO CALIENTE (R1.11): la manga NUNCA se traba por el audit.
    begin
      insert into audit.record_version (
        record_id, old_record_id, op, auth_uid, table_oid, table_schema, table_name, record, old_record)
      values (
        audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end),
        audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end),
        tg_op::audit.operation, audit.resolve_actor(), tg_relid, tg_table_schema, tg_table_name,
        case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
        case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end);
    exception when others then
      null;   -- best-effort: se acepta perder esta fila de audit antes que bloquear la carga.
    end;
  else
    -- ESTRICTO (user_roles): errores propagan → sin huecos en el log de membresías.
    insert into audit.record_version (
      record_id, old_record_id, op, auth_uid, table_oid, table_schema, table_name, record, old_record)
    values (
      audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
        case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end),
      audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid),
        case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end),
      tg_op::audit.operation, audit.resolve_actor(), tg_relid, tg_table_schema, tg_table_name,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end);
  end if;
  return coalesce(new, old);
end; $$;

-- ── Prender/apagar tracking (R1.9/R1.11) — best_effort elige el modo de falla ─────────────────────────
create or replace function audit.enable_tracking (target regclass, best_effort boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = target and tgname = 'audit_i_u_d' and not tgisinternal
  ) then
    execute format(
      'create trigger audit_i_u_d after insert or update or delete on %s
         for each row execute function audit.insert_update_delete_trigger(%L);',
      target, case when best_effort then 'best_effort' else 'strict' end);
  end if;
end; $$;

create or replace function audit.disable_tracking (target regclass)
returns void language plpgsql security definer set search_path = '' as $$
begin
  execute format('drop trigger if exists audit_i_u_d on %s;', target);
end; $$;

-- ── Retención (D4): purga append-only >90d. SECURITY DEFINER (único DELETE permitido) ────────────────
create or replace function audit.purge_old_record_versions ()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_deleted bigint;
begin
  delete from audit.record_version where ts < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;

-- ── Seguridad fail-closed (R3.x) ─────────────────────────────────────────────────────────────────────
-- Muro primario de LECTURA: revocar USAGE del schema → clientes no pueden ni referenciar audit.*.
revoke all on schema audit                  from public, anon, authenticated;
revoke all on all tables in schema audit    from public, anon, authenticated;
revoke all on all functions in schema audit from public, anon, authenticated;
-- El schema NO se agrega a los schemas expuestos por PostgREST (R3.3). [Gate 1 M1] esto NO se puede
-- enforzar por migración (depende de pgrst.db_schemas del authenticator/dashboard hosted); el backstop
-- DURADERO es el REVOKE de USAGE de arriba → aunque alguien exponga `audit` por error en el dashboard,
-- anon/authenticated siguen sin privilegio (42501). El test PGRST106 es un check puntual, no un guard.
grant usage on schema audit to service_role;
grant select on audit.record_version to service_role;

-- REVOKE execute de cada función sensible (incl. resolve_actor) de los roles cliente (R3.5). El trigger NO
-- requiere EXECUTE del invocante para dispararse → revocarlo NO rompe el tracking (solo cierra el llamado
-- como función/RPC).
revoke execute on function audit.enable_tracking(regclass, boolean)   from public, anon, authenticated;
revoke execute on function audit.disable_tracking(regclass)           from public, anon, authenticated;
revoke execute on function audit.insert_update_delete_trigger()       from public, anon, authenticated;
revoke execute on function audit.purge_old_record_versions()          from public, anon, authenticated;
revoke execute on function audit.primary_key_columns(oid)             from public, anon, authenticated;
revoke execute on function audit.to_record_id(oid, text[], jsonb)     from public, anon, authenticated;
revoke execute on function audit.resolve_actor()                      from public, anon, authenticated;

-- Smoke-check fail-closed DOBLE (R3.6 + [Gate 1 M1] R3.7): aborta si (a) alguna función de audit quedó
-- EXECUTE-able por un rol cliente, o (b) el MURO DE LECTURA quedó abierto (USAGE de schema / SELECT de la
-- tabla) para anon/authenticated. Paridad de tripwire entre EXECUTE y lectura (patrón 0066/0055/0068).
do $$
declare v_bad record;
begin
  -- (a) EXECUTE de funciones sensibles (R3.6).
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','authenticated','public']) as rolname) r
    where n.nspname = 'audit'
      and p.proname in ('enable_tracking','disable_tracking','insert_update_delete_trigger',
                        'purge_old_record_versions','primary_key_columns','to_record_id','resolve_actor')
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (R3.6): audit.% is EXECUTE-able by %', v_bad.proname, v_bad.rolname;
  end loop;
  -- (b) Muro de LECTURA (R3.7): USAGE de schema + SELECT de la tabla.
  if has_schema_privilege('anon','audit','USAGE')
     or has_schema_privilege('authenticated','audit','USAGE')
     or has_table_privilege('anon','audit.record_version','SELECT')
     or has_table_privilege('authenticated','audit.record_version','SELECT') then
    raise exception 'audit read-wall FAILED (R3.7): anon/authenticated tienen USAGE/SELECT sobre audit';
  end if;
  raise notice 'audit grant + read-wall check OK (R3.6/R3.7): audit cerrado a anon/authenticated/public';
end$$;

-- ── Prender el tracking del INCREMENTO 1 (D3, R5.1) ──────────────────────────────────────────────────
select audit.enable_tracking('public.user_roles');   -- #1 estricto (admin, actor real por la EF vía header)

-- ⚠️ animals (#2 por valor) va GATEADO por el gate DURO de volumen (R5.2/R5.4/T12): NO se prende hasta
--    medir en dev el volumen + LATENCIA que genera un import representativo (spec 12) en
--    audit.record_version, proyectado contra 500 MB (tabla CROSS-TENANT compartida, acotada por la
--    retención 90d), y con margen. Cuando T12 pase, el leader coordina descomentar la línea de abajo.
--    NO se prende animal_profiles / tablas de evento / treatments / rodeos / establishments (R5.6), ni
--    user_private/PII (R5.5), en este incremento.
-- select audit.enable_tracking('public.animals', best_effort => true);   -- #2 best-effort — GATEADO (T12/R5.4)

-- ── Retención mensual idempotente (R6.x, patrón cron de 0066) ────────────────────────────────────────
create extension if not exists pg_cron;
do $$
begin perform cron.unschedule('audit_purge_monthly'); exception when others then null; end$$;  -- R6.3
select cron.schedule('audit_purge_monthly', '0 4 1 * *', $cron$ select audit.purge_old_record_versions(); $cron$);

commit;
