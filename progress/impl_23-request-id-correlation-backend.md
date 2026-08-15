# impl 23 · request_id / operationId end-to-end — SLICE BACKEND (supabase/**)

> Slice de backend de la feature 23. El frontend (`app/**`) va en otro archivo. Implementado por el leader
> en chunks chicos (5 corridas de implementer murieron/stallaron por infra de agentes; se partió la tarea en
> chunks para esquivar el stall del stream de inferencia; ver progress general).

## Entregado

- **`supabase/migrations/0131_audit_request_id.sql`** (NUEVO) — aditiva sobre 0124: columna
  `audit.record_version.request_id uuid` NULLABLE + índice parcial `where request_id is not null`;
  `audit.resolve_request_id()` (análoga a `resolve_actor`: lee `request.headers->>'x-rafaq-request-id'` del
  GUC SOLO bajo `service_role`, valida regex uuid antes del cast, TOTAL `exception when others → null`);
  re-CREATE de `audit.insert_update_delete_trigger` sumando `request_id` (`resolve_request_id()`) al INSERT en
  AMBOS modos (best_effort/strict), moldeado sobre 0124; revoke EXECUTE de la función nueva + smoke-check
  doble (EXECUTE + muro de lectura + columna NULLABLE). **NO aplicada** (deploy GATEADO — pendiente OK de Raf).
  El leader limpió un `</content>` de basura que dejó el agente muerto.
- **`supabase/functions/_shared/serve.ts`** (NUEVO) — wrapper `serveEf(fn, handler)`: preflight `handleOptions`
  primero (204 sin loguear), resuelve requestId (header `X-Rafaq-Request-Id` validado por regex uuid, o
  `crypto.randomUUID()` server-side), loguea `ef_in`/`ef_out` en JSON (`bodyBytes` de content-length — NO lee
  el body; `actor` = `sub` del JWT sin verificar firma, try/catch → omitible; SALIDA `code` solo de
  `status>=400` vía `res.clone().json()` → SOLO `error.code`, nunca message/body; NUNCA token/Authorization),
  backstop `serverError('unexpected', err)`.
- **`supabase/functions/_shared/serve-log.ts`** (NUEVO, fix-loop reviewer) — módulo PURO extraído de `serve.ts`
  (solo globals web: Request/Response/atob/JSON, SIN deps Deno-only): `readSubBestEffort` + `buildEfIn` +
  `buildEfOut` (construcción de los objetos `ef_in`/`ef_out`). `serve.ts` ahora importa las 3 y mantiene el
  `Deno.serve`/`handleOptions`/resolución del requestId/backstop (comportamiento observable idéntico).
- **`supabase/functions/_shared/serve-log.test.ts`** (NUEVO, fix-loop reviewer) — guard EJECUTABLE del no-leak
  R2.8/R2.9 en `node:test` (7 tests): `buildEfIn` con `Authorization: Bearer <jwt sub='u1' + claim secreto>` +
  content-length → objeto con `actor='u1'` y `bodyBytes` number, y su `JSON.stringify` NO contiene el token/JWT
  /claim/`Authorization`/`Bearer`; `buildEfOut` 4xx `{error:{code,message}}` → incluye `code` y NO `message`/body
  (usa `res.clone()`, no consume el stream); 2xx no parsea (espía sobre `clone()` verifica que no se llama);
  4xx body no-JSON → code undefined sin lanzar; `readSubBestEffort` ausente/basura → undefined. Falsificación:
  mutante que agrega `authorization: req.headers.get('Authorization')` a `buildEfIn` → 1 fail (el test de no-leak)
  → revertido → 7/7 verde. **El harness de node SÍ importa el `.ts` de `supabase/functions/**`** (type-stripping
  nativo Node 24 + ts-ext-resolver; el módulo es puro, sin imports). Registrado en `scripts/run-tests.mjs` como
  bloque propio `serve-log no-leak guard (spec 23)` — fuera del gate de `SUPABASE_SERVICE_ROLE_KEY` (no toca red).
- **`supabase/functions/_shared/supabase.ts`** (MOD) — `createAdminClient(actorId?, requestId?)` aditivo:
  setea `X-Rafaq-Actor` y/o `X-Rafaq-Request-Id` en el header global si vienen; sin ninguno, shape idéntico al
  anterior (sin regresión).
- **`supabase/functions/_shared/cors.ts`** (MOD) — `x-rafaq-request-id` agregado a `Access-Control-Allow-Headers`.
- **Las 9 EFs migradas a `serveEf`** (`invite_user, accept_invitation, change_member_role, remove_member,
  cancel_invitation, resend_invitation, delete_account, register_push_token, health`): `Deno.serve` →
  `serveEf('<nombre>', (req, ctx) => …)`, `handleOptions` interno borrado (lo hace el wrapper), method-guard /
  `requireUser` / validaciones / respuestas / try/catch preservados. `createAdminClient` con `ctx.requestId`:
  `user.id + requestId` en las 4 que escriben como usuario (accept_invitation, change_member_role,
  remove_member, delete_account), `undefined + requestId` en invite/cancel/resend/register, `health` intacta.

## Verificación

- Estructural (leader, grep): 9/9 EFs con `serveEf`, cero `Deno.serve`/`handleOptions` sueltos en handlers,
  args de `createAdminClient` correctos. Guards/validaciones preservados (reporte de cada chunk).
- **`serve-log no-leak guard` (spec 23, fix-loop): 7 tests / 7 pass / 0 fail** en `node:test` (sin Deno). Mutante
  de leak → rojo → revert verde (ver `serve-log.test.ts` arriba). El refactor `serve.ts`→`serve-log.ts` no cambia
  el contrato observable de las EFs (mismo `ef_in`/`ef_out`, mismo backstop).
- `deno check` NO corrido (Deno no instalado en el entorno).
- **DB/deploy-GATED** (pendiente OK de Raf en sesión): aplicar 0131 + correr la suite `audit`/edge contra la
  DB compartida (runtime real de las EFs migradas + landing del `request_id` en audit). El MCP de Supabase
  está sin token en esta sesión.

## Riesgos para reviewer / Gate 2

- El comportamiento runtime de las EFs migradas y el landing del `request_id` en audit NO se pudieron
  verificar en vivo (deploy-gated). El reviewer valida estáticamente que la migración a `serveEf` preservó
  cada contrato de EF y que el 0131 está moldeado fiel a 0124.
