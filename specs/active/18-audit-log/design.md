# Design — 18-audit-log

> CÓMO se construye el audit forense server-side. 100% backend. Migración `0124` (as-built = `0123`),
> una suite de tests nueva + su enganche, y un cambio ACOTADO en 4 Edge Functions (propagación de actor,
> Opción A — Gate 1 H1). Fuente de verdad de las decisiones: `context.md` (Gate 0) + `progress/
> security_spec_18-audit-log.md` (Gate 1). Aterriza D1–D5 + H1/M1/M2/M3 en SQL/TS concreto.
>
> **Reconciliado tras Gate 1 (2026-07-13):** ver bloques marcados `[Gate 1: …]`.

## Archivos a crear / modificar

| Archivo | Acción | Qué |
|---|---|---|
| `supabase/migrations/0124_audit_log.sql` | **crear** | Schema `audit` vendoreado + `record_version` append-only (sin FK/CHECK) + helpers + `enable/disable_tracking(regclass, best_effort)` + trigger `SECURITY DEFINER` que resuelve el **actor real** (header guardado por rol + `auth.uid()`) y respeta el modo best-effort/estricto + REVOKEs + smoke-check doble (EXECUTE **y** muro de lectura) + `enable_tracking('public.user_roles', strict)` + `enable_tracking('public.animals', best_effort)` + retención `pg_cron` mensual. `BEGIN/COMMIT`. Header documenta la semántica temporal (R2.5). **NO auto-aplicar**: deploy gateado tras Gate 1 re-run + Puerta 1. |
| `supabase/functions/_shared/supabase.ts` | **modificar** | `createAdminClient(actorId?: string)` — si viene `actorId`, agrega el header global `X-Rafaq-Actor` a TODAS las requests del admin client. Cambio aditivo (default sin header = comportamiento actual). |
| `supabase/functions/accept_invitation/index.ts` | **modificar** | Crear el admin client con el actor (`createAdminClient(user.id)`) tras `requireUser`; reordenar si hace falta. Sin cambio de contrato ni de lógica (R8.3). |
| `supabase/functions/change_member_role/index.ts` | **modificar** | Ídem — `createAdminClient(user.id)` (el owner). |
| `supabase/functions/remove_member/index.ts` | **modificar** | Ídem — `createAdminClient(user.id)` (el owner). |
| `supabase/functions/delete_account/index.ts` | **modificar** | Ídem — `createAdminClient(user.id)` (el auto-borrado). Su write de `user_roles` va por la RPC `delete_account_tx`; el header viaja en esa misma request → el trigger lo ve en la transacción de la RPC. |
| `supabase/tests/audit/run.cjs` | **crear** | Suite backend nueva (node:test, patrón `maneuvers/run.cjs`). Lecturas de `audit` vía `adminQuery` (Management API); fail-closed vía supabase-js `anon`/`authenticated`; actor de Opción A por el camino de producción (service_role + header). |
| `scripts/run-tests.mjs` | **modificar** | Enganchar `node --test supabase/tests/audit/run.cjs` detrás del guard `SUPABASE_SERVICE_ROLE_KEY` (15ª suite). |

**No se toca** ninguna migración existente, ninguna tabla del audit de DOMINIO, ni código de app/tests
del cliente (R8.1, R8.2). `invite_user` **no** se toca (no muta `user_roles`, R2.9). `git diff app/`
debe quedar vacío.

---

## Multi-tenancy (obligatorio mencionarlo — la feature roza la frontera)

El audit forense es **cross-tenant por diseño**: `audit.record_version` guarda versiones de filas de
todos los establecimientos (incluido `user_roles`, la tabla de membresías multi-tenant). No viola el
aislamiento porque el acceso de lectura está cerrado a todo rol cliente (R3.1–R3.4): la tabla no tiene
RLS "permisiva" porque **ningún cliente puede referenciar el schema** (se revoca `USAGE`), y no está
expuesta por PostgREST. El único lector es server-side (`service_role` / `postgres` directo). Mismo
criterio que `refresh_age_categories` (0066, cross-tenant + revocada). Gate 1 debe confirmar que no hay
un camino cliente a `audit.*`. **[Gate 1 M2]** el cap de 500 MB de la tabla es un recurso **compartido**
cross-tenant → un tenant que spamea writes de `animals` puede acercar el cap y (en modo estricto)
degradar los writes de otros; por eso `animals` va **best-effort** (R1.11) + gate de volumen (R5.4).

## Offline-first / frontera con el sync (obligatorio — la feature toca PowerSync)

Roza el sync en un punto crítico: el WAL lógico que PowerSync replica. Si `audit.record_version` llegara
a un device, sería un leak forense.

> **[As-built 2026-07-13 — reconciliación del frontier]** La verificación read-only de R4.1 arrojó que la
> publication `powersync` es **`FOR ALL TABLES`** (`puballtables = true`), NO `FOR TABLE` explícita como
> asumía esta spec. En este proyecto **el frontier de sincronización NO es la publication sino las SYNC
> STREAMS** (`sync-streams/rafaq.yaml`): el WAL replica TODA la base al servicio de PowerSync, y cada stream
> scopea explícitamente qué llega a cada device (ADR-025/026; header de `rafaq.yaml`). Una tabla que no
> aparece en ninguna stream (y no hay stream catch-all) nunca llega a un device — mismo mecanismo que
> mantiene fuera a `animals`/`users`/`import_log`. Por eso `audit.record_version` **no se agrega a
> `rafaq.yaml`** (R4.2 intent) → no fuga a devices. No se puede excluir del `FOR ALL TABLES` → residual =
> costo de WAL menor (INSERT-only, retención 90d). **D5 (audit no fuga a devices) SE CUMPLE por el frontier
> de streams.** R4.1 (STOP si `FOR ALL TABLES`) y R4.3 (audit ausente de `pg_publication_tables`) quedan
> reconciliados: el invariante verificado (TA.11) es "audit no referenciada en las sync streams". **Requiere
> ratificación de Raf en Puerta 2** (recomendación: aceptar el frontier de streams, no convertir la
> publication). Ver `requirements.md` R4.x + `progress/impl_18-audit-log.md`.

**Diseño original (asunción, no as-built):** el pre-requisito R4.1 pedía confirmar `FOR TABLE <lista
explícita>` ANTES de aplicar; con `FOR TABLE` una tabla nueva no entra sola al WAL. La migración además no
agrega la tabla a ninguna publication (R4.2). (Checklist de PowerSync de feature 16 E.1 / plan Fase 1 §2.)

---

## Semántica temporal + ACTOR — el punto crítico (D2 + H1, va en el header de la migración)

Tres hechos que no hay que confundir:

1. **`auth_uid` = el ACTOR REAL.** Se resuelve así (R2.1):
   - Writes con el **JWT del usuario** (RPCs de dominio invocadas por el usuario, PowerSync que sube con
     el JWT del usuario): `auth.uid()` ES el usuario real. Vale aun con el trigger `SECURITY DEFINER`
     (`auth.uid()` lee `request.jwt.claims`, un GUC de sesión que fija PostgREST por request; el definer
     cambia el *privilegio*, no las GUCs — R2.3).
   - Writes por **Edge Function con `service_role`** (las mutaciones de `user_roles`: invitaciones,
     cambios de rol, bajas, borrado de cuenta): `auth.uid()` sería **NULL** (el admin client no manda
     JWT de usuario). Por eso **[Gate 1 H1 / Opción A]** la EF propaga el actor por el header
     `X-Rafaq-Actor` y el trigger lo usa **solo si el rol de sesión es `service_role`** (R2.6/R2.8). El
     actor es el `user.id` del **JWT validado del llamante** (`requireUser`), NUNCA del body (R2.7) → no
     spoofeable. Un cliente `authenticated` que forje el header es **ignorado** (su rol no es
     service_role) → su write se atribuye a su `auth.uid()` real (R2.8).

2. **`ts` = hora del SYNC, NO de la acción.** El trigger dispara cuando la mutación llega al servidor
   (cuando el device recupera señal y PowerSync sube la cola). Un tacto cargado offline 08:00 que
   sincroniza 14:00 deja `ts = 14:00`. El "cuándo pasó" real vive en las columnas fechadas por el device
   que las tablas de evento ya llevan (`event_date`, `weight_date`, `started_at`, …). Para la línea de
   tiempo forense se cruza `auth_uid`/`record`/`old_record` (qué + quién) con esas fechas (cuándo) y con
   Sentry/PostHog (feature 17). `ts` sirve para "cuándo se sincronizó / orden de llegada".

3. **Modo de falla [Gate 1 M2].** El insert de audit es **best-effort** para el camino caliente de campo
   (`animals` y futuras tablas de evento): si falla, el write del operario **procede igual** (regla dura
   RAFAQ: la manga nunca se traba; mismo criterio que `ble/logging.ts` y `upload-rejections.ts`, que
   jamás propagan). Para `user_roles` (admin, EF, bajo volumen) es **estricto** (sin huecos).

Los tres hechos van **en el header** de `0124_audit_log.sql` (R2.5).

---

## Schema SQL (contrato de diseño — el implementer escribe el archivo real)

Vendoreado de `supa_audit` (la extensión **no** está en el catálogo hosted de Supabase, D1), recortado a
lo que RAFAQ necesita, **con la columna `auth_uid`** (supa_audit no captura actor) y el **modo de falla
por tabla**.

```sql
-- 0124_audit_log.sql — Audit forense server-side (spec 18). Cubre R1..R8.
-- ⚠️ NO aplicar desde acá: deploy gateado (Raf/leader) tras Gate 2 + Puerta 2.
--    Frontier WAL (R4.x, RECONCILIADO al as-built): la publication `powersync` es FOR ALL TABLES
--    (puballtables=true, verificado en dev 2026-07-13). El frontier real son las sync streams
--    (`sync-streams/rafaq.yaml`): audit.* NO aparece en ninguna stream (sin catch-all) → nunca llega
--    a un device (D5 se cumple por el frontier de streams, igual que animals/users hoy). audit.* NO
--    se agrega a rafaq.yaml. Convertir la publication no aporta seguridad y es más riesgoso (Gate 2).
--
-- SEMÁNTICA TEMPORAL + ACTOR (D2 + H1 — leer antes de usar el log):
--   * auth_uid = el ACTOR REAL:
--       - write con JWT de usuario (RPC/PowerSync) → auth.uid().
--       - write por Edge Function (service_role) → actor propagado por el header X-Rafaq-Actor, usado
--         SOLO si el rol de sesión es service_role (un usuario no puede spoofear el header). El actor
--         es el user.id del JWT validado del llamante de la EF, no del body.
--     Vale aun con SECURITY DEFINER (auth.uid()/request.headers/request.jwt.claims son GUCs de sesión,
--     no cambian con el privilegio del definer).
--   * ts = hora del SYNC (cuándo llegó al server), NO cuándo pasó la acción. El "cuándo pasó" real vive
--     en las fechas de DEVICE de las tablas de evento (event_date/weight_date/started_at/…).
--   * Modo de falla: best-effort para el camino caliente (animals/eventos) — si el audit falla, el
--     write del operario procede igual (la manga nunca se traba); estricto para user_roles (sin huecos).

begin;

create schema if not exists audit;

create type audit.operation as enum ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- Tabla append-only. SIN FK ni CHECK (R1.10): la fila de audit debe insertarse SIEMPRE (auth_uid es un
-- uuid pelado, NO fk a public.users → un usuario borrado no rompe el write trackeado). Tipos holgados.
create table audit.record_version (
  id             bigint generated always as identity primary key,
  record_id      uuid,                       -- estable por fila (derivado de la PK); NULL si sin PK
  old_record_id  uuid,
  op             audit.operation not null,
  ts             timestamptz not null default now(),   -- HORA DE SYNC (ver header)
  auth_uid       uuid,                       -- ACTOR real (ver header); NULL honesto si no resoluble
  table_oid      oid not null,
  table_schema   name not null,
  table_name     name not null,
  record         jsonb,
  old_record     jsonb
);

create index record_version_record_id on audit.record_version (record_id) where record_id is not null;
create index record_version_ts        on audit.record_version (ts);
create index record_version_table_ts  on audit.record_version (table_oid, ts);

-- Helper: columnas de PK (para record_id estable).
create or replace function audit.primary_key_columns (entity_oid oid)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(pa.attname order by pa.attnum), array[]::text[])
  from pg_index pi
  join pg_attribute pa on pa.attrelid = pi.indrelid and pa.attnum = any(pi.indkey)
  where pi.indrelid = entity_oid and pi.indisprimary;
$$;

-- Helper: record_id ESTABLE (uuid v5 sobre table_oid + valores de PK). Sin PK → NULL (R1.6/R1.7).
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

-- Helper: resuelve el ACTOR real (H1 / R2.1/R2.6/R2.8). **[Gate 2 M2-a] TOTAL: NUNCA lanza** — todo el
-- cuerpo va envuelto en exception → ni el parse de la claim de rol ni del header pueden trabar el write
-- trackeado (belt-and-suspenders con el guard best-effort del trigger). Regex UUID estricto + cast bajo el
-- mismo guard. El header SOLO se confía si el rol de sesión es service_role (anti-spoof R2.8).
create or replace function audit.resolve_actor ()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  v_role     text;
  v_hdr      text;
  v_actor    uuid;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    if v_role = 'service_role' then
      -- request.headers: PostgREST lo expone con las claves en minúscula.
      v_hdr := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-rafaq-actor';
      if v_hdr ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_actor := v_hdr::uuid;
      end if;
    end if;
    return coalesce(v_actor, auth.uid());   -- writes con JWT de usuario: auth.uid() (header ignorado)
  exception when others then
    begin return auth.uid(); exception when others then return null; end;  -- NULL honesto, nunca bloquea
  end;
end; $$;

-- Trigger de auditoría. AFTER I/U/D. SECURITY DEFINER (inserta en audit aunque el caller no tenga grant;
-- el trigger NO requiere EXECUTE del invocante). El TG_ARGV[0]='best_effort' selecciona el modo (R1.11).
-- **[Gate 2 M2-a]** en best-effort TODO (pk + actor + insert) va DENTRO del guard `begin…exception…end`
-- → airtight: ni resolve_actor ni primary_key_columns pueden trabar el write del operario. Por eso NO se
-- resuelven en el DECLARE (que quedaría fuera del guard). resolve_actor además es TOTAL (nunca lanza).
create or replace function audit.insert_update_delete_trigger ()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_best_effort boolean := (tg_nargs > 0 and tg_argv[0] = 'best_effort');
begin
  if v_best_effort then
    begin
      insert into audit.record_version (record_id, old_record_id, op, auth_uid, table_oid, table_schema, table_name, record, old_record)
      values (
        audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid), case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end),
        audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid), case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end),
        tg_op::audit.operation, audit.resolve_actor(), tg_relid, tg_table_schema, tg_table_name,
        case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
        case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end
      );
    exception when others then
      null;   -- CAMINO CALIENTE (R1.11): el write del operario NUNCA se bloquea por el audit.
    end;
  else
    insert into audit.record_version (record_id, old_record_id, op, auth_uid, table_oid, table_schema, table_name, record, old_record)
    values (
      audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid), case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end),
      audit.to_record_id(tg_relid, audit.primary_key_columns(tg_relid), case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end),
      tg_op::audit.operation, audit.resolve_actor(), tg_relid, tg_table_schema, tg_table_name,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end
    );   -- ESTRICTO (user_roles): errores propagan → sin huecos en el log de membresías.
  end if;
  return coalesce(new, old);
end; $$;

-- Prender/apagar tracking. `best_effort` elige el modo de falla (R1.9/R1.11).
create or replace function audit.enable_tracking (target regclass, best_effort boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = target and tgname = 'audit_i_u_d' and not tgisinternal) then
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

-- Retención (D4): purga append-only >90d. SECURITY DEFINER (único DELETE permitido).
create or replace function audit.purge_old_record_versions ()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_deleted bigint;
begin
  delete from audit.record_version where ts < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;

-- ── Seguridad fail-closed (R3.x) ────────────────────────────────────────────────────────────────
-- Muro primario de LECTURA: revocar USAGE del schema → clientes no pueden ni referenciar audit.*.
revoke all on schema audit                       from public, anon, authenticated;
revoke all on all tables in schema audit         from public, anon, authenticated;
revoke all on all functions in schema audit      from public, anon, authenticated;
-- El schema NO se agrega a los schemas expuestos por PostgREST (R3.3). [Gate 1 M1] esto NO se puede
-- enforzar por migración (depende de pgrst.db_schemas del authenticator/dashboard hosted); el backstop
-- DURADERO es el REVOKE de USAGE de arriba → aunque alguien exponga `audit` por error en el dashboard,
-- anon/authenticated siguen sin privilegio (42501). El test PGRST106 es un check puntual, no un guard.
grant usage on schema audit to service_role;
grant select on audit.record_version to service_role;

revoke execute on function audit.enable_tracking(regclass, boolean)   from public, anon, authenticated;
revoke execute on function audit.disable_tracking(regclass)           from public, anon, authenticated;
revoke execute on function audit.insert_update_delete_trigger()       from public, anon, authenticated;
revoke execute on function audit.purge_old_record_versions()          from public, anon, authenticated;
revoke execute on function audit.primary_key_columns(oid)             from public, anon, authenticated;
revoke execute on function audit.to_record_id(oid, text[], jsonb)     from public, anon, authenticated;
revoke execute on function audit.resolve_actor()                      from public, anon, authenticated;

-- Smoke-check fail-closed DOBLE (R3.6 + [Gate 1 M1] R3.7): aborta si (a) alguna función de audit quedó
-- EXECUTE-able por un rol cliente, o (b) el MURO DE LECTURA quedó abierto (USAGE de schema / SELECT de
-- la tabla) para anon/authenticated. Paridad de tripwire entre EXECUTE y lectura.
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
end$$;

-- ── Prender el tracking del INCREMENTO 1 (D3, R5.1) ─────────────────────────────────────────────
select audit.enable_tracking('public.user_roles');                 -- #1 estricto (admin, actor por EF)
-- **[As-built]** `animals` va GATEADA (COMENTADA en la migración): el gate DURO de volumen + LATENCIA
--    (R5.2/R5.4/T12) se mide POST-deploy antes de prenderla. Cuando pase, el leader coordina descomentar:
-- select audit.enable_tracking('public.animals', best_effort => true); -- #2 best-effort — GATEADO (T12/R5.4)
--    NO se prende animal_profiles / tablas de evento / treatments / rodeos / establishments (R5.6), ni
--    user_private/PII (R5.5), en este incremento.

-- ── Retención mensual idempotente (R6.x, patrón cron de 0066) ───────────────────────────────────
create extension if not exists pg_cron;
do $$
begin perform cron.unschedule('audit_purge_monthly'); exception when others then null; end$$;  -- R6.3
select cron.schedule('audit_purge_monthly', '0 4 1 * *', $cron$ select audit.purge_old_record_versions(); $cron$);

commit;
```

**Notas de diseño sobre el SQL**

- **`record_id` estable (R1.6):** `uuid_generate_v5` (namespace fijo) sobre `table_oid + valores de PK`
  → determinístico e idéntico entre versiones. Depende de `extensions.uuid_generate_v5` (uuid-ossp,
  disponible en Supabase). `user_roles`/`animals` tienen PK `id` uuid → siempre estable.
- **`SECURITY DEFINER` + `search_path=''`:** el trigger inserta en `audit.*` aunque el caller no tenga
  grant; nombres calificados evitan hijacking de search_path. Los GUCs de sesión (`request.jwt.claims`,
  `request.headers`, `auth.uid()`) siguen resolviendo al caller (R2.3).
- **[Gate 1 M2] robustez del insert (R1.10):** `record_version` no tiene FK ni CHECK; `auth_uid` es un
  uuid pelado (no FK a `users`) → un usuario borrado no puede hacer fallar el write trackeado. El
  best-effort de `animals` es la segunda red; la robustez estructural es la primera.
- **Append-only (R1.8):** sin policy ni grant de UPDATE/DELETE para clientes; único DELETE = la purga
  server-side. No se habilita RLS deny-all (redundante: `revoke usage on schema` ya cierra el acceso —
  ver Alternativa B).
- **[Gate 1 L1] TRUNCATE:** el trigger es `FOR EACH ROW` → no captura `TRUNCATE` (saltea row-triggers).
  No es explotable: `anon`/`authenticated` no tienen privilegio de TRUNCATE sobre `user_roles`/`animals`
  (solo `service_role`/`postgres`, de confianza). El valor `'TRUNCATE'` queda en el enum por completitud;
  cubrirlo requeriría un `AFTER TRUNCATE … FOR EACH STATEMENT` aparte (fuera de scope, opcional).
- **[Gate 1 L2] sin `notify pgrst`:** correcto — `audit` no se expone por PostgREST, no hay schema-cache
  que refrescar. No-issue (se anota para que el reviewer de código no lo pida "por costumbre").

---

## Cambio en las Edge Functions (Opción A — [Gate 1 H1])

**Contrato:** `createAdminClient(actorId?: string)` en `_shared/supabase.ts` — cuando llega `actorId`,
agrega `global.headers['X-Rafaq-Actor'] = actorId`. Aditivo (sin arg = igual que hoy). Es el ÚNICO canal
per-request y **misma-transacción** que tiene supabase-js: PostgREST expone cada header entrante como
`request.headers` (GUC transaction-local, seteado al inicio de la transacción de CADA request) → el
trigger lo ve en la misma transacción del DML, sin importar que cada `.from().update()` / `.rpc()` sea
una request/transacción distinta. (Por eso NO se usa `set_config(...,true)` desde la EF: no compartiría
transacción — ver § Alternativas.)

**Las 4 EFs** (`accept_invitation`, `change_member_role`, `remove_member`, `delete_account`): tras
`requireUser(userClient)` (que valida el JWT), crear el admin client con el actor:

```ts
const userClient = createUserClient(req);
const user = await requireUser(userClient);        // valida el JWT del LLAMANTE
const adminClient = createAdminClient(user.id);    // ← actor = user.id (del JWT), NUNCA del body (R2.7)
```

- **`accept_invitation`**: actor = `user.id` (el que acepta; se auto-agrega el `user_roles`).
- **`change_member_role`**: actor = `user.id` (el owner; el `targetUserId` del body es el TARGET, no el
  actor). Cubre el INSERT nuevo + los 2 UPDATE (deactivate + rollback).
- **`remove_member`**: actor = `user.id` (el owner). Cubre el UPDATE deactivate.
- **`delete_account`**: actor = `user.id` (auto-borrado). El write de `user_roles` va dentro de la RPC
  `delete_account_tx` (SECURITY DEFINER, 1 sola request `.rpc()`) → el header viaja en esa request → el
  trigger lo ve en la transacción de la RPC. **`delete_account_tx` no se toca** (el header basta).

**Reordenamiento:** hoy el `adminClient` se crea ANTES de `requireUser`; con Opción A se crea DESPUÉS
(necesita `user.id`). El resto de la lógica (validaciones, `requireOwnerOf`, RPC `revoke_user_sessions`)
queda idéntica (R8.3 — mismo contrato HTTP, mismas respuestas). El header viaja en TODAS las requests del
admin client de esa invocación, incluidas las lecturas — inocuo (ningún trigger lee el header salvo en un
write a tabla trackeada).

**`invite_user` NO se toca**: solo lee `user_roles` y escribe `invitations` (no trackeada en este
incremento). Corrección al alcance del reporte (que listó 5 EFs); son **4**.

**Anti-spoof (R2.7/R2.8):** el actor sale de `requireUser` (JWT validado), no del body. Un cliente
`authenticated` que forje `X-Rafaq-Actor` en su propio write es ignorado porque su rol no es
`service_role` (el guard de `resolve_actor`). El header solo se confía en contexto service_role, que solo
tiene la EF (la key nunca va al browser).

---

## [Gate 1 M3] PII en el audit — reconocido y acotado

`user_roles.member_name` (nombre de persona, denormalizado por `0080`) entra a `audit.record`/`old_record`
al hacer `to_jsonb(new/old)` de la fila. **No es fuga** (audit cerrado a TODO cliente, R3.x; el único
lector server-side ya ve todo) y la PII **fuerte** (email/phone) vive en `user_private`, **no** trackeada
(R5.5). Lo que aterriza es el **nombre**. Postura (reconciliada con la Alternativa C, "fila completa por
valor forense"): se **acepta** el nombre en el audit como interés legítimo de seguridad, **acotado por la
retención de 90 días** (R5.7). Interacción con el derecho de supresión (Ley 25.326): tras un
`delete_account`, el nombre del usuario persiste en `audit.record_version` **como máximo 90 días** (la
purga mensual lo elimina) → la retención D4 ES la mitigación de supresión. Queda escrito para que nadie
asuma que el audit es PII-free.

---

## Enfoque de tests (`supabase/tests/audit/run.cjs`)

Patrón `maneuvers/run.cjs` + helper `adminQuery` (Management API `database/query`, corre como `postgres`
→ lee cualquier schema; modela el lector forense real, no un cliente). Fail-closed de cliente vía
supabase-js `.schema('audit')` con `anon`/`authenticated`.

> **[As-built 2026-07-13 — reconciliación de la tabla de tests]** Como `animals` va **gateada** en el
> incremento 1 (T12/R5.4), la tabla trackeada de los asserts de actor/record_id/op es **`user_roles`** (la
> única trackeada), que un `authenticated` SÍ puede escribir directo (INSERT self-owner al crear un
> establishment vía trigger 0011; UPDATE vía `user_roles_update_owner` 0008) → el camino JWT queda
> ejercido igual. TA.2/TA.3 (INSERT/UPDATE uid por JWT), TA.4/TA.5 (DELETE + record_id estable) y TA.6
> (actor NULL) se hacen sobre `user_roles`. **TA.13 (spoof)** se ejerce por `user_roles` (Gate 1 watch-item
> #2: `animals` no es escribible directo por `authenticated` y está gateada). **TA.11 (frontera WAL)** se
> reconcilia al frontier real: assert de que `audit` NO está referenciada en `sync-streams/rafaq.yaml` (sin
> catch-all), NO membresía en `pg_publication_tables` (que fallaría bajo `FOR ALL TABLES`). Se agrega
> verificación de que `animals` NO tiene el trigger de audit todavía (gate pendiente).

| Test | Verifica | R |
|---|---|---|
| TA.1 setup | usuarios + establishment + rol de test | — |
| TA.2 INSERT uid | insert de `animals` por user de test (JWT) → versión op=INSERT, auth_uid = user | R1.3, R2.1 |
| TA.3 UPDATE uid | update → op=UPDATE, old_record + record, auth_uid = user | R1.4, R2.1 |
| TA.4 DELETE uid | delete (admin/cascade) → op=DELETE, old_record, record NULL | R1.5 |
| TA.5 record_id estable | las 3 versiones de la misma fila comparten `record_id` | R1.6 |
| TA.6 actor NULL | write service_role SIN header → auth_uid NULL, DML OK | R2.2, R7.4b |
| TA.7 fail-closed anon | `anon` no puede `SELECT` audit (PGRST106) | R3.2, R3.3 |
| TA.8 fail-closed authenticated | `authenticated` no puede `SELECT` audit | R3.2, R3.3 |
| TA.9 grants lectura | `has_table_privilege` anon/authenticated SELECT = false; `has_schema_privilege` USAGE = false | R3.1, R3.7 |
| TA.10 append-only | anon/authenticated sin UPDATE/DELETE privilege sobre audit | R1.8 |
| TA.11 WAL frontier | **[as-built]** `audit` NO referenciada en `sync-streams/rafaq.yaml` (frontier real, sin catch-all) + `animals` sin trigger de audit (gate pendiente); la publication es `FOR ALL TABLES` (documentado) | R4.2, R4.3 |
| **TA.12 actor Opción A (prod-path)** | **service_role client con header `X-Rafaq-Actor` → INSERT `user_roles` → audit.auth_uid = actor** (camino REAL de la EF; no falso verde) | R2.6, R5.1, R7.4a |
| **TA.13 spoof-safety** | **[as-built]** **`authenticated` con header `X-Rafaq-Actor` forjado → UPDATE de su propia fila de `user_roles` (policy `user_roles_update_owner`) → auth_uid = su auth.uid() real, NO el header** | R2.8, R7.4c |
| TA.14 best-effort vs estricto | (documental/comportamental) `animals` best-effort no bloquea; `user_roles` estricto — verificar `tg_argv` del trigger vía `adminQuery` a `pg_trigger` | R1.11 |
| TA.15 retención | fila con `ts` backdateada >90d → `purge_old_record_versions()` la borra; fila reciente propia queda | R6.2 |
| TA.16 smoke funciones | `has_function_privilege` anon/authenticated EXECUTE de enable/disable/purge/resolve_actor = false | R3.5 |
| cleanup | CASCADE de establishments + delete de users | — |

> **TA.12 es el test que Gate 1 marcó como "falso verde" potencial.** Se hace por el camino de
> PRODUCCIÓN: un `createClient(url, SERVICE_ROLE_KEY, { global: { headers: { 'X-Rafaq-Actor': actorId }}})`
> + `.from('user_roles').insert(...)` reproduce EXACTAMENTE lo que hace la EF (service_role + header +
> PostgREST) → assert `audit.auth_uid = actorId` vía `adminQuery`. NO se inserta por JWT directo ni por
> `adminQuery` (eso sería el falso verde).
>
> Higiene: suite autocontenida, namespaced por `RUN_TAG`; asserts filtran por `auth_uid`/`record->>'id'`,
> nunca por conteos absolutos. TA.15 inserta una fila de prueba con `ts` viejo (vía `adminQuery`) y
> verifica que la purga borra esa y respeta una reciente propia — sin tocar el resto de la tabla.

---

## Alternativas descartadas

**A) Instalar `supa_audit` / `pgaudit` como extensión del catálogo.** `supa_audit` no está en el catálogo
hosted → no se puede `create extension`. `pgaudit` loguea *statements*, no *filas* con old/new ni actor
por fila. Por eso se **vendorea** el patrón supa_audit + `auth_uid`. Elegido.

**B) Cerrar la lectura con RLS deny-all en vez de `REVOKE USAGE` del schema.** Redundante: `service_role`
tiene `BYPASSRLS` (la RLS no lo frenaría) y `REVOKE USAGE ON SCHEMA audit` ya impide que
`anon`/`authenticated` **referencien** la tabla (falla antes de evaluar policies). El muro efectivo es el
REVOKE de schema + la no-exposición por PostgREST + el smoke-check R3.7. Descartada por redundante.

**C) Guardar solo columnas actor/tiempo (no la fila completa).** Achica volumen pero destruye el valor
forense ("qué cambió"). Se conserva la fila completa, acotando costo con retención >90d (D4) + alcance
incremental medido (D3). Reconciliada con M3: el costo es que la fila lleva `member_name` (mitigado por
la retención). Elegido guardar la fila completa.

**D) [Gate 1 H1] Propagar el actor con `set_config('rafaq.actor_id', …, true)` desde la EF, antes del
DML.** Es lo que sugería el reporte al pie de la letra, pero **no funciona** con supabase-js: cada
llamada (`.rpc('set_config')` y `.from('user_roles').update()`) es una **transacción distinta** bajo el
pooler → la GUC `is_local=true` puesta en una no está en la transacción del DML de la otra. Variante
correcta: **envolver actor-set + DML en un ÚNICO RPC `SECURITY DEFINER`** (`perform set_config(...,true)`
+ el DML en el mismo cuerpo = misma transacción). Se descartó frente al header porque exige **refactorizar
la lógica de escritura de 3 EFs** (accept/change/remove) de TS a SQL — mayor blast radius sobre features
`done`, más superficie de Gate 2, y cambiaría la atomicidad de `change_member_role`. El **header
`X-Rafaq-Actor` guardado por rol** logra el mismo objetivo (actor real, misma transacción, spoof-safe) con
un cambio de 1 línea por EF y sin RPCs nuevas. Elegido el header; el RPC-wrapper queda como fallback si
Gate 1 re-run objeta el header.

**E) [Gate 1 H1] Columna `actor_id` en `user_roles` que la EF escribe y el trigger lee.** Acopla el
schema de dominio al audit (una columna que solo sirve al audit), y no resuelve las tablas sin esa
columna. Descartada (Opción B del reporte, "clunky").

---

## Deltas posteriores

(ninguno todavía — baseline inicial de la feature 18)
