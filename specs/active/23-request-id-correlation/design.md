# Design — 23 · request_id / operationId end-to-end

> Cómo se construye. Fuente: `context.md` + `requirements.md`. Todo aditivo; no rompe writes existentes ni el
> platform-split de observabilidad.

## Panorama

Una acción de usuario nace con un `requestId` (uuid v4) que viaja por las fronteras REALES:

```
cliente (genera requestId)
  │  header X-Mitropero-Request-Id
  ▼
Edge Function  ── wrapper serveEf ──▶ console.log ENTRADA/SALIDA (JSON, sin body) → logs de EF
  │  createAdminClient(actor, requestId) → header global X-Mitropero-Request-Id
  ▼
PostgREST → GUC request.headers → audit.resolve_request_id() (solo service_role)
  ▼
audit.record_version.request_id  (hoy: writes de user_roles)

cliente (misma acción)
  ├─▶ Sentry: tag request_id
  └─▶ PostHog: prop request_id

UI (cuando algo sale mal): "Código de soporte: XXXX" + Copiar
  ├─ crash  → requestId generado en componentDidCatch (taggeado en Sentry)
  └─ rechazo de manga → id de la op (ya en UploadRejection; agregado al evento upload_rejected de Sentry)
```

Lo que NO entra (diferido, ver context.md §"lo que NO"): correlación server/DB de un write que sube por
PowerSync (async + batch → el id tendría que ir persistido en el payload; además audit no trackea eventos
hasta T12). La columna se agrega igual desde ahora para dejar el terreno listo.

---

## Archivos

### Crear

- `supabase/functions/_shared/serve.ts` — wrapper `serveEf(fn, handler)` (US2). Solo el I/O: `Deno.serve` /
  `handleOptions` / resolución del requestId entrante / backstop `serverError`.
- `supabase/functions/_shared/serve-log.ts` — lógica PURA de construcción de los logs `ef_in`/`ef_out`
  (`readSubBestEffort`, `buildEfIn`, `buildEfOut`), SIN deps Deno-only (solo globals web: Request/Response/
  atob/JSON). Extraída de `serve.ts` para poder FALSIFICAR el invariante de no-leak R2.8/R2.9 bajo `node:test`
  (`serve-log.test.ts`) sin Deno — es la MISMA función que consume `serve.ts` en producción, no un espejo.
- `supabase/migrations/0131_audit_request_id.sql` — columna + `resolve_request_id()` + re-CREATE del trigger
  (US3). **Deploy GATEADO** (no se aplica desde acá).
- `app/src/utils/request-id.ts` — `newRequestId()` (US1).

### Modificar

- `supabase/functions/_shared/supabase.ts` — `createAdminClient(actorId?, requestId?)` aditivo (R2.12).
- `supabase/functions/_shared/cors.ts` — agregar `x-mitropero-request-id` a `Access-Control-Allow-Headers` (R2.13).
- Las 9 EFs (`invite_user`, `accept_invitation`, `change_member_role`, `remove_member`, `cancel_invitation`,
  `resend_invitation`, `delete_account`, `register_push_token`, `health`) — migran a `serveEf` (R2.10) y las 3
  que escriben `user_roles` pasan `ctx.requestId` a `createAdminClient` (R3.10).
- `app/src/services/members.ts` (`invokeFn`), `app/src/services/account.ts` (`deleteAccount`),
  `app/src/services/push-notifications.ts` (`registerPushTokenBestEffort`) — agregan el header + tag/prop
  (R1.4, R4.1, R4.2).
- `app/src/services/observability/payloads.ts` — extiende `buildUploadRejectedPayload` para incluir `id`
  (R5.6); constante `REQUEST_ID_TAG = 'request_id'` y builder puro `buildCaptureTags({ mechanism, requestId })`
  → tags por-captura de `captureException` (R4.1/R4.3/R4.4), testeado en `payloads.test.ts`.
- `app/src/services/observability/sentry.native.ts` — acepta el `requestId` para el tag en las acciones de EF
  y en el crash (R4.1, R5.2); pasa `id` a `captureUploadRejected` (R5.6).
- `app/src/services/observability/posthog.native.tsx` — `captureDomainEvent` recibe el `request_id` como prop
  (R4.2).
- `app/app/_components/RootErrorBoundary.tsx` — genera requestId en `componentDidCatch`, lo tagea, lo pasa al
  fallback; el fallback muestra "Código de soporte" + Copiar (R5.1–R5.4, R5.8, R5.10).
- `app/app/maniobra/_components/SyncRechazoSheet.tsx` — muestra "Código de soporte" (el `id`) + Copiar por fila
  (R5.7, R5.8, R5.10).
- `app/src/services/powersync/upload-rejections.ts` — el connector ya registra el `id`; se extiende el sink de
  Sentry con `id` (R5.6). El store NO cambia de shape (ya tiene `id`).

> Nota: la base web/no-op de observabilidad (`sentry.ts`, `posthog.tsx`) mantiene el platform-split: recibe
> los mismos parámetros nuevos pero sigue sin importar SDK ni enviar nada (R6.3).

---

## US3 — Migración 0131 (SQL completo, moldeado sobre 0124)

**Base del re-CREATE = 0124** (regla `reference_function_recreate_base`). VERIFICADO 2026-08-14 por grep sobre
`supabase/migrations/`: ninguna migración 0125–0130 redefine `audit.resolve_actor` ni
`audit.insert_update_delete_trigger`; el único match fuera de 0124 es `0127` y es solo un comentario que
menciona `audit.record_version`. La última migración del ledger es `0130` → esta es `0131`.

**Anti-spoof (idéntico a actor):** `resolve_request_id()` confía el header SOLO si
`request.jwt.claims->>'role' = 'service_role'`. Un write directo con JWT de usuario (RPC/PowerSync) NO puede
inyectar `request_id` → NULL. Como las tablas auditadas hoy (`user_roles`) se escriben SOLO por EFs
(service_role), el id del cliente llega bien vía el admin client y un cliente no puede ensuciar el audit con
ids falsos.

```sql
-- 0131_audit_request_id.sql — Correlación request_id end-to-end (spec 23). ADITIVA sobre 0124 (spec 18).
--
-- ⚠️ NO aplicar desde acá: DEPLOY GATEADO (Raf/leader) tras Puerta 1 + Gate 1. Re-CREA
--    insert_update_delete_trigger → re-correr TODAS las suites que tocan audit (spec 18 / user_roles).
--
-- QUÉ AGREGA (todo aditivo — no rompe ningún write existente):
--   1. Columna audit.record_version.request_id uuid NULLABLE + índice parcial (where request_id is not null).
--   2. Función audit.resolve_request_id() ANÁLOGA a resolve_actor(): lee request.headers->>'x-mitropero-request-id'
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
-- ⚠️ AS-BUILT (rebrand fase 5, 2026-08-17, migración 0133): el cuerpo VIGENTE lee los DOS nombres de
--    header. El de abajo es el as-built literal; la versión original de 0131 leía sólo 'x-rafaq-request-id'
--    (0131 no se editó: append-only).
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
      -- Rename en DOS TIEMPOS: gana el NUEVO; se cae al VIEJO si el nuevo falta o no es un uuid.
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
```

**Por qué no toca RLS de tenant:** `audit.record_version` es una tabla forense cross-tenant sin
`establishment_id` (spec 18); su aislamiento es por el muro de USAGE/SELECT (fail-closed), no por RLS. Esta
migración lo preserva, no lo cambia.

---

## US2 — Wrapper `serveEf` (contrato)

Archivo `supabase/functions/_shared/serve.ts`. Envuelve `Deno.serve`, resuelve el requestId, loguea
entrada/salida y expone el requestId al handler por contexto.

```ts
// Firma (contrato, no implementación literal):
export type EfContext = { requestId: string };
export type EfHandler = (req: Request, ctx: EfContext) => Promise<Response> | Response;

export function serveEf(fn: string, handler: EfHandler): void;
```

Comportamiento:

1. **requestId (R2.2/R2.3/R2.4).** `const incoming = readRequestIdHeader(req);` → si matchea la
   regex de uuid v4, se usa; si no (ausente o basura), `crypto.randomUUID()` server-side (Deno lo tiene
   nativo). El valor resuelto es el que se loguea, se pasa al handler, y (vía el handler) al admin client.
   **[AS-BUILT rebrand fase 5]** era `req.headers.get('X-Rafaq-Request-Id')`. Hoy la lectura pasa por
   `readRequestIdHeader` de `_shared/request-headers.ts`, que acepta `X-Mitropero-Request-Id` y, si no vino,
   `X-Rafaq-Request-Id` (hay builds instaladas sin OTA). La validación de forma no cambió.
2. **ENTRADA (R2.6).** `console.log(JSON.stringify({ evt: 'ef_in', fn, requestId, bodyBytes, actor }))`.
   - `bodyBytes` = `Number(req.headers.get('content-length')) || null` — **NO se lee el body** (evita
     consumirlo antes del handler y evita cualquier riesgo de leak; R2.8).
   - `actor` = best-effort: `sub` del payload del JWT del header `Authorization` (base64-decode del segmento
     de payload, **sin verificar firma**), envuelto en try/catch → se omite ante cualquier fallo. Es solo
     etiqueta de traza; el actor **autoritativo y anti-spoof** es `audit.auth_uid` (validado por
     `requireUser`). **Nunca** se loguea el token ni el header Authorization (R2.9).
3. **Handler.** `const res = await handler(req, { requestId })`. Un throw no capturado por el handler cae a un
   backstop `serverError('unexpected', err)` para que la SALIDA siempre se emita.
4. **SALIDA (R2.7).** `console.log(JSON.stringify({ evt: 'ef_out', fn, requestId, status, code, ms }))`.
   - `ms` = `Date.now() - start`.
   - `code` = solo si `status >= 400`: `res.clone().json()` best-effort → se extrae **únicamente**
     `body.error.code` (string). Nunca se loguea `message` ni el body. En 2xx no se clona ni se parsea nada.
5. **Preflight/method.** El wrapper deja el manejo de OPTIONS y method a los helpers existentes
   (`handleOptions`) DENTRO del handler, o el wrapper corre `handleOptions` primero y solo loguea las
   llamadas no-preflight. **Default elegido:** el wrapper corre `handleOptions(req)` antes de loguear/medir y
   retorna el 204 sin emitir líneas (un preflight no es una acción). Ver §decisiones.

Migración de una EF (ejemplo, `change_member_role`), preservando el contrato (R2.11):

```ts
serveEf('change_member_role', async (req, ctx) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed', 'Solo POST.');
  const userClient = createUserClient(req);
  const user = await requireUser(userClient);
  const adminClient = createAdminClient(user.id, ctx.requestId);   // ← actor + requestId al header global
  // ...resto idéntico...
});
```

Las EFs que **no** escriben tablas auditadas (`invite_user`, `cancel_invitation`, `resend_invitation`,
`register_push_token`, `health`) igual migran al wrapper (uniformidad + logging), pero su `createAdminClient`
puede recibir el `requestId` sin efecto sobre audit (no hay tabla auditada) — es barato y deja la traza en los
logs. `invite_user`/`cancel`/`resend`/`register` hoy llaman `createAdminClient()` sin actor; se les puede
pasar `createAdminClient(undefined, ctx.requestId)` para no perder el header en sus writes futuros. `health`
es input-free y sin user → solo logging.

### `createAdminClient(actorId?, requestId?)` (R2.12, aditivo)

```ts
export function createAdminClient(actorId?: string, requestId?: string): SupabaseClient {
  // ...url/serviceRoleKey igual...
  const headers: Record<string, string> = {};
  // [AS-BUILT rebrand fase 5] los nombres salen de `_shared/request-headers.ts` (ACTOR_HEADER /
  // REQUEST_ID_HEADER), no de literales: el admin client ESCRIBE sólo la grafía nueva.
  if (actorId)   headers[ACTOR_HEADER] = actorId;
  if (requestId) headers[REQUEST_ID_HEADER] = requestId;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(Object.keys(headers).length ? { global: { headers } } : {}),
  });
}
```

Sin `requestId` (ni `actorId`) el shape es idéntico al actual → sin regresión.

### CORS (R2.13)

`_shared/cors.ts` → `Access-Control-Allow-Headers` pasa a incluir el header de correlación:

```
'authorization, x-client-info, apikey, content-type, x-mitropero-request-id, x-rafaq-request-id'
```

Sin esto el preflight del navegador (web / E2E Playwright) rechazaría la llamada con el header nuevo. En
nativo no hay CORS, pero E2E corre en web → es necesario.

> **[AS-BUILT rebrand fase 5, 2026-08-17]** La lista **ya no se escribe a mano**: `cors.ts` la **DERIVA**
> de `ACCEPTED_REQUEST_ID_HEADERS` (`_shared/request-headers.ts`), que es la misma lista que recorre
> `readRequestIdHeader`. Motivo: el modo de falla de esta sección es exactamente que el preflight y el
> lector se desalineen —un header que la EF lee pero el navegador no puede mandar—, y en nativo no hay
> preflight así que sólo se ve en web. Derivándola, las dos puntas se mueven juntas o ninguna, y
> `request-headers.test.ts` lo verifica recorriendo la lista (no una enumeración a mano). Los headers de
> ACTOR **no** están en la lista a propósito: no vienen del caller, los mintea la EF.
> El string de arriba es el valor real que devuelve hoy el preflight de DEV (verificado con `curl -X OPTIONS`).

> **Deploy-ordering (VERIFICADO por experimento E2E 2026-08-15).** El frontend (que manda el header) y el
> backend (CORS + funciones) deben deployarse **juntos, o el backend primero**. Si el OTA del frontend sale
> antes que las funciones redeployadas, todo flujo EF-invoke se rompe **en web** (el preflight del browser
> bloquea el header que el CORS viejo no permite) — probado: con el header OFF, las 5 specs EF que fallaban
> pasan 7/7. En **nativo no hay CORS** → el beta (nativo) no se ve afectado por el skew, pero la suite E2E
> (web) sí. Post-deploy de las funciones con este `cors.ts`, la suite vuelve a verde.

---

## US1 — `newRequestId()` (cliente)

`app/src/utils/request-id.ts`:

```ts
/** requestId de correlación: uuid v4 random, sin significado (no-PII). */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
```

**Fuente del uuid (decisión, no "dejada abierta"):** se reusa `globalThis.crypto.randomUUID()`, la convención
YA establecida del repo (`app/src/services/animals.ts:1847`, `treatments.ts:265`) y ya polyfilleada para RN en
`app/polyfills.ts` (asigna `crypto.randomUUID` desde `expo-crypto` cuando Hermes no lo trae). No hace falta
dependencia nueva ni decidir fuente en implementación. Si por algún target `crypto.randomUUID` no existiera, el
polyfill ya cubre el fallback — no lo re-implementamos acá.

Call-sites (R1.4): en cada uno se genera `const requestId = newRequestId()` al inicio de la acción y se pasa
en dos lugares: (a) header de la EF, (b) tag/prop de observabilidad.

- `members.ts` `invokeFn` → `supabase.functions.invoke(name, { body, headers: { 'X-Mitropero-Request-Id': requestId } })`
  (supabase-js v2 acepta `{ body, headers }`).
- `account.ts` `deleteAccount` → idem con `body: {}`.
- `push-notifications.ts` `registerPushTokenBestEffort` → idem.

---

## US4 — Observabilidad cliente (tag/prop)

- **Sentry (R4.1/R4.4):** el tag `request_id` se adjunta **por captura** (scope acotado), NO con un `setTag`
  global persistente que se filtraría a otras acciones. Para las acciones de EF, el call-site que reporta un
  error de esa acción pasa el `requestId`; `captureExceptionSafe`/`captureMessage` lo incluyen en `tags`
  junto a lo existente. As-built: `captureExceptionSafe(error, { mechanism, requestId })` arma el `tags` de esa
  captura con el builder PURO `buildCaptureTags(hint)` de `payloads.ts` (mechanism + `request_id`, omitiendo las
  claves ausentes) y lo pasa como el `{ tags }` de esa llamada a `Sentry.captureException` — NUNCA `setTag`
  global. Al ser un builder sin estado, cada captura es un objeto fresco → una captura sin `requestId` no hereda
  el de otra (R4.4). El builder se testea en `payloads.test.ts` (misma función que producción, no un espejo).
- **PostHog (R4.2):** `captureDomainEvent(name, { ...props, request_id })`. El call-site del evento de dominio
  (p.ej. `invitacion_enviada`) agrega `request_id` a sus props.
- **Builders (R4.3):** en `payloads.ts` se centraliza la clave (`REQUEST_ID_TAG = 'request_id'`) y, donde hay
  builder puro, se extiende para incluir `request_id` como string. Sin PII (el requestId es uuid sin
  significado, D1). El scrubber `beforeSend`/`redact` sigue siendo el segundo cerrojo.

---

## US5 — Superficie UI "código de soporte"

Presentación unificada (R5.8): un componente chico reusable, p.ej. `SupportCodeRow`, que renderiza
`"Código de soporte:"` + el valor + una afordancia **Copiar**. es-AR, manga-friendly (target ≥ `$touchMin`,
tap directo en la pieza Tamagui — no `Pressable` de RN envolviendo un Tamagui con `pressStyle`, regla del
repo). `lineHeight` matcheando `fontSize` en todo texto (R5.10; el título del fallback "Algo salió mal" ya lo
hace en `RootErrorBoundaryFallback`).

**Copiar (R5.4/R5.7/R5.9):** usa `expo-clipboard` (`setStringAsync`) si está disponible; envuelto en
try/catch → best-effort, nunca rompe, y el código queda visible para leerse a mano si el clipboard falla.
Verificar si `expo-clipboard` ya es dependencia; si no lo es, la afordancia degrada a "seleccionable/visible"
sin agregar dep — **default:** usar `expo-clipboard` si ya está en el árbol, si no dejar el código visible +
copiable por selección larga (decisión menor, ver §decisiones).

### Fallback de crash (`RootErrorBoundary`)

- `componentDidCatch(error)` genera `const requestId = newRequestId()` (R5.1), lo guarda en `state`
  (`{ hasError: true, requestId }`) y llama
  `captureExceptionSafe(error, { mechanism: 'RootErrorBoundary', requestId })` (R5.2).
- `RootErrorBoundaryFallback` recibe `supportCode={requestId}` y renderiza `SupportCodeRow` bajo el copy
  existente (R5.3). El `requestId` mostrado correlaciona con el tag de Sentry aunque no haya fila de audit (un
  crash de render no escribe DB).
- Web/E2E: `captureExceptionSafe` ya es no-op por el platform-split (R6.1/R6.3). El fallback igual muestra el
  código (es UI pura), lo cual es correcto: el código es útil aun sin envío (el usuario lo lee/dicta).

### Surfacing de rechazo de manga (`SyncRechazoSheet`)

- El store `UploadRejection` YA tiene `id` (id de la op = id de la fila local). Se REUSA como código de
  soporte (R5.5) — **no** se agrega un mapa persistente requestId↔op ni se toca el payload de PowerSync.
- `RechazoRow` agrega `SupportCodeRow` con `supportCode={rejection.id}` (R5.7). Presentación idéntica a la del
  crash (R5.8).
- Findability en Sentry (R5.6): `buildUploadRejectedPayload(op, error)` se extiende para incluir `id` (además
  de `table`/`op`/`code`) — sigue SIN `opData` ni PII. Así el código que ve el operario (`rejection.id`) es
  el mismo que figura en el evento `upload_rejected` de Sentry → soporte lo busca por ese id.
  - Riesgo de PII del `id`: es el id de fila local (uuid de cliente, `crypto.randomUUID`), sin significado →
    no-PII, consistente con D1. `opData` sigue explícitamente excluido.

**Gate 2.5 (capturas):** el fallback de crash con el código + Copiar, y el `SyncRechazoSheet` con el código +
Copiar. Vetar con un título con descendentes ("Algo salió mal" / "…no se sincronizaron") y con los básicos de
UX de manga (título no se recorta, sheet header-fijo/body-scroll/footer-fijo, targets grandes).

---

## Alternativas descartadas

1. **Persistir un mapa global requestId→op (o requestId por cada write de PowerSync).** Descartada:
   over-engineering para el alcance de esta feature. Un write que sube por PowerSync es async/batch — el
   header por-acción no puede viajar con él; el id tendría que ir **persistido en el payload**, y el audit no
   trackea eventos hasta T12 (context.md §"lo que NO"). En vez de eso, para el surfacing de rechazo se reusa
   el `id` de la op que YA está en `UploadRejection` como código de soporte, y se lo hace findable en Sentry.
   Cero estado nuevo.
2. **Actor en la línea de ENTRADA vía JWT validado (requireUser) en el wrapper.** Descartada: obligaría al
   wrapper a validar el JWT contra Auth (llamada de red) antes del handler, duplicando trabajo y acoplándolo a
   la lógica de auth de cada EF. Se elige el `sub` **sin verificar firma** solo para la etiqueta de log
   (best-effort, omitible), dejando el actor autoritativo/anti-spoof donde ya vive: `audit.auth_uid`
   (validado). Alternativa intermedia (que el handler llame `ctx.setActor(user.id)` y el actor vaya en la
   SALIDA) queda documentada como opción, no elegida, por requerir cooperación por-handler.
3. **`setTag('request_id')` global en Sentry al inicio de cada acción.** Descartada: se filtraría a eventos
   de acciones posteriores/concurrentes (el scope global es sticky). Se usa scope por-captura (R4.4).
4. **Columna `request_id NOT NULL` con default/valor sintético.** Descartada: la mayoría de los writes no
   traen requestId (JWT de usuario / PowerSync) → un NOT NULL forzaría un valor mentiroso. NULLABLE = NULL
   honesto, igual que `auth_uid` (D4).

---

## Decisiones (resolución de ambigüedades del context.md)

- **D-A (actor en el log).** El context lista `actor` en la línea de ENTRADA, pero el actor validado recién se
  conoce tras `requireUser` (dentro del handler). Resuelto: la ENTRADA loguea el `sub` del JWT **sin verificar
  firma** como etiqueta best-effort (omitible), y el actor autoritativo queda en `audit.auth_uid`. Nunca se
  loguea el token/Authorization (R2.9).
- **D-B (tamaño de body).** `bodyBytes` = `content-length` del request; el wrapper **no lee el body** (no lo
  consume ni lo bufferea). Si no hay `content-length` (chunked), `bodyBytes = null`.
- **D-C (code de salida).** Solo se extrae `error.code` de respuestas `status >= 400` vía `res.clone().json()`
  best-effort; en 2xx no se parsea nada. Nunca se loguea `message` ni el body.
- **D-D (preflight).** El wrapper resuelve `handleOptions` antes de medir/loguear y no emite líneas para un
  OPTIONS (un preflight no es una acción de usuario).
- **D-E (clipboard).** Copiar usa `expo-clipboard` si ya es dependencia del árbol; si no lo es, el código queda
  visible + seleccionable sin agregar dep. Decisión menor, confirmable en Puerta 2.
- **D-F (entrada de diagnóstico en Ajustes con últimos N ids).** El context la marca "opcional (a decidir en
  design)". Resuelto: **fuera de alcance** de esta feature (evita estado nuevo); las dos superficies núcleo
  (crash + rechazo de manga) cubren el caso de campo. Se puede retomar como delta si aparece la necesidad.

---

## Notas para el Gate 1 (security_analyzer modo spec)

Puntos que un auditor debería mirar, con la postura tomada:

1. **Anti-spoof del header nuevo cross-frontera.** `resolve_request_id()` confía el header SOLO bajo
   `service_role` (GUC `request.jwt.claims`, no `current_user` → correcto bajo SECURITY DEFINER). Un write con
   JWT de usuario/PowerSync NO inyecta `request_id`. Idéntico al modelo de `resolve_actor` ya auditado (0124).
2. **Fail-closed / TOTAL.** `resolve_request_id()` nunca lanza (D6): valida la forma de uuid antes del cast y
   envuelve todo en un `exception when others → null`. No puede trabar el write en el hot path. El trigger en
   best_effort mantiene el guard airtight de 0124.
3. **No-leak en el logging.** El wrapper **no** loguea el body (solo `content-length`), **no** loguea el
   header `Authorization` ni el JWT crudo, y en la salida solo extrae `error.code` (nunca `message`/body). El
   `sub` del JWT que loguea es una etiqueta best-effort sin verificar, y es un uuid, no PII sensible.
4. **No-PII en tags/props y en el payload de rechazo.** El `requestId` y el `rejection.id` son uuids sin
   significado (D1). `buildUploadRejectedPayload` se extiende con `id` pero sigue excluyendo `opData` y
   cualquier otro campo del CrudEntry — el test de forma de `payloads.test.ts` lo mantiene honesto.
5. **Migración aditiva fail-closed.** Columna NULLABLE (no rompe writes), revoke EXECUTE de la función nueva +
   smoke-check que aborta si quedó EXECUTE-able por cliente o si el muro de lectura se abrió. Preserva grants
   y patrón de 0124.
6. **CORS.** Se agrega `x-mitropero-request-id` a los headers permitidos; es un header propio de correlación, no
   una credencial — no amplía superficie de auth.
