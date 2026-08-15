# Security Gate 1 (modo spec) — 23 · request_id / operationId end-to-end

> ADR-019 · security_analyzer, modo `spec`. Fecha 2026-08-14.
> Input: `specs/active/23-request-id-correlation/{context,requirements,design}.md`.
> Metodología: sentry-skills:security-review (trazar data flow + verificar explotabilidad ANTES de
> reportar) + catálogo de dominios RAFAQ + verificación contra el código VIGENTE en el repo.

## Veredicto: **PASS**

0 findings HIGH. 0 findings MEDIUM. 3 notas LOW (anexo, ninguna bloqueante).

La spec ya tomó la postura correcta en las 6 superficies que declaró para el Gate 1, y cada postura
la verifiqué contra el código real (no contra la prosa de la spec). El diseño es aditivo, fail-closed
y espeja un patrón (`0124` / spec 18) que ya pasó auditoría. No introduce ningún input de usuario sin
acotar ni ninguna acción abusable nueva.

---

## Superficies auditadas (confirmación con evidencia)

### 1. Anti-spoof del header `X-Rafaq-Request-Id` — CONFIRMADO
`audit.resolve_request_id()` (design §US3, SQL líneas 115-135) confía el header **solo** si
`current_setting('request.jwt.claims')->>'role' = 'service_role'`. Es un GUC de **sesión** (no
`current_user`), por lo que es correcto aun bajo `SECURITY DEFINER` — el privilegio del definer no
cambia el claim de sesión del caller. Idéntico a `audit.resolve_actor()` en
`supabase/migrations/0124_audit_log.sql:96-121` (patrón ya auditado, deployado y funcionando).

- Un write con JWT de usuario (rol `authenticated`) o vía PowerSync → `v_role != 'service_role'` →
  `v_rid` queda NULL → **no puede inyectar `request_id`** en `audit.record_version`. (R3.5)
- La validación de forma ocurre **antes** del cast: `if v_hdr ~ '^[0-9a-fA-F]{8}-...{12}$' then v_rid
  := v_hdr::uuid; end if;` (design SQL:127-129). Cast solo sobre un valor que ya matcheó la regex uuid.
  (R3.4)
- Refuerzo del modelo: hoy la única tabla auditada (`public.user_roles`) se escribe **solo por EFs
  (service_role)** y un cliente no puede escribirla directo (RLS) → el `request_id` del cliente llega
  bien vía el admin client y un cliente no puede ensuciar el audit con ids falsos.

Diferencia legítima con `resolve_actor`: `resolve_request_id` **no** tiene fallback a `auth.uid()`
(un request_id no tiene equivalente de "usuario logueado" → NULL honesto). Correcto.

### 2. Fail-closed / TOTAL de `resolve_request_id()` — CONFIRMADO
Todo el cuerpo va dentro de `begin ... exception when others → return null; end` (design SQL:122-134).
Cualquier fallo de parse (claim/header no-JSON, cast) → NULL, **nunca lanza**. No puede trabar un write
en el hot path. (D6 / R3.6)

- El re-CREATE del trigger (design SQL:141-180) mantiene el guard airtight de `0124`: en `best_effort`
  **todo** (pk + `resolve_actor()` + `resolve_request_id()` + INSERT) va dentro del
  `begin...exception when others → null` (líneas 148-163). Verificado byte-a-byte contra
  `0124_audit_log.sql:132-147`: el único cambio es agregar la columna `request_id` + su valor tras
  `auth_uid` en ambos modos. `record_id` estable, `resolve_actor`, ambos modos de falla y
  `return coalesce(new, old)` quedan idénticos. (R3.9)
- Como `resolve_request_id` es TOTAL, **no agrega** una vía de falla al modo `strict` (user_roles).
- Migración aditiva: `add column if not exists request_id uuid` NULLABLE (design SQL:106) → los writes
  existentes quedan con NULL y no se rompen. (R3.11)

### 3. No-leak en el logging del wrapper `serveEf` — CONFIRMADO
Design §US2 (D-A/D-B/D-C) + §Notas Gate 1 punto 3:
- **No lee/buffea el body**: `bodyBytes = Number(req.headers.get('content-length')) || null` (design
  §US2.2). Nunca consume el stream. (R2.8)
- **No loguea `Authorization` ni el JWT crudo** (R2.9). El `actor` es solo el `sub` del payload del JWT
  (best-effort, sin verificar firma) — un uuid, no PII sensible; el token nunca se loguea.
- **Salida**: solo extrae `body.error.code` de respuestas `status >= 400` vía `res.clone().json()`
  best-effort; nunca `message` ni el body; en 2xx no parsea nada (design §US2.4 / D-C).
- **Backstop de throws no capturados** = `serverError('unexpected', err)`. Verificado en
  `supabase/functions/_shared/errors.ts:30-33`: `serverError` **loguea el detalle server-side**
  (`console.error`) y devuelve al cliente un copy genérico (`'Error interno, probá de nuevo.'`),
  **sin** `err.message`. → el nuevo catch-all **no** abre un camino de information-disclosure (B1) al
  cliente; al contrario, centraliza los 5xx por el helper ya endurecido (spec 13).

El `sub` del JWT sin verificar como etiqueta de log es aceptable: el actor autoritativo/anti-spoof
sigue siendo `audit.auth_uid` (validado por `requireUser` en `_shared/auth.ts:13-34`). Ver LOW-1.

### 4. No-PII en tags/props y en el payload de rechazo — CONFIRMADO
- `requestId` y `rejection.id` son uuids sin significado (D1). `rejection.id` = id de fila local
  (`crypto.randomUUID`), verificado en `upload-rejections.ts:114-117`.
- `buildUploadRejectedPayload` se extiende con `id` pero debe seguir excluyendo `opData`. Estado
  actual en `app/src/services/observability/payloads.ts:33-45`: extrae **solo** `table`/`op`/`code`,
  nunca `opData`; el test de forma `payloads.test.ts` lo mantiene honesto (R5.6/R4.3).
- **Segundo cerrojo verificado**: el scrubber `app/src/services/observability/redact.ts` es
  `beforeSend`/`beforeBreadcrumb` (cableado en `sentry.native.ts:39-40`). Tracé las claves nuevas
  contra la denylist:
  - `request_id` normaliza a `requestid` → **no** matchea ninguna PII key (igualdad) ni ninguna raíz
    de secreto (inclusión: token/secret/session/password/pwd/apikey/authorization/auth/credential/
    cookie/jwt) → pasa (correcto: es la señal de correlación que queremos en Sentry).
  - `id` normaliza a `id` → no matchea nada → pasa.
  - `opData` **sí** está en `PII_KEYS_RAW` (redact.ts:35) → si alguna vez se filtrara, se redacta.
  Es decir: las claves nuevas no rompen la feature (no se sobre-redactan) y el cerrojo sigue tapando
  `opData`.

### 5. Migración fail-closed — CONFIRMADO
- `revoke execute on function audit.resolve_request_id() from public, anon, authenticated` (design
  SQL:186). Nota de correctitud PG: una función recién creada nace con `EXECUTE` a `PUBLIC` por
  default; el revoke lo cierra dentro de la misma transacción (`begin...commit`) → sin ventana.
- Smoke-check que **aborta** la migración si `resolve_request_id` quedó EXECUTE-able por
  anon/authenticated/public **o** si el muro de lectura (`USAGE`/`SELECT` sobre `audit`) se abrió
  (design SQL:190-211). Paridad con el patrón de `0124_audit_log.sql:218-244`.
- El re-CREATE del trigger vía `create or replace function` **preserva** el ACL existente (los revokes
  de `0124` sobre `insert_update_delete_trigger` persisten; PG no resetea grants en REPLACE). El
  trigger es `SECURITY DEFINER` y no requiere EXECUTE del invocante → revocar no rompe el tracking.

### 6. CORS — CONFIRMADO (no amplía superficie de auth)
`_shared/cors.ts` hoy expone `'authorization, x-client-info, apikey, content-type'` (cors.ts:8-9). La
spec agrega `x-rafaq-request-id` (design §US2 CORS / R2.13). `Access-Control-Allow-Headers` solo le
dice al navegador qué headers custom PUEDE mandar el cliente; **no** otorga confianza server-side. La
confianza del `request_id` está gateada por `service_role` en `resolve_request_id` (superficie 1). Es
un header de correlación, no una credencial → **no** amplía superficie de auth.

> Nota de contexto (no de esta feature): `Access-Control-Allow-Origin: '*'` ya existe en `cors.ts:7`
> con comentario "MVP, ajustar en producción". Fuera de alcance de la spec 23; no lo introduce ni lo
> empeora. Queda anotado para el hardening de CORS pre-producción (no es hallazgo de este gate).

---

## Regla de rol: inputs y rate limits

### Tabla de inputs (campos que el usuario tipea / entradas externas nuevas)
| entrada | límite | validación | OK? |
|---|---|---|---|
| Header `X-Rafaq-Request-Id` (cross-frontera) | forma uuid (regex hex+guiones, estructura fija) | **server autoritativa doble**: (a) wrapper `serveEf` regex-valida o regenera `crypto.randomUUID()` si viene basura (R2.4); (b) `resolve_request_id()` regex-valida antes del cast y confina a `service_role` (R3.3/R3.4) | ✅ |
| "Código de soporte" (UI crash + rechazo de manga) | n.a. — es **output** (muestra + copia un uuid); no hay campo de entrada, ni texto libre, ni buscador, ni prompt | n.a. | ✅ (no es input) |

Esta feature **no** introduce ningún formulario, buscador, campo de texto libre ni prompt LLM. El
único input externo nuevo es el header, y está acotado + validado de forma autoritativa server-side en
dos capas, más confinado a `service_role`. **Log-injection** vía el header está neutralizado por
construcción: el valor logueado siempre es un uuid limpio (validado o regenerado) y las líneas son
`console.log(JSON.stringify(...))` → el JSON escapa cualquier newline/control char (confirmado contra
la referencia `logging.md` de la skill).

### Tabla de rate limits (acciones abusables tocadas)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Las 9 EFs migran al wrapper `serveEf` | sin cambio | n.a. | n.a. | El wrapper agrega logging + propaga el header; **no** afloja ni toca el rate-limit (in)existente de las EFs. No es regresión ni la empeora. |
| `[auth.rate_limit]` (config.toml) | intacto | n.a. | n.a. | La spec no toca `config.toml`. |
| Logging in/out (2 líneas/llamada) | n.a. | n.a. | n.a. | ~2 líneas JSON por call, sin fan-out ni amplificación; costo despreciable, acotado por el volumen de EF-calls ya existente. |

Esta feature no agrega ninguna acción bulk/import, ni EF que mande email/SMS o pegue a API externa, ni
buscador. **No aplica** un rate limit nuevo, y no relaja ninguno existente.

---

## Otros dominios del catálogo RAFAQ revisados
- **A1 (service-role bypassa RLS)**: la feature no agrega queries con `createAdminClient`; solo setea
  un header adicional (`createAdminClient(actorId?, requestId?)`, aditivo, design §US2). Sin query
  nueva sin scoping. El `request_id` lo setea el trigger desde un GUC validado, **nunca** desde el body.
- **A2 (mass assignment)**: `request_id` no viene del body — se resuelve server-side en el trigger. Sin
  `.insert(body)`/`.update(body)` nuevo.
- **A3/A4 (IDOR / BFLA)**: sin objetos nuevos ni autz nueva; el wrapper preserva el contrato observable
  de cada EF (R2.11) — cada EF sigue con su `requireUser`/`requireOwnerOf`.
- **B1 (err.message crudo al cliente)**: el backstop del wrapper usa `serverError` (genérico) — no fuga.
- **B2 (PII en logs)**: sin body, sin Authorization, sin message; solo uuids + status/ms/code.
- **C (offline/sync)**: la correlación server/DB de writes por PowerSync está **explícitamente
  diferida** (context §"lo que NO"): el id iría persistido en payload, no por header async/batch. La
  columna se agrega NULLABLE para dejar el terreno; no cambia sync rules ni data-at-rest.
- **I2 (audit tamper-evidence)**: `audit.record_version` sigue append-only + retención 90d + muro
  fail-closed; la migración lo **preserva**, no lo cambia (design §"Por qué no toca RLS de tenant").

## Dominios excluidos (con justificación)
- **F2/F3 (import/SSRF)**, **G (BLE)**, **E2/E3 (denial-of-wallet/captcha)**, **H2 (MFA)**,
  **I1 (borrado/retención)**: la feature no toca esas superficies. Sin ingesta de archivos, sin
  `fetch()` a URL influenciable, sin lecturas BLE nuevas, sin endpoint con costo por request nuevo,
  sin cambio de credenciales/borrado.

---

## Anexo — Notas LOW (no bloqueantes, opcionales de foldear)

**LOW-1 · `actor` de log = `sub` de JWT sin verificar (integridad de log, no de auth).**
El wrapper loguea, en la línea de ENTRADA, el `sub` de un JWT **sin verificar firma** (design §US2.2 /
D-A). Un atacante puede mandar un JWT no firmado con un `sub` arbitrario y aparecería como `actor` en la
línea de ENTRADA — pero: (a) `JSON.stringify` escapa el contenido → **sin** log-injection; (b) esa
request es rechazada 401 por `requireUser` → la línea de SALIDA la marca; (c) el actor **autoritativo**
es `audit.auth_uid`, validado y anti-spoof. Valor de engaño casi nulo y ya documentado (design D-A +
Alternativa 2). Mejora opcional: validar que `sub` tenga forma de uuid antes de loguearlo, o etiquetarlo
`actor_unverified` para que nadie lo confunda con el actor autoritativo. No bloquea.

**LOW-2 · El smoke-check de 0131 re-verifica solo `resolve_request_id` + read-wall.**
No re-corre el barrido completo de grants de las funciones de audit de `0124` (`resolve_actor`,
`insert_update_delete_trigger`, etc.). Como `create or replace function` **preserva** el ACL y 0131 no
toca esos grants, **no hay exposición real**. Mejora opcional (defensa en profundidad, barata):
re-asertar el sweep completo de `0124` en el `do $$` de 0131 para que un grant accidental futuro caiga
en rojo. No bloquea.

**LOW-3 · Regex uuid genérica vs "v4" estricta.**
La regex del design (SQL:127) valida estructura hex+guiones genérica (no fuerza el nibble de versión v4),
mientras la prosa dice "uuid v4". Sin impacto de seguridad: lo que importa para bloquear injection/basura
es que solo `[0-9a-fA-F-]` en estructura fija pase, y eso se cumple en wrapper y DB. Consistencia
cosmética; no tocar salvo que se quiera unificar el copy.

---

## Trazabilidad
- Archivos verificados contra el código VIGENTE: `supabase/migrations/0124_audit_log.sql`,
  `supabase/functions/_shared/{errors,auth,cors,supabase}.ts`,
  `app/src/services/observability/{payloads,redact,sentry.native}.ts`,
  `app/src/services/powersync/upload-rejections.ts`.
- Regla `reference_function_recreate_base` VERIFICADA de forma independiente: grep sobre
  `supabase/migrations/` — el ledger llega a `0130` (0131 es la siguiente); el único match de las
  funciones de audit fuera de `0124` es `0127`, y es texto dentro de un string de guard (no redefine
  el trigger ni el tracking). Moldear el re-CREATE de 0131 sobre `0124` es correcto: ninguna migración
  0125-0130 redefinió esas funciones.
