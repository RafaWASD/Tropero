-- 0133_rename_audit_headers_mitropero.sql — Rebrand fase 5: headers de wire `X-Rafaq-*` → `X-Mitropero-*`
-- del lado de la BASE. Re-CREA los DOS lectores de header del audit para que acepten el nombre NUEVO y,
-- si no vino, el VIEJO.
--
-- ⚠️ NO aplicar desde acá: DEPLOY GATEADO (Raf/leader). Toca funciones que corren en el camino de TODO
--    write trackeado (hoy `public.user_roles`, estricto) → re-correr la suite `audit` + la suite `edge`.
--
-- ── POR QUÉ TOLERANTE Y NO CORTE SECO ────────────────────────────────────────────────────────────────
-- El rename va en DOS TIEMPOS: (1) servidor tolerante [esta migración + `_shared/request-headers.ts`],
-- (2) clientes escriben sólo el nombre nuevo, (3) limpieza del fallback cuando no queden clientes viejos
-- (anotada en docs/backlog.md con su condición). Con corte seco se perdería el `request_id`/`actor` en
-- silencio — no rompe nada visible, y para una feature de auditoría eso es el peor modo de falla.
--
-- ⚠️ SEAMOS PRECISOS SOBRE QUÉ CUBRE ESTE FALLBACK, porque hay DOS tolerancias y no son la misma:
--   * La que salva a las **builds ya instaladas** (TestFlight + el APK de los testers; NO hay OTA, así que
--     su header no cambia nunca) vive en el **TypeScript**: `readRequestIdHeader` en
--     `_shared/request-headers.ts`, que `serveEf` usa para leer el request HTTP entrante. Ese cliente le
--     habla a una Edge Function, no a PostgREST — su header viejo se atrapa ahí, y el admin client re-emite
--     el id ya con el nombre NUEVO hacia PostgREST.
--   * El fallback de ESTAS DOS FUNCIONES cubre lo otro: quien le manda el header viejo **directo a
--     PostgREST**. Hoy eso es (a) la **ventana de deploy** entre aplicar esta migración y redeployar las
--     Edge Functions —en la que las EFs viejas siguen mandando `x-rafaq-*`—, (b) un redeploy parcial o un
--     rollback de una EF, y (c) cualquier caller futuro que escriba directo. Es barato (un `if` por
--     función) y evita que el ORDEN del deploy pueda perder correlación, que es justo lo que el plan
--     intentaba conseguir pidiendo un orden.
-- Las dos capas resuelven con el MISMO criterio (gana el nuevo; se cae al viejo si el nuevo falta o no es
-- un uuid) a propósito: dos reglas de precedencia parecidas pero distintas es cómo se cuelan estos bugs.
--
-- ── BASE DEL RE-CREATE (reference_function_recreate_base) ────────────────────────────────────────────
-- Moldeado sobre el cuerpo **VIGENTE EN EL REMOTO** traído con `pg_get_functiondef` el 2026-08-17, NO
-- sobre la migración que lo definió. Medido: `resolve_actor` vigente == 0124 y `resolve_request_id`
-- vigente == 0131 (sin drift esta vez — pero se verificó, no se supuso).
-- `audit.insert_update_delete_trigger()` NO se toca: llama a los dos resolvers POR NOMBRE y
-- `CREATE OR REPLACE` conserva el oid → toma los cuerpos nuevos solo. Re-crearlo sería riesgo gratis.
--
-- ── LOS DOS INVARIANTES QUE NO SE PUEDEN PERDER ──────────────────────────────────────────────────────
--   TOTAL      — ninguna de las dos funciones puede LANZAR. Corren dentro del trigger de audit; si tiran,
--                abortan el write del operario y rompen el invariante offline-first. Los handlers
--                `exception when others` quedan EXACTAMENTE como estaban.
--   SPOOF-SAFE — el header se lee SÓLO dentro del `if v_role = 'service_role'`. El fallback al nombre
--                viejo vive DENTRO de ese gate: no abre ningún canal nuevo. Un `authenticated` que forje
--                cualquiera de los dos nombres sigue siendo ignorado.
--
-- PRECEDENCIA: gana el nombre NUEVO. Se cae al viejo si el nuevo **falta o no tiene forma de uuid** — así
-- un header nuevo con basura no puede tapar un header viejo válido (no se pierde correlación por eso).

begin;

-- ── 1. resolve_actor() — 0124 + doble lectura de header (R2.6/R2.8 de spec 18) ────────────────────────
create or replace function audit.resolve_actor ()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  c_uuid  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_role  text;
  v_hdrs  jsonb;
  v_hdr   text;
  v_actor uuid;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    if v_role = 'service_role' then
      -- PostgREST expone request.headers con las claves en minúscula.
      v_hdrs := nullif(current_setting('request.headers', true), '')::jsonb;
      -- Rebrand fase 5: nombre NUEVO primero; el VIEJO sólo si el nuevo falta o no es un uuid (así una
      -- basura en el header nuevo no tapa un header viejo válido de una build sin actualizar).
      v_hdr := v_hdrs ->> 'x-mitropero-actor';
      if v_hdr is null or v_hdr !~ c_uuid then
        v_hdr := v_hdrs ->> 'x-rafaq-actor';
      end if;
      if v_hdr ~ c_uuid then
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

-- ── 2. resolve_request_id() — 0131 + doble lectura de header (R3.3–R3.6 de spec 23) ───────────────────
create or replace function audit.resolve_request_id ()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_role text;
  v_hdrs jsonb;
  v_hdr  text;
  v_rid  uuid;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    if v_role = 'service_role' then
      -- PostgREST expone request.headers con las claves en minúscula.
      v_hdrs := nullif(current_setting('request.headers', true), '')::jsonb;
      -- Rebrand fase 5: mismo criterio que resolve_actor (nuevo, y viejo como fallback).
      v_hdr := v_hdrs ->> 'x-mitropero-request-id';
      if v_hdr is null or v_hdr !~ c_uuid then
        v_hdr := v_hdrs ->> 'x-rafaq-request-id';
      end if;
      if v_hdr ~ c_uuid then
        v_rid := v_hdr::uuid;
      end if;
    end if;
    return v_rid;   -- header ausente / basura / write con JWT de usuario → NULL honesto
  exception when others then
    return null;    -- cualquier fallo de parse (claim/header no-JSON, cast) → NULL, jamás bloquea el write
  end;
end; $$;

-- ── 3. Fail-closed: los REVOKE sobreviven a CREATE OR REPLACE, pero se re-afirman (barato, explícito) ──
revoke execute on function audit.resolve_actor()      from public, anon, authenticated;
revoke execute on function audit.resolve_request_id() from public, anon, authenticated;

-- ── 4. FALSIFICACIÓN IN-MIGRATION del doble-lectura ───────────────────────────────────────────────────
-- Ejerce las dos funciones con `request.jwt.claims` / `request.headers` seteados transaction-local (el
-- mismo canal que usa PostgREST) y ABORTA la migración si alguna combinación no da lo esperado. Sin esto,
-- "el servidor ahora lee los dos" sería una afirmación sobre el texto de la función, no sobre su conducta.
do $$
declare
  c_new  constant uuid := '11111111-1111-4111-8111-111111111111';
  c_old  constant uuid := '22222222-2222-4222-8222-222222222222';
  c_sub  constant uuid := '33333333-3333-4333-8333-333333333333';
  v_a    uuid;
  v_r    uuid;
begin
  -- (a) SÓLO el nombre NUEVO → se resuelve.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.headers',
    format('{"x-mitropero-actor":"%s","x-mitropero-request-id":"%s"}', c_new, c_new), true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is distinct from c_new or v_r is distinct from c_new then
    raise exception 'fase 5 (a): el header NUEVO no se resuelve (actor=%, request_id=%)', v_a, v_r;
  end if;

  -- (b) SÓLO el nombre VIEJO → se resuelve IGUAL. Es LA propiedad del rename en dos tiempos: sin esto,
  --     toda build instalada sin OTA entraría al audit con actor/request_id NULL, en silencio.
  perform set_config('request.headers',
    format('{"x-rafaq-actor":"%s","x-rafaq-request-id":"%s"}', c_old, c_old), true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is distinct from c_old or v_r is distinct from c_old then
    raise exception 'fase 5 (b): el header VIEJO dejó de resolverse (actor=%, request_id=%) — se pierde '
      'la correlación de los clientes ya instalados', v_a, v_r;
  end if;

  -- (c) LOS DOS presentes → gana el NUEVO (precedencia determinista, no "el que salga").
  perform set_config('request.headers', format(
    '{"x-mitropero-actor":"%s","x-rafaq-actor":"%s","x-mitropero-request-id":"%s","x-rafaq-request-id":"%s"}',
    c_new, c_old, c_new, c_old), true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is distinct from c_new or v_r is distinct from c_new then
    raise exception 'fase 5 (c): con los dos headers no gana el NUEVO (actor=%, request_id=%)', v_a, v_r;
  end if;

  -- (d) NUEVO con basura + VIEJO válido → gana el VIEJO (una basura no puede tapar correlación buena).
  perform set_config('request.headers', format(
    '{"x-mitropero-actor":"no-soy-un-uuid","x-rafaq-actor":"%s",'
    '"x-mitropero-request-id":"no-soy-un-uuid","x-rafaq-request-id":"%s"}', c_old, c_old), true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is distinct from c_old or v_r is distinct from c_old then
    raise exception 'fase 5 (d): un header nuevo inválido tapó al viejo válido (actor=%, request_id=%)', v_a, v_r;
  end if;

  -- (e) SIN headers propios → NULL honesto (y actor cae a auth.uid(), que acá no existe).
  perform set_config('request.headers', '{"content-type":"application/json"}', true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is not null or v_r is not null then
    raise exception 'fase 5 (e): sin header propio tendría que dar NULL (actor=%, request_id=%)', v_a, v_r;
  end if;

  -- (f) ANTI-SPOOF, las dos grafías: rol NO service_role con los headers forjados → se IGNORAN los dos.
  --     El actor cae a auth.uid() (el `sub` del JWT), jamás al header; el request_id queda NULL.
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', c_sub), true);
  perform set_config('request.headers', format(
    '{"x-mitropero-actor":"%s","x-rafaq-actor":"%s","x-mitropero-request-id":"%s","x-rafaq-request-id":"%s"}',
    c_new, c_old, c_new, c_old), true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is distinct from c_sub then
    raise exception 'fase 5 (f): SPOOF — un authenticated con el header forjado resolvió actor=% (tendría '
      'que ser su sub=%)', v_a, c_sub;
  end if;
  if v_r is not null then
    raise exception 'fase 5 (f): SPOOF — un authenticated inyectó request_id=%', v_r;
  end if;

  -- (g) TOTAL: claims y headers que NO son JSON no pueden LANZAR (si lanzaran, abortarían el write del
  --     operario). Se ejercen las dos puntas de parse por separado.
  perform set_config('request.jwt.claims', 'no-soy-json', true);
  perform set_config('request.headers', 'tampoco-soy-json', true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is not null or v_r is not null then
    raise exception 'fase 5 (g): con GUCs corruptas tendría que dar NULL (actor=%, request_id=%)', v_a, v_r;
  end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.headers', 'tampoco-soy-json', true);
  v_a := audit.resolve_actor(); v_r := audit.resolve_request_id();
  if v_a is not null or v_r is not null then
    raise exception 'fase 5 (g2): headers corruptos bajo service_role tendrían que dar NULL (actor=%, '
      'request_id=%)', v_a, v_r;
  end if;

  -- Dejar las GUCs como estaban (transaction-local, pero no ensuciamos lo que sigue en esta txn).
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  raise notice 'fase 5 OK: los dos nombres de header se resuelven, gana el nuevo, spoof cerrado, TOTAL intacto';
end$$;

-- ── 5. Smoke-check del muro (patrón 0124/0131): fail-closed + lectura cerrada ──────────────────────────
do $$
begin
  if has_function_privilege('anon',          'audit.resolve_actor()', 'EXECUTE')
     or has_function_privilege('authenticated','audit.resolve_actor()', 'EXECUTE')
     or has_function_privilege('public',       'audit.resolve_actor()', 'EXECUTE')
     or has_function_privilege('anon',          'audit.resolve_request_id()', 'EXECUTE')
     or has_function_privilege('authenticated','audit.resolve_request_id()', 'EXECUTE')
     or has_function_privilege('public',       'audit.resolve_request_id()', 'EXECUTE') then
    raise exception 'grant check FAILED: un resolver de audit quedó EXECUTE-able por un rol cliente';
  end if;
  if has_schema_privilege('anon','audit','USAGE')
     or has_schema_privilege('authenticated','audit','USAGE')
     or has_table_privilege('anon','audit.record_version','SELECT')
     or has_table_privilege('authenticated','audit.record_version','SELECT') then
    raise exception 'audit read-wall FAILED: anon/authenticated tienen USAGE/SELECT sobre audit';
  end if;
  raise notice 'audit header rename OK: resolvers cerrados a cliente + muro de lectura intacto';
end$$;

commit;
