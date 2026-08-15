# Security Gate 2 (modo code) — 23 · request_id / operationId end-to-end

> ADR-019 · security_analyzer, modo `code`. Fecha 2026-08-14.
> Baseline: `c84014dd4a036871c802772f4736431b26c8017d` (registrado en `impl_23-...-frontend.md`). HEAD ==
> baseline → toda la feature vive en el working tree sin commitear; el diff se calculó con
> `git diff --name-only` (tracked) + `git ls-files --others` (untracked), NO con `main...HEAD` (daría vacío).
> Skill: `sentry-skills:security-review` (trazar data flow + verificar explotabilidad ANTES de reportar),
> referencias cargadas: `logging.md`, `error-handling.md`. + checklist RAFAQ-específico + catálogo A/B/C/F.
> Límite declarado: runtime deploy-gated (0131 NO aplicada, MCP sin token) → auditoría ESTÁTICA del código.

## Veredicto: **PASS**

**0 findings HIGH. 0 findings MEDIUM. 3 notas LOW** (anexo, no bloqueantes). Nada debe arreglarse antes de
cerrar el gate.

Leí el CÓDIGO as-built (no la prosa) de las 6 superficies. Cada postura que Gate 1 dio por buena en la spec
se sostiene en el as-built. El cambio es aditivo, fail-closed y espeja `0124`/spec-18 (ya auditado). El
único input externo nuevo —el header `X-Rafaq-Request-Id`— está acotado + validado de forma autoritativa en
DOS capas server-side y confinado a `service_role`. La migración a `serveEf` no debilitó ningún control de
las 9 EFs.

---

## Findings HIGH de Sentry (skill)
Ninguno. La skill no identificó vulnerabilidades HIGH-confidence tras trazar el data flow del header.

## Findings RAFAQ-SPECIFIC
Ninguno bloqueante. (Ver anexo LOW.)

---

## Trazas verificadas (las 6 superficies + data flow del header)

### 1. Migración `0131_audit_request_id.sql` — CONFIRMADO (anti-spoof + total + aditivo + fail-closed)
Comparé línea a línea contra `0124_audit_log.sql` (la base correcta; grep confirmó que 0125–0130 no redefinen
esas funciones — regla `reference_function_recreate_base`).

- **Anti-spoof (`resolve_request_id`, 0131:29-49)**: confía el header SOLO si
  `current_setting('request.jwt.claims',true)::jsonb->>'role' = 'service_role'` (0131:37-38). Es un GUC de
  **sesión**, no `current_user` → correcto bajo `SECURITY DEFINER`. Un write con JWT `authenticated` (o vía
  PowerSync) NO entra al `if` → `v_rid` queda NULL → **no puede inyectar `request_id`**. Idéntico patrón a
  `resolve_actor` (0124:96-121). Diferencia legítima: sin fallback a `auth.uid()` (un request_id no tiene
  "usuario logueado") → NULL honesto. Correcto.
- **Regex ANTES del cast (0131:41-42)**: `if v_hdr ~ '^[0-9a-fA-F]{8}-...-...{12}$' then v_rid := v_hdr::uuid`
  → el cast solo corre sobre un valor que ya matcheó la forma uuid. Sin cast a ciegas.
- **TOTAL / no traba el write (0131:36-48)**: todo el cuerpo dentro de `begin ... exception when others →
  return null`. Cualquier fallo de parse → NULL, nunca lanza. No agrega vía de falla al modo `strict`.
- **Trigger re-CREATE airtight (0131:55-94)**: verificado byte-a-byte contra 0124:127-162. ÚNICO cambio: se
  agrega la columna `request_id` (posición fija tras `auth_uid`) + su valor `audit.resolve_request_id()` al
  INSERT en AMBOS modos. El guard airtight del best_effort (`begin ... exception when others → null`,
  0131:62-77), el path strict, `record_id` estable, `resolve_actor` y `return coalesce(new,old)` quedan
  idénticos. El best_effort de la manga sigue sin poder trabarse.
- **Columna NULLABLE / aditiva (0131:20)**: `add column if not exists request_id uuid` — sin NOT NULL, sin
  default → NULLABLE. Los writes existentes quedan con NULL y no se rompen. El smoke-check lo re-asserta
  (`is_nullable='YES'`, 0131:118-123).
- **Fail-closed (0131:100-125)**: `revoke execute ... from public, anon, authenticated` + smoke-check DOBLE
  que ABORTA la migración si (a) `resolve_request_id` quedó EXECUTE-able por un rol cliente, (b) el muro de
  lectura (`USAGE`/`SELECT` sobre `audit`) se abrió, o (c) la columna no quedó NULLABLE. Paridad con 0124.

### 2. `_shared/serve.ts` — CONFIRMADO (no-leak)
- **No lee/buffea el body**: `bodyBytes: Number(req.headers.get('content-length')) || null` (serve.ts:58).
  Nunca consume el stream. Grep confirmó: sin `req.json()`/`.text()`/`.body` en el wrapper.
- **`readSubBestEffort` (serve.ts:21-37)**: lee `Authorization`, extrae SOLO `sub` del payload, TODO en
  try/catch → `undefined` ante cualquier fallo. `atob`/`JSON.parse` sobre basura → throw → catch → undefined;
  `payload?.sub` con guard `typeof === 'string'`. **Nunca devuelve ni loguea el token**. Sin prototype
  pollution (solo lee `.sub`).
- **Logging (serve.ts:53-61, 80-89)**: exactamente 2 `console.log`, ambos `JSON.stringify`. ENTRADA loguea
  `requestId` (uuid limpio) + `bodyBytes` + `actor` (=sub). SALIDA loguea `status`/`code`/`ms`. **Jamás**
  `Authorization`, JWT crudo, message ni body. `JSON.stringify` escapa newlines/control chars → **sin
  log-injection** aunque el header o el `sub` traigan basura.
- **Salida solo `error.code` de `status>=400` (serve.ts:70-78)**: `res.clone().json()` best-effort → SOLO
  `body?.error?.code`. En 2xx no parsea nada. Si el body no es JSON → catch → `code` undefined → no-op.
- **`res.clone()` no rompe la respuesta al cliente**: se clona para leer el code; el `res` original se
  devuelve intacto (serve.ts:91). Sin doble-consumo del stream del cliente.
- **Backstop `serverError('unexpected', err)` (serve.ts:67)**: verificado en `errors.ts:30-33` — loguea el
  detalle server-side (`console.error`) y devuelve copy genérico (`'Error interno, probá de nuevo.'`), **sin
  `err.message`**. El catch-all NO abre information-disclosure (B1); centraliza los 5xx por el helper
  endurecido de spec 13.

### 3. Las 9 EFs migradas a `serveEf` — CONFIRMADO (ningún control debilitado)
Grep + lectura de `invite_user`, `change_member_role`, `accept_invitation`, `health`:
- 9/9 usan `serveEf('<nombre>', ...)`. Cero `Deno.serve` suelto (solo en `_shared/serve.ts`). Cero
  `handleOptions` dentro de handlers (lo hace el wrapper ANTES del handler → el preflight OPTIONS nunca llega
  al code-path autenticado, y todas tienen method-guard POST → sin bypass por OPTIONS).
- Method-guard `req.method !== 'POST' → 405` preservado en las 8 con efecto (health es público/input-free
  por diseño, `verify_jwt=false`, sin efecto de lado — intencional, no regresión).
- `requireUser` + (donde aplica) `requireOwnerOf` preservados en las 8 autenticadas. Validación de inputs
  (`ALLOWED_ROLES`, guards `typeof`, `jsonError(400,'invalid_input',...)`) intacta.
- El header nuevo NO abre bypass de auth: `serveEf` no toca `requireUser`/RLS; solo resuelve el requestId y
  lo pasa por `ctx`. La autz de cada EF corre igual que antes.
- Los `jsonError(err.status, err.code, err.message)` (12 sitios) devuelven message SOLO para
  `err instanceof HttpError` — mensajes 4xx curados de los helpers de auth, NO el `.message` del driver
  Postgres. Los 5xx pasan por `serverError` (strip). Patrón pre-existente de spec 13, no introducido acá.

### 4. `createAdminClient(actorId?, requestId?)` (`_shared/supabase.ts`) — CONFIRMADO (sin spoof)
- Aditivo (supabase.ts:24-40): sin args → shape idéntico al anterior (sin regresión). Con args → arma
  `global.headers` solo con los presentes.
- **Actor nunca del body**: grep de los 9 call-sites → `createAdminClient(user.id, ctx.requestId)` en las 4
  que escriben como usuario (accept/change_role/remove/delete), `createAdminClient(undefined, ctx.requestId)`
  en invite/cancel/resend/register, `createAdminClient()` en health. El `user.id` siempre viene de
  `requireUser` (JWT validado), NUNCA del `body`.
- **`requestId` siempre limpio**: `ctx.requestId` es el valor validado-o-regenerado por `serveEf` (uuid).
  Aunque llegara basura, `resolve_request_id` re-valida con regex antes del cast (defensa en profundidad). El
  trigger confía actor y request_id SOLO bajo service_role → el header en las requests del admin client
  (service_role) lo pone la EF, no el cliente.

### 5. Frontend no-PII (`payloads.ts` / `redact.ts` / `sentry.native.ts` / UI) — CONFIRMADO
- `buildUploadRejectedPayload` (payloads.ts:36-50): extrae EXCLUSIVAMENTE `id`/`table`/`op`/`code` con guards
  `if (x !== undefined)`; **nunca `opData`** ni otra clave del CrudEntry. `id` = `op.id` (id de fila,
  no-PII). El test `payloads.test.ts` lo mantiene honesto (mutante `opData` → rojo, verificado en impl).
- `redact.ts` = segundo cerrojo `beforeSend`/`beforeBreadcrumb` (cableado en sentry.native.ts:40-41):
  - `request_id` → normaliza a `requestid` → no matchea PII (igualdad) ni raíz de secreto (inclusión:
    token/secret/session/password/pwd/apikey/authorization/auth/credential/cookie/jwt) → **pasa** (correcto,
    es la señal de correlación buscada).
  - `id` → `id` → pasa. `opData` → **está en `PII_KEYS_RAW`** (redact.ts:35) → se redacta si se filtrara.
  - Fail-closed: si el walk tira → `null` → Sentry descarta (nunca manda crudo).
- `captureExceptionSafe` (sentry.native.ts:55-71): tag `request_id` **por-captura** (`{ tags }` local), NO
  `setTag` global persistente (R4.4). `mechanism` + `request_id` uuids, sin PII.
- UI (`SupportCodeRow.tsx`): renderiza/copia `supportCode` (uuid de correlación, sin PII); Clipboard en
  try/catch best-effort; `selectable` como fallback. `request-id.ts` = `crypto.randomUUID()`.

### 6. CORS (`_shared/cors.ts`) — CONFIRMADO (no amplía superficie de auth)
`x-rafaq-request-id` agregado a `Access-Control-Allow-Headers` (cors.ts:9). Allow-Headers solo le dice al
navegador qué headers custom PUEDE mandar; **no otorga confianza server-side**. La confianza del request_id
la gatea `service_role` en `resolve_request_id`. Header de correlación, no credencial → sin ampliación de
auth. (El `Access-Control-Allow-Origin: '*'` es pre-existente MVP, no lo introduce ni empeora esta feature —
ya anotado en Gate 1 para hardening pre-prod.)

---

## Regla de rol: inputs y rate limits

### Tabla de inputs (campos nuevos/modificados que cruzan una frontera de confianza)
| entrada | límite | validación | OK? |
|---|---|---|---|
| Header `X-Rafaq-Request-Id` (cliente → EF → GUC → DB) | forma uuid (regex hex+guiones fija) | **server autoritativa DOBLE**: (a) `serveEf` regex-valida o regenera `crypto.randomUUID()` si viene basura (serve.ts:47-49); (b) `resolve_request_id()` regex-valida antes del cast + confina a `service_role` (0131:38-42) | ✅ |
| JWT `sub` logueado como `actor` (serve.ts) | n.a. — best-effort, sin verificar firma | solo etiqueta de traza; `JSON.stringify` escapa; actor autoritativo = `audit.auth_uid` (validado) | ✅ (ver LOW-1) |
| "Código de soporte" (UI) | n.a. — es **output** (muestra/copia un uuid) | n.a. | ✅ (no es input) |

Esta feature **no** introduce formularios, buscadores, texto libre ni prompts LLM. El único input externo
nuevo es el header, acotado + validado autoritativamente en dos capas y confinado a `service_role`.
**Log-injection neutralizado por construcción**: el valor logueado es siempre uuid limpio (validado o
regenerado) y las líneas son `console.log(JSON.stringify(...))` → el JSON escapa newline/control chars.

### Tabla de rate limits (acciones abusables tocadas por el diff)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| 9 EFs migran a `serveEf` | sin cambio | n.a. | n.a. | El wrapper agrega logging + propaga el header; NO afloja ni toca el rate-limit (in)existente. No regresión. |
| `[auth.rate_limit]` (config.toml) | intacto | n.a. | n.a. | El diff no toca `config.toml`. |
| Logging in/out (2 líneas JSON/call) | n.a. | n.a. | n.a. | Sin fan-out ni amplificación; costo despreciable, acotado por el volumen de EF-calls existente. |

Sin acción bulk/import nueva, sin EF que mande email/SMS o pegue a API externa nueva, sin buscador. **No
aplica** rate limit nuevo, y no se relaja ninguno existente.

---

## Catálogo RAFAQ revisado (dominios tocados)
- **A1 (service-role bypassa RLS)**: sin query nueva con `createAdminClient` sin scoping; el header es
  aditivo. El `request_id` lo setea el trigger desde un GUC validado, NUNCA desde el body.
- **A2 (mass assignment)**: `request_id` no viene del body — se resuelve server-side en el trigger. Sin
  `.insert(body)`/`.update(body)` nuevo con spread.
- **A3/A4 (IDOR/BFLA)**: sin objetos/autz nueva; el wrapper preserva el contrato de cada EF
  (`requireUser`/`requireOwnerOf` intactos).
- **B1 (err.message crudo al cliente)**: backstop `serverError` genérico; los `err.message` restantes son 4xx
  curados de `HttpError`, no del driver. Sin fuga.
- **B2 (PII en logs)**: sin body, sin Authorization, sin message; solo uuids + status/ms/code.
- **C (offline/sync)**: la correlación de writes-por-PowerSync está diferida (context §"lo que NO"). La
  columna se agrega NULLABLE, sin tocar sync rules ni data-at-rest.
- **F1 (filter injection)**: el header no entra a `.or()/.filter()/.ilike`; se resuelve por GUC en el trigger.
- **I2 (audit tamper-evidence)**: `record_version` sigue append-only + retención 90d + muro fail-closed; la
  migración lo preserva.

## Dominios excluidos (con justificación)
- **F2/F3 (import/SSRF)**, **G (BLE)**, **E2/E3 (denial-of-wallet/captcha)**, **H2 (MFA)**, **I1
  (borrado/retención)**: el diff no toca esas superficies. Sin ingesta de archivos, sin `fetch()` a URL
  influenciable, sin endpoint con costo por request nuevo, sin lecturas BLE nuevas, sin cambio de
  credenciales/borrado.

---

## False positives descartados (trazabilidad)
- **`jsonError(err.status, err.code, err.message)` en 8 EFs** → NO es information-disclosure: solo corre para
  `err instanceof HttpError` (mensajes 4xx curados de `requireUser`/`requireOwnerOf`), no para el `.message`
  del driver Postgres. Los 5xx pasan por `serverError` (strip). Pre-existente spec 13, no introducido por 23.
- **`res.clone().json()` en serve.ts** → NO rompe la respuesta al cliente ni es DoS: clona solo para leer el
  `code` de errores (bodies chicos), el `res` original se devuelve intacto, `.json()` sobre no-JSON → catch.
- **`atob`/`JSON.parse` del JWT en `readSubBestEffort`** → NO es RCE/injection: TODO en try/catch, solo lee
  `.sub` con guard `typeof string`, nunca ejecuta el contenido ni loguea el token.
- **`request_id`/`id` no redactados por `redact.ts`** → intencional: son uuids de correlación no-PII que
  QUEREMOS en Sentry; no matchean PII (igualdad) ni raíz de secreto (inclusión). `opData` sí se redacta.

---

## Cobertura indirecta de Deno / SQL(PLpgSQL) / RLS / PowerSync
La skill de Sentry NO cubre nativamente PL/pgSQL (trigger + `resolve_request_id`), el runtime Deno de las EFs
ni las sync rules de PowerSync. Esas superficies las auditó **este analizador manualmente** (secciones 1, 3,
4 arriba), comparando byte-a-byte contra el patrón ya auditado de `0124`/spec-18. **Límite empírico**: 0131
está **deploy-gated** (no aplicada; MCP sin token) → el landing real del `request_id` en `audit.record_version`
y el comportamiento anti-spoof en vivo NO se verificaron en runtime; la auditoría es estática. Las tasks
DB-gated (T29–T32: audit/request_id/anti-spoof/grants contra la DB) quedan como verificación pendiente cuando
Raf autorice el deploy — recomendado correr la suite `audit` + un caso negativo (write con JWT de usuario
mandando el header → request_id debe quedar NULL) antes de dar por cerrado el ciclo en runtime.

---

## Archivos analizados
- `supabase/migrations/0131_audit_request_id.sql` (vs base `0124_audit_log.sql`)
- `supabase/functions/_shared/{serve.ts, supabase.ts, cors.ts, errors.ts}`
- Las 9 EFs: `invite_user, accept_invitation, change_member_role, remove_member, cancel_invitation,
  resend_invitation, delete_account, register_push_token, health` (`index.ts`)
- `app/src/services/observability/{payloads.ts, redact.ts, sentry.native.ts}`
- `app/app/_components/SupportCodeRow.tsx`, `app/src/utils/request-id.ts`

---

## Anexo — Notas LOW (no bloqueantes)

**LOW-1 · `actor` de log = `sub` de JWT sin verificar (integridad de log, no de auth).** `serveEf` loguea, en
la línea de ENTRADA, el `sub` de un JWT sin verificar firma (serve.ts:60). Un atacante podría mandar un JWT
no firmado con un `sub` arbitrario → aparecería como `actor` en ese log. Pero: (a) `JSON.stringify` escapa →
sin log-injection; (b) la request es rechazada 401 por `requireUser` → la línea de SALIDA la marca; (c) el
actor autoritativo es `audit.auth_uid`, validado. Valor de engaño casi nulo, ya documentado en el código y en
Gate 1. Mejora opcional: validar forma uuid del `sub` antes de loguearlo o etiquetarlo `actor_unverified`.

**LOW-2 · Volumen del `actor` en logs.** Corolario de LOW-1: un `sub` de longitud arbitraria (JWT no firmado
attacker-controlled) infla la línea `ef_in`. Sin amplificación relevante (1 línea/request, y la request se
401ea). Mejora opcional: truncar `sub` a N chars al loguear.

**LOW-3 · CORS `Access-Control-Allow-Origin: '*'` pre-existente (MVP).** No lo introduce ni empeora esta
feature; queda para el hardening de CORS pre-producción (ya anotado en Gate 1). No es hallazgo de este gate.
