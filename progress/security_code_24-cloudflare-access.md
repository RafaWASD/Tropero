# Security (modo code) — 24-audit-viewer / delta cloudflare-access

**Veredicto: PASS — 0 HIGH.** El nudo del Gate 1 (verificación del JWT sin bypass) y el M-1
(secreto Function↔EF en tiempo constante, antes del JWT, fail-closed) están cerrados en el
as-built. Sin HIGH nuevos. MEDIUM/LOW foldeados abajo (nada bloqueante; dependencias de deploy
que ya están gateadas y se validan en el smoke T5.5).

- **baseline_commit**: `d18384a18ef74934214e6e90144f5146160d135b` (leído de `progress/impl_24-cloudflare-access-backend.md` y `-web.md`, coinciden).
- **Alcance auditado**: diff working-tree vs baseline, solo los archivos del delta. Análisis **estático** (runtime jose/JWKS + query es deploy-gated, per instrucción; no corrí `check.mjs`). Cambios de `app/` (ios-ble-mfi) ignorados.

## Archivos analizados (diff real, confirmado)

`git diff --name-only baseline..HEAD` está vacío; los cambios son working-tree (`git status --porcelain`):

- M `supabase/config.toml`
- M `supabase/functions/audit_query/index.ts`
- ?? `supabase/functions/audit_query/access.ts` (nuevo)
- ?? `supabase/functions/audit_query/access-helpers.ts` (nuevo)
- ?? `supabase/functions/audit_query/access-helpers.test.ts` (nuevo, test)
- M `docs/internal/audit-viewer/_headers`
- M `docs/internal/audit-viewer/app.js`
- M `docs/internal/audit-viewer/index.html`
- ?? `docs/internal/audit-viewer/functions/api/audit_query.js` (nuevo, Pages Function)
- ?? `docs/internal/audit-viewer/functions/api/audit_query.test.mjs` (nuevo, test)

**Intactos, confirmado (NO en el diff)**: `query.ts`, `db.ts`, `_shared/*`. **Sin migraciones** (`git diff --name-only baseline..HEAD -- supabase/migrations` vacío). Muro de spec 18 (única puerta de lectura de `audit.record_version`, SQL parametrizado) intacto.

## Focos del Gate — verificación

### 1. Verificación del JWT SIN bypass (`access.ts`) — CERRADO
Trazado línea por línea (`verifyAccessJwt`, `access.ts:30-57`):

- `algorithms: ['RS256']` **EXPLÍCITO** (`:42`) → rechaza `alg:none`, HS256 y alg-substitution. Un atacante que firme con HS256 usando la clave pública como secreto HMAC es rechazado (el alg del header no está en la allowlist).
- `audience: aud` con `aud = Deno.env.get('CF_ACCESS_AUD')` (`:32`, `:44`) → un JWT emitido por Access para **otra app del mismo team** trae otro `aud` y NO pasa (RCFA.2.5, exactamente el riesgo del Gate 1).
- `issuer: https://${teamDomain}` (`:43`) EXACTO.
- `exp` validado por default de `jwtVerify` (`clockTolerance` en 0, estricto) (`:45`).
- **Toda excepción → 401**: `try/catch` alrededor de `jwtVerify` → `HttpError(401, 'unauthorized', 'Sin acceso.')` sin propagar el detalle de jose (`:47-50`). Config ausente (`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`) → 401 **fail-closed** (`:35-37`). `email` ausente/no-string/vacío → 401 (`:53-55`). No hay rama de retorno "exitoso" alcanzable sin firma+aud+iss+exp válidos.
- **email del payload VERIFICADO**, no del header crudo: `const email = payload.email` (`:52`). Grep confirma que `Cf-Access-Authenticated-User-Email` aparece SOLO en un comentario que lo prohíbe (nunca se lee).
- JWKS: `createRemoteJWKSet(new URL(\`https://${teamDomain}/cdn-cgi/access/certs\`))` con `teamDomain` de env (server-controlled) → sin SSRF.

Sin bypass. Fail-closed en todos los caminos.

### 2. [M-1] Proxy secret (`index.ts` + `access-helpers.ts`) — CERRADO
- **Comparación en tiempo constante**: `timingSafeEqualBytes` (`access-helpers.ts:20-27`) XOR-acumula sobre el largo máximo y funde `a.length ^ b.length` en el acumulador; sin early-return por contenido, sin cortocircuito por largo. No usa `===`.
- **ANTES del JWT**: en `index.ts` el chequeo del proxy secret es el paso 2 (`:64-71`), estrictamente antes de `verifyAccessJwt` (paso 3, `:82`). Corta el flood no-autenticado antes de gastar RS256 (Denial-of-Wallet).
- **Fail-closed si `MITROPERO_AUDIT_PROXY_SECRET` no está seteado**: `proxySecretMatches` (`access-helpers.ts:37`) devuelve `false` si el env está ausente/vacío, aunque el header venga poblado → 401. Header ausente/mismatch → 401 (`index.ts:70`).
- El early-return de `proxySecretMatches` es sobre **presencia** (`typeof`/vacío), no sobre contenido del secreto → no filtra bytes.

### 3. Pages Function (`docs/internal/audit-viewer/functions/api/audit_query.js`) — CERRADO
- Construye un objeto `headers` **fresco** con exactamente 3 entradas: `Content-Type`, `Cf-Access-Jwt-Assertion` (del request) y `X-Mitropero-Proxy-Secret` (de `env`). **No** hace spread de `request.headers` → ningún otro header del cliente se propaga (RCFA.1.6).
- Proxy secret sale de `env.MITROPERO_AUDIT_PROXY_SECRET` (`:48`), NO hardcodeado.
- Un `X-Mitropero-Proxy-Secret` que mande el **cliente** NO se reenvía: el objeto fresco solo lo setea desde `env`; el valor del cliente se ignora (no se pisa el de env). Confirmado además por el test dedicado (`audit_query.test.mjs`).
- Fail-closed: si `env.MITROPERO_AUDIT_PROXY_SECRET` no está, no se manda el header → la EF (que lo exige) responde 401. Nunca abre por omisión.
- Sin lógica de negocio; reenvía el body crudo (`request.text()`) y devuelve la respuesta upstream tal cual.

### 4. `verify_jwt=false` (`config.toml`) — CORRECTO Y SCOPEADO
- `[functions.audit_query] verify_jwt = false` (`config.toml:398-399`), scopeado solo a `audit_query` (patrón idéntico al bloque `health`). Las demás EFs quedan con `verify_jwt=true` (default).
- **`[auth.rate_limit]` NO fue tocado** (grep: `email_sent=2`, `sms_sent=30`, `sign_in_sign_ups=30`, `token_verifications=30` intactos). El delta no aflojó ningún rate limit nativo.
- Request directo a la EF sin proxy-secret+JWT → 401 (M-1 fail-closed, luego JWT). Verificable en el smoke T5.5(a).

### 5. No-leak — CERRADO
- `serve-log.ts` (`buildEfIn`/`buildEfOut`): loguea solo `content-length` + `sub` best-effort del header `Authorization` (que el proxy ya NO manda → `actor` queda `undefined`). **NO** loguea `Cf-Access-Jwt-Assertion` ni `X-Mitropero-Proxy-Secret` ni el body.
- `index.ts`: sin `console.*` del token/secreto (grep: las únicas apariciones de `Proxy-Secret`/`Jwt-Assertion` son `req.headers.get(...)`, no logs).
- `access.ts`: el error de jose no se propaga → 401 genérico (`Sin acceso.`).
- `errors.ts:serverError` loguea el detalle del error de DB server-side (`console.error`) y devuelve copy genérico al cliente (`'Error interno, probá de nuevo.'`) — sin `.message` del driver Postgres al cliente. Correcto (B1).

### 6. Preservado — CERRADO
- `query.ts`/`db.ts` fuera del diff (confirmado). Sin migraciones/grants (muro spec 18 intacto).
- Web sin `innerHTML` de datos: `app.js` pinta TODO (`record`/`old_record`/`actor`/`request_id`) vía `textContent`/DOM APIs (`makeVal`, `txtEl`, `actorNode`). Grep `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval` en el slice web → única aparición es un comentario ("JAMÁS con innerHTML"). CSP `script-src 'self'` + `connect-src 'self'` en `_headers` y `<meta>`. Sin XSS.

### 7. `jose@5.9.6` pin — pin EXACTO OK; `deno.lock` deploy-gated (LOW-1)
- `import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6'` (`access.ts:11`) — versión exacta, sin `^`/flotante. Único import de jose.
- `deno.lock` NO committeado (Deno no instalado en la máquina; el lock se genera en el deploy con `deno cache`). Consistente con el baseline (`npm:postgres@3.4.5` en `db.ts` tampoco tiene lock). Ver LOW-1.

## Findings HIGH de Sentry (skill `sentry-skills:security-review`)
**Ninguno.** No high-confidence vulnerabilities identified. Tras trazar los data flows (JWT, proxy secret, headers del proxy, logs) y probar adversarialmente los caminos de bypass, ningún patrón resultó explotable.

## Findings RAFAQ-SPECIFIC
**Ninguno HIGH/MEDIUM.** El delta refuerza el gate (2 muros criptográficos donde antes había uno basado en Supabase Auth). Catálogo A (service-role/authz), B1 (info disclosure), F (injection) revisados: sin cambios en la superficie de datos (query.ts/db.ts intactos).

## False positives descartados / probes adversariales
- **alg confusion / `none` / HS256**: descartado — `algorithms:['RS256']` explícito.
- **JWT de otra app del team**: descartado — `audience` EXACTO == `CF_ACCESS_AUD`.
- **SSRF en el JWKS**: descartado — `teamDomain` de env (server-controlled).
- **Cliente forja `Cf-Access-Jwt-Assertion` y la Pages Function lo reenvía**: aunque el header llegara a la EF, esta lo verifica criptográficamente contra el JWKS de Cloudflare → token forjado falla → 401. El gate real es la firma, no la mera presencia del header. Defensa en profundidad correcta.
- **Cliente inyecta su propio `X-Mitropero-Proxy-Secret`**: descartado — la Pages Function usa exclusivamente el valor de `env`, no reenvía el del cliente.
- **`serve-log.ts` loguea `Authorization`**: no aplica — el proxy no manda `Authorization`; un caller directo con proxy secret solo loguearía su propio `sub` no-verificado como etiqueta de traza (no data de terceros).

## Tabla de inputs (campos que el usuario controla)
| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| filtros del body (`from/to/auth_uid/establishment_id/request_id/table_name/op`, `before`) | acotados por `validateFilters` (query.ts, **intacto**) | server (autoritativa) | sí (fuera del delta) |
| `Cf-Access-Jwt-Assertion` (header) | JWT verificado RS256+aud+iss+exp | server (jose, criptográfico) | sí |
| `X-Mitropero-Proxy-Secret` (header) | comparación tiempo-constante vs env | server (fail-closed) | sí |

## Tabla de rate limits
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| EF `audit_query` (lectura audit) | sí (in-memory, 60/60s) | por `email` verificado | sí (proxy-secret + JWT cortan antes) | best-effort per-instancia; suficiente para tool interna de 2 personas. Proxy-secret checkeado ANTES de RS256 (anti Denial-of-Wallet). |
| Auth nativo Supabase | sí (`[auth.rate_limit]`) | per-IP | n/a | **NO tocado** por el delta (intacto). |

## MEDIUM/LOW foldeados (no bloqueantes)
- **LOW-1 (supply chain, deploy-gated)**: `deno.lock` sin committear. `jose@5.9.6` está pineado exacto, pero sin lock con integrity el artefacto no se verifica en-repo. Consistente con el baseline (postgres sin lock). Acción: generar + committear el lock en el deploy (`deno cache`, T5.2), igual que se prevé para postgres.
- **LOW-2 (timing residual, aceptado)**: `timingSafeEqualBytes` puede filtrar el LARGO del secreto (no el contenido). Despreciable para un token random fuerte detrás de Access + JWT. Documentado en el código y en design §6-bis.
- **LOW-3 (dependencias de deploy, NO código — verificar en el gate humano)**: el modelo de seguridad depende de config de deploy que queda gateada (T5.1) y se valida en el smoke T5.5:
  1. `MITROPERO_AUDIT_PROXY_SECRET` seteado **idéntico** en ambos lados (env de Pages + secret de la EF).
  2. El sitio de Pages **y** `/api/*` detrás de la Access application (si `/api/audit_query` quedara fuera de Access, el gate se apoya solo en proxy-secret + verificación cripto del JWT — que igual aguantan, pero la defensa en profundidad se pierde).
  3. `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` seteados en la EF (sin ellos → fail-closed 401, no fuga).
  4. `MITROPERO_STAFF_USER_IDS` retirado (gate viejo).
  Smoke T5.5 obligatorio como oráculo de runtime: (a) directo sin JWT → 401; (b) desde el visor tras Access → 200; (c) JWT con `aud` de otra app → 401.

## Cobertura indirecta (límites de la skill sobre este stack)
- **jose/JWKS (runtime)**: la skill de Sentry no ejecuta Deno; la verificación RS256/JWKS es integración deploy-gated. Garantía por lectura estática (parámetros explícitos + fail-closed sin rama de bypass) + smoke T5.5. Cobertura estática: alta; runtime: pendiente del smoke.
- **Pages Function (Cloudflare Workers runtime)**: auditada por lectura + su test node:test (6/6, mock de `fetch`). Sin runtime real de Access en esta corrida.
- **RLS/PowerSync**: no aplica a este delta (EF de solo-lectura por conexión directa; sin cambios de schema/policies).
