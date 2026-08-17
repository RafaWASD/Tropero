# Security — Gate 1 (modo spec) — 24 · DELTA auth por Cloudflare Access

**Veredicto: PASS — 0 findings HIGH.**
3 items a foldear antes de Puerta 1 (1 MEDIUM defensa-en-profundidad + 2 LOW), ninguno bloqueante.

- **Fecha**: 2026-08-17
- **Modo**: `spec` (Gate 1, ADR-019)
- **Input**: `specs/active/24-audit-viewer/{context,requirements,design}-cloudflare-access.md` + design.md base §8 + as-built `supabase/functions/audit_query/{index.ts,query.ts,db.ts}` + `_shared/{serve,serve-log,auth,errors}.ts`
- **Herramienta**: `sentry-skills:security-review` (metodología data-flow + exploitability) sobre el código de verificación de `access.ts` (§3.2) y la Pages Function (§2), complementado con checklist RAFAQ-específico.

---

## Resumen ejecutivo

El nudo del delta —"que la verificación del JWT de Access no tenga bypass"— está **bien resuelto en el
diseño**. La verificación (`design §3.2`, `access.ts`) usa `jose@5.9.6` con:
`algorithms:['RS256']` explícito, `audience==CF_ACCESS_AUD` exacto, `issuer==https://<team>`, `exp` por
default, JWKS remoto cacheado, y **fail-closed sin ramas de bypass** (toda excepción → `HttpError(401)`;
config ausente → 401; `email` desde el payload verificado, nunca de un header crudo). No hay rama que
acepte el token sin verificar firma, ni que confíe en `Cf-Access-Authenticated-User-Email`. Eso cierra el
riesgo central.

El único punto que amerita acción es de **defensa en profundidad, no de corrección**: con
`verify_jwt=false` la EF queda directamente alcanzable desde internet y el JWT verificado pasa a ser el
**único** gate criptográfico frente al dato más sensible del proyecto (audit cross-tenant + PII). El diseño
§6 evaluó defensa-en-profundidad por *email allowlist* pero **no** evaluó un *secreto compartido
Function↔EF*. Recomiendo agregarlo (MEDIUM, foldeable, no bloqueante). Detalle abajo.

---

## Findings HIGH

**Ninguno.**

La superficie que el leader marcó como "el cambio de seguridad más sensible del proyecto" está diseñada
correctamente. Verificación punto por punto contra las 6 superficies:

### 1. Verificación del JWT de Access SIN bypass — OK

`design-cloudflare-access.md §3.2` (`access.ts`), líneas 156-172:

- **`algorithms: ['RS256']`** explícito (línea 157) → rechaza `alg:none`, HS256 y algorithm-substitution
  (usar la clave pública del JWKS como secreto HMAC). RCFA.2.3. Correcto: sin esta restricción, jose
  aceptaría los algoritmos de las claves del JWKS y abriría el vector de confusión de algoritmo.
- **`audience: aud`** con `aud = Deno.env.get('CF_ACCESS_AUD')` (línea 147, 159) → `jwtVerify` exige que el
  claim `aud` **contenga** exactamente nuestro AUD tag. Un JWT legítimo de **otra app del mismo team**
  (otro `aud`) NO pasa. RCFA.2.5. (Nota: Cloudflare emite `aud` como array; jose maneja array↔string
  correctamente, chequea pertenencia — sin issue.)
- **`issuer: https://${teamDomain}`** exacto (línea 158) → un `iss` de otro team no pasa. RCFA.2.6.
- **`exp`** validado por `jwtVerify` por default, `clockTolerance` en 0 (estricto). RCFA.2.7.
- **JWKS remoto cacheado a nivel módulo** vía `createRemoteJWKSet` (líneas 137-143): no refetch por
  request; refresh ante `kid` desconocido (rotación) lo maneja jose con cooldown propio. El JWKS es público
  (no secreto). RCFA.2.4.
- **`email` desde el payload verificado** (línea 168: `payload.email`), no de un header crudo; si ausente o
  no-string → 401. RCFA.2.10. Efecto colateral positivo: un JWT de **service token** (que trae
  `common_name`, no `email`) para nuestro `aud` cae en 401 → no hay bypass por service token.
- **Fail-closed sin bypass**: el `catch` (líneas 162-166) mapea CUALQUIER excepción de `jwtVerify` (firma
  inválida, `aud`/`iss` distinto, `exp` vencido, forma inválida, JWKS inalcanzable) a `HttpError(401)`. No
  existe rama que acepte el token sin verificar. RCFA.2.8, RCFA.2.9.
- **NO confía en `Cf-Access-Authenticated-User-Email`** (el header crudo de identidad que Access también
  inyecta): la identidad sale SOLO del JWT firmado. Correcto — ese header no está firmado y no debe ser
  fuente de verdad.

### 2. `verify_jwt=false` + EF único gate — fail-closed OK

- Config ausente ⇒ nadie entra: `access.ts` líneas 150-152 (`if (!teamDomain || !aud) throw
  HttpError(401)`). `''` es falsy → un secret seteado vacío también corta. RCFA.2.11.
- Request directo a la EF sin JWT válido → 401: `index.ts` (§3.3) chequea `Cf-Access-Jwt-Assertion`
  ausente → 401 antes de tocar nada; presente pero inválido → `verifyAccessJwt` tira 401. RCFA.4.4.
- El `verify_jwt=false` está **scopeado** a `[functions.audit_query]` en `config.toml` (§design 1 / §4) —
  no afloja el gateway de otras EFs. (Verificar en Gate 2 que el bloque no toque otras functions.)

### 3. Pages Function — proxy sin superficie nueva OK

`design §2` (`functions/api/audit_query.js`):

- **Sin secretos, sin lógica de negocio**: solo lee `Cf-Access-Jwt-Assertion` y lo reenvía + el body.
  `MITROPERO_AUDIT_EF_URL` es la URL pública de la EF (no secreto). RCFA.1.5.
- **No deriva identidad de headers del cliente**: la única "confianza" es estar detrás de Access, que
  **controla/sobreescribe** ese header en su borde. Un cliente no lo puede spoofear porque la Function vive
  detrás de la misma Access app (RCFA.4.1). Y aunque lo lograra, la EF verifica el JWT criptográficamente →
  un `Cf-Access-Jwt-Assertion` falso muere en `verifyAccessJwt`. RCFA.1.6.
- **`onRequestPost` = POST-only** correcto: Pages Functions rutea por método; otros métodos → 405 sin
  invocar el handler. Header ausente → 401 sin llamar a la EF (líneas 84-88). RCFA.1.2.

### 4. Hardening v1 preservado — OK

- `query.ts` / `db.ts` **sin cambios**: SQL 100% por tagged-template de Postgres.js, sin `sql.unsafe`/
  concat (§8 M2 as-built confirmado en `db.ts` líneas 62-74, 110-115). Filtros validados server-side
  (uuids por regex antes del cast, allowlists de `table_name`/`op`, `limit` capeado a 100).
- Muro fail-closed de spec 18 intacto: sin migración, sin tocar grants de `audit`, schema sin exponer a
  PostgREST. La EF sigue siendo la única puerta. RCFA.2.15 / R4.x.
- **No-leak confirmado end-to-end**: el error de `jose` NO se propaga (401 genérico, `access.ts` 165). El
  `Cf-Access-Jwt-Assertion` NO se loguea: `serve-log.ts` (`buildEfIn`) solo loguea `content-length` +
  `readSubBestEffort` — y `readSubBestEffort` lee **`Authorization`**, que la Pages Function ya no manda →
  queda `undefined`, sin leak. Verificado en `serve-log.ts` líneas 30-58.
- Rate-limit re-keyeado por `email` verificado (RCFA.2.14): cap/ventana de R3.5 sin cambios. El `email`
  sale del JWT verificado (estable por persona), no de input del cliente. OK.

### 5. `jose@5.9.6` pin + deno.lock — OK a nivel spec

- Pin EXACTO `npm:jose@5.9.6` (§3.1), mismo criterio que `npm:postgres@3.4.5`. `deno.lock` con integrity se
  regenera y commitea en el deploy (deploy-gated, §8 M3). **Verificar en Gate 2** que el lockfile quede
  commiteado con el hash de jose y que la versión no derive a `^`/flotante.

---

## Findings MEDIUM (foldear antes de Puerta 1 — no bloqueante)

### M-1 · Defensa en profundidad: secreto compartido Pages Function ↔ EF

**Mi postura: recomiendo agregarlo.** El diseño ES seguro sin él (el gate criptográfico está bien), por
eso NO es HIGH ni bloquea el PASS. Pero es el hardening correcto para esta EF puntual, por tres razones que
se combinan:

1. **La EF queda directamente expuesta a internet** (`verify_jwt=false`, §4). Antes, el gateway de Supabase
   exigía al menos un JWT firmado por el proyecto (la anon key). Ahora ese pre-filtro desaparece: cualquiera
   en internet puede POST-ear a la EF, y el **único** muro es `jose`. El diseño lo asume explícitamente
   ("la EF queda como único gate").
2. **El blast radius es el peor del proyecto**: audit cross-tenant completo + PII (emails de todos los
   usuarios vía `db.ts` líneas 110-115). Un bug de verificación (CVE de jose, un error de config del `aud`,
   una regresión futura en `access.ts`) = compromiso total, servido directo desde internet, sin Cloudflare
   Access en el medio.
3. **Costo bajo, capa real**: un `X-Mitropero-Proxy-Secret` que **solo** la Pages Function setee (env de
   Pages) y la EF verifique (secret de la EF) **además** del JWT convierte "un bug en jose = game over" en
   "un bug en jose Y conocer el secreto de proxy". Es belt-and-suspenders genuino: recompone el pre-filtro
   que `verify_jwt=false` sacó, sin acoplar la Function a la anon key (que es pública y no aportaba nada).

**Nota de implementación (importante):** chequear el secreto de proxy **ANTES** de `verifyAccessJwt` (no
después). Así los floods no autenticados desde internet se rechazan barato (comparación de string) sin
gastar verificación RS256 ni spins del isolate → también mitiga el vector de **Denial-of-Wallet / DoS**
sobre invocaciones de la EF que `verify_jwt=false` habilita. (El rate-limit actual es step 4, DESPUÉS de la
verificación del JWT — no protege del flood no autenticado.)

El §6 del design ya dejó el patrón "hook opcional apagado por default" para el email allowlist; el secreto
de proxy es análogo pero más valioso (protege contra un bug de verificación, no solo contra drift de
staff). Si Raf prefiere no sumarlo ahora, dejar el finding explícito y aceptado por escrito antes del
deploy — no que pase por omisión.

---

## Findings LOW (foldear cuando toque; no bloqueante)

### L-1 · CORS `*` de la EF ahora es innecesariamente ancho

`_shared/cors.ts` sirve `Access-Control-Allow-Origin: *`. Con el delta, la web **ya no llama a la EF
directo** (llama a `/api/audit_query` same-origin vía la Pages Function). Los únicos callers directos de la
EF ahora son la Pages Function (server-to-server, sin CORS) y llamadas programáticas. **No es explotable**
—un browser cross-origin no puede producir un `Cf-Access-Jwt-Assertion` válido, así que el `*` no habilita
robo de datos vía CSRF/CORS— pero el `*` ya no cumple ninguna función legítima. Considerar acotarlo. No
bloquea (y `_shared/cors.ts` es transversal a otras EFs → cambiarlo es scope aparte, anotarlo en backlog).

### L-2 · Cache de JWKS ignora cambios de `CF_ACCESS_TEAM_DOMAIN` en caliente

`access.ts` `getJwks(teamDomain)` memoiza `jwks` en la primera llamada e ignora `teamDomain` en las
siguientes (líneas 137-143). Con un solo team es inocuo (y el `issuer` sí se re-lee por request). Si alguna
vez se rota el team domain sin reciclar el isolate, el JWKS viejo persistiría hasta el próximo cold start.
Cosmético; documentar el supuesto "un solo team". No bloquea.

---

## Postura sobre el email allowlist (§6, RCFA.2.13) — de acuerdo con el diseño

El default "no setear `CF_ACCESS_EMAIL_ALLOWLIST`" es correcto: la policy de Access YA es la allowlist, y el
check de `aud` exacto ya garantiza "nuestra app, no cualquiera del team". Duplicar los mails en un secret de
la EF crea drift (alta/baja en dos lugares). El `null`=no-filtra **no es fail-open**: el gate real (JWT
válido para nuestro `aud`) ya corrió; `null` es el modo explícito "Access-como-autoridad". Coincido.
Distinto del secreto de proxy (M-1), que protege un eje diferente (bug de verificación / EF expuesta), no
la membresía de staff.

---

## Verificaciones para Gate 2 (modo code, cuando se implemente)

Trazabilidad de lo que el gate de código debe confirmar sobre el diff real (no sobre el pseudocódigo del
design):

1. `access.ts` implementado con `algorithms:['RS256']` literal (no omitido, no `undefined`), `audience` y
   `issuer` exactos, y el `catch` que mapea TODA excepción a 401 sin rama de bypass.
2. `verify_jwt=false` scopeado SOLO a `[functions.audit_query]` en `config.toml`; ninguna otra function
   afectada.
3. `deno.lock` de la function commiteado con `jose@5.9.6` pineado + integrity (§8 M3); postgres sigue en
   3.4.5.
4. `query.ts` / `db.ts` **sin cambios** (grep `unsafe`/concat sobre el diff = vacío; M2 intacto).
5. El `Cf-Access-Jwt-Assertion` no se loguea en ningún `console.*` nuevo (ya cubierto por serve-log, pero
   confirmar que `index.ts`/`access.ts` no lo logueen en un catch).
6. La Pages Function no agrega headers de confianza ni secretos; reenvía solo `Cf-Access-Jwt-Assertion` +
   body.
7. Si se adopta M-1: el check del secreto de proxy va ANTES de `verifyAccessJwt`.

---

## Dominios de seguridad revisados

- **A · Authz objeto/función**: A1 (service-role/credencial privilegiada) — la EF usa `SUPABASE_DB_URL`
  (base entera); la autz ahora es el JWT de Access verificado + cross-tenant por diseño (forense). Sin
  IDOR/mass-assignment (la EF es read-only, filtros validados). OK.
- **B · Exposición de datos**: B1 (info disclosure) — `serverError` copy genérico, error de jose no se
  propaga. B2 (PII en logs) — no-leak confirmado; el JWT/email no se loguean. B3 — la exposición de PII a
  staff está documentada y aceptada (círculo de confianza). OK.
- **C · Offline/sync**: N/A (herramienta web interna de escritorio; no toca PowerSync/RN).
- **D · Secretos/supply chain**: D1 (service_role en cliente) — la web ya no carga anon key ni secretos
  (RCFA.3.2); la Pages Function no tiene secretos. D2/D3 (imports pineados) — `jose@5.9.6` + `postgres@3.4.5`
  exactos + deno.lock deploy-gated. OK.
- **E · Abuso/disponibilidad**: E1 (queries sin tope) — `limit` capeado a 100 + cursor. E2 (denial-of-
  wallet) — **ver M-1**: `verify_jwt=false` habilita floods no autenticados que gastan verificación RS256;
  el secreto de proxy checkeado primero lo mitiga. E4 (enumeration) — 401 genérico uniforme.
- **F · Inyección/ingesta**: F1 (filter injection) — SQL parametrizado, filtros validados. F3 (SSRF) — el
  único `fetch` server-side es a `MITROPERO_AUDIT_EF_URL` (env fijo de Pages) + al JWKS del team (host de
  env fijo); ninguna URL influenciada por el usuario. OK.
- **H · Auth/sesión**: H1/H3 — la sesión la maneja Access en el borde (One-time PIN, TTL de Access);
  revocación de staff = sacar el mail de la policy de Access. El JWT tiene `exp` validado. OK.
- **I · Compliance/mobile**: N/A al delta (no cambia retención/borrado; no es la app RN).

## Dominios excluidos (con justificación)

- **G · BLE**: no aplica (herramienta web, sin BLE).
- **C · Offline-first**: no aplica (§11 del design: web de escritorio, sin PowerSync).
- **I3 · Mobile hardening**: no aplica (no es la app RN).
- **A2/A3 · mass assignment / IDOR**: no aplica (EF read-only con filtros validados, sin escritura).

---

## Tabla de inputs (campos que el usuario/borde controla)

| campo | límite | validación | OK? |
|---|---|---|---|
| `Cf-Access-Jwt-Assertion` (header) | JWT firmado | **autoritativa server-side**: RS256 + aud + iss + exp vía jose (`access.ts`) | OK |
| `from`/`to` (body) | fecha ISO | server: `typeof string` + `new Date` parseable, si no 400 (`query.ts`) | OK |
| `auth_uid`/`establishment_id`/`request_id` (body) | UUID | server: `UUID_RE` antes del cast `::uuid` | OK |
| `table_name` (body) | allowlist | server: `TABLE_ALLOWLIST` (`user_roles`) | OK |
| `op` (body) | INSERT\|UPDATE\|DELETE | server: `OP_ALLOWLIST` | OK |
| `before` (cursor) | string de dígitos | server: `^\d+$`, number → 400 | OK |
| `limit` (body) | 1..100 | server: `clampLimit`, cap 100 | OK |
| `email` (identidad) | — | **derivado del JWT verificado**, no es input del cliente | OK |

Todos los campos de entrada tienen límite claro + validación **autoritativa server-side**. Ningún texto
libre se concatena en SQL (tagged-template) ni se inyecta en prompts (no hay LLM). Cumple el requisito de
Raf ("límite + validación en cada entrada").

## Tabla de rate limits (acciones abusables tocadas)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `POST /api/audit_query` (vía Pages Function) | sí (60/60s in-memory) | per-`email` verificado | sí (401 antes del rate) | best-effort per-instancia; suficiente para tool de 2 personas |
| EF directa (internet, `verify_jwt=false`) | el rate corre DESPUÉS de verifyAccessJwt | per-`email` | sí para requests con JWT válido | **gap**: un flood no autenticado gasta verificación RS256 antes del rate → ver M-1 (secreto de proxy primero) |
| Login (One-time PIN) | lo maneja Cloudflare Access en el borde | per-mail/IP (Access) | sí | fuera de nuestro código; Access rate-limitea el PIN |

---

## Respuesta corta

**PASS — 0 HIGH.** A foldear antes de Puerta 1: **M-1** (recomiendo el secreto compartido Pages↔EF como
defensa en profundidad, checkeado ANTES del JWT para cerrar también el flood no autenticado que
`verify_jwt=false` habilita — no bloqueante, pero que Raf lo acepte por escrito si decide no sumarlo),
**L-1** (acotar CORS `*` de la EF, ahora innecesario), **L-2** (documentar el supuesto "un solo team" del
cache de JWKS). La verificación del JWT de Access no tiene bypass.
