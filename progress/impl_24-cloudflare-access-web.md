baseline_commit: d18384a18ef74934214e6e90144f5146160d135b

# impl 24 — delta Cloudflare Access · slice WEB + Pages Function

Feature: `24-audit-viewer`, delta `-cloudflare-access`. Slice de ESTA corrida: la **web**
(`docs/internal/audit-viewer/`) + la **Pages Function** proxy. El backend (`supabase/**`) lo hizo OTRA
corrida en paralelo — NO se tocó nada de `supabase/` acá.

Specs: `design-cloudflare-access.md` (§2 Pages Function, §6-bis proxy secret, §7 web),
`requirements-cloudflare-access.md` (RCFA.1.x, RCFA.3.x), `tasks-cloudflare-access.md`
(T1.1, T1.2, T3.1–T3.4, T4.3 → todas `[x]`).

## Archivos

### Nuevos
- `docs/internal/audit-viewer/functions/api/audit_query.js` — Pages Function proxy same-origin
  (`onRequestPost`). Lee `Cf-Access-Jwt-Assertion` (ausente/vacío → 401 sin llamar a la EF). Con JWT:
  `fetch` POST a `env.MITROPERO_AUDIT_EF_URL` reenviando SOLO 3 headers — `Content-Type` +
  `Cf-Access-Jwt-Assertion` (del request) + `X-Mitropero-Proxy-Secret` (de `env.MITROPERO_AUDIT_PROXY_SECRET`,
  §6-bis) — + el body crudo (`request.text()`). Devuelve la respuesta upstream tal cual (status + body). Sin
  lógica de negocio; no confía en ningún otro header del cliente.
- `docs/internal/audit-viewer/functions/api/audit_query.test.mjs` — test node:test (6/6 verde), `fetch`
  mockeado. Corre MANUAL: `node --test docs/internal/audit-viewer/functions/api/audit_query.test.mjs`. NO
  está cableado a `scripts/run-tests.mjs` (vive fuera del slice `docs/internal/**`, y ese orquestador usa
  listas explícitas de archivos, sin auto-discovery).

### Modificados
- `docs/internal/audit-viewer/index.html` — eliminado el `<main id="view-login">` completo (card + form
  email/password + copy + `#login-error`), el `<script>` de supabase-js (+ SRI), el `<span id="whoami">` y su
  CSS, y el CSS login-exclusivo (`#view-login`, `.card*`, `#login-error`). El `<div id="view-console">` ya no
  tiene `hidden` (única vista, arranca montada). "Salir" pasó de `<button id="logout">` a
  `<a href="/cdn-cgi/access/logout">` (cierra la sesión del borde de Access). Se conservaron las reglas CSS
  compartidas por los filtros (`form label`, `input[type=text|date]`, `select`, `input:focus`). CSP `<meta>`:
  `script-src 'self'` + `connect-src 'self'`.
- `docs/internal/audit-viewer/app.js` — eliminados `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`createClient`/`sb`,
  `state.accessToken`/`state.email`, `doLogin`/`doLogout`/`showLogin`/`showConsole`/`setLoginError`, el wiring
  de `#login-form`/`#logout`, la rama `403 not_staff` y `ERROR_COPY.not_staff`. `EF_URL = '/api/audit_query'`
  (same-origin). `callEf`: headers = solo `Content-Type: application/json` (sin `Authorization`/`apikey`).
  `init` arranca en la consola. `handleError` en `401` → `setNotice('Tu sesión expiró, recargá la página.')`
  sin pintar datos. **Sin cambios**: `collectFilters`, `renderRows`, `renderDiff`/`makeVal` (textContent,
  cero innerHTML), `formatDate` es-AR, paginación por `next_cursor`, mapas es-AR.
- `docs/internal/audit-viewer/_headers` — CSP `script-src 'self'` + `connect-src 'self'`; el resto
  (`X-Robots-Tag`, `Referrer-Policy`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `object-src 'none'`,
  `Permissions-Policy`, `X-Content-Type-Options`) sin cambios.

## Verificación (estática — el flujo end-to-end es deploy-gated: no hay EF/Access desplegados)

- `node --check` → OK en `app.js`, `functions/api/audit_query.js`, `functions/api/audit_query.test.mjs`.
- `node --test .../audit_query.test.mjs` → **6/6 pass, 0 fail**.
- grep `innerHTML` en el slice web → 0 (única aparición: un comentario "JAMÁS con innerHTML").
- grep código: NO queda `supabase`/`createClient`/`SUPABASE_`/`window.supabase`/`.innerHTML`/
  `'Authorization'`/`'apikey'`/`signInWithPassword`/`state.accessToken`/`state.email` en código (solo en
  comentarios explicativos). `EF_URL === '/api/audit_query'`. CSP correcta en `<meta>` y `_headers`.
- Cross-check DOM: todos los `$('id')`/`getElementById('id')` de `app.js` resuelven a elementos presentes en
  `index.html` (sin referencias colgantes a `login-*`/`logout`/`whoami`/`view-login`). Sin llamadas colgantes
  a las funciones eliminadas.
- `node scripts/check.mjs --fast` → verde (estructura + feature_list + higiene + lint anti-hardcode 0
  violaciones). NO se corrió la suite completa de 22 stages: (a) el cambio es docs-only y ningún stage cubre
  `docs/` (typecheck/tests son sobre `app/`, `supabase/`, `scripts/`); (b) el lint anti-hardcode escanea solo
  `app/app` + `app/src/components`; (c) hay una corrida de backend en paralelo golpeando la DB remota
  compartida → correr las 16 suites RLS acá arriesga un flake de rate-limit espurio (ver memoria
  "check rojo = rate-limit"). La verificación relevante para el slice es estática y está cubierta.

## Trazabilidad (RCFA → test/verificación)

| Req | Cubierto por |
|---|---|
| RCFA.1.1 (Function `POST /api/audit_query`, solo POST) | import expone solo `onRequestPost` (Pages rutea 405 al resto); todos los tests de `audit_query.test.mjs` ejercen el handler |
| RCFA.1.2 (401 sin header, sin fetch) | test "sin Cf-Access-Jwt-Assertion → 401" + "header vacío → 401" (asertan `fetch.calls.length === 0`) |
| RCFA.1.3 (reenvía JWT + body crudo + Content-Type + proxy secret) | test "con JWT → reenvía a la EF …" (verifica url, method, los 3 headers y `body` idéntico) |
| RCFA.1.4 (respuesta upstream tal cual) | test "con JWT" (200) + "status upstream tal cual, ej. 400" |
| RCFA.1.5 (sin credenciales de negocio; solo EF URL vía binding + el proxy secret M-1) | code review + grep (no anon key/DB creds); §6-bis explícito |
| RCFA.1.6 (no deriva confianza de headers del cliente) | test "NO propaga otros headers del cliente" (Authorization/apikey/proxy-secret spoofeado NO llegan; el proxy secret sale del env) |
| RCFA.3.1 (sin login view) | grep: no `#view-login`, no form email/password |
| RCFA.3.2 (sin supabase-js + config) | grep: no `<script>` supabase-js, no `SUPABASE_*`/`createClient` |
| RCFA.3.3 (arranca en consola) | `#view-console` sin `hidden`; `init` sin gate de login |
| RCFA.3.4 (fetch same-origin sin Authorization/apikey) | `EF_URL='/api/audit_query'`; `callEf` headers solo `Content-Type` (grep) |
| RCFA.3.5 (401 → recargá; sin 403 not_staff) | `handleError` 401 → `ERROR_COPY.unauthorized='Tu sesión expiró, recargá la página.'`; rama `not_staff` eliminada (grep) |
| RCFA.3.6 (CSP) | grep `<meta>` + `_headers`: `script-src 'self'`, `connect-src 'self'` |
| RCFA.3.7 (filtros/tabla/diff/es-AR/paginación intactos) | diff acotado a auth/transporte; `renderRows`/`renderDiff`/`collectFilters`/`formatDate` sin cambios; grep innerHTML=0 |

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:
- **¿La web todavía carga supabase-js o autentica?** No. `<script>` de jsDelivr eliminado, `#view-login`
  eliminado, cero `createClient`/`SUPABASE_*` en código. Además la CSP `script-src 'self'` bloquearía
  cualquier script externo aunque quedara.
- **¿El fetch del cliente lleva algún token?** No. `callEf` manda solo `Content-Type`; la cookie de Access
  (HttpOnly) viaja sola por ser same-origin. No hay `Authorization`/`apikey`.
- **¿La Function confía en algún header del cliente además del Access-JWT?** No. Test dedicado: un cliente
  que manda `Authorization`, `apikey` y hasta un `X-Mitropero-Proxy-Secret` spoofeado NO logra que ninguno
  llegue a la EF; el proxy secret que sí se manda sale de `env`, no del cliente. Se envían exactamente 3
  headers.
- **¿El proxy secret es fail-closed?** Sí. Si `env.MITROPERO_AUDIT_PROXY_SECRET` no está seteado, la Function
  NO manda el header (evita el error de `fetch` por header `undefined`) → la EF, que lo exige, responde 401.
  Nunca abre el acceso por omisión. Test lo cubre.
- **¿Cero innerHTML con datos del record?** Sí. `renderDiff`/`renderRows`/`makeVal` intactos, todo por
  `textContent`. grep innerHTML = 0.
- **¿Referencias DOM colgantes tras sacar login?** No. Cross-check: todos los ids referenciados por `app.js`
  existen en `index.html`; sin llamadas a `showConsole`/`doLogin`/etc. eliminadas.
- **Edge encontrado (documentado, no defecto):** si la sesión de Access expira, el request a
  `/api/audit_query` puede ser interceptado por Access en el borde con un `302` al login (la Function ni
  corre) → el `fetch` cross-origin falla → cae en la rama de error de red ("No se pudo conectar con el
  servidor. Revisá tu conexión."). El contrato primario RCFA.3.5 (un `401` real de la Function/EF → "recargá")
  sí se muestra. El design §7.2 contempla este caso como "error de red / se sugiere recargar" — el
  comportamiento lo satisface. No se tocó la copy de red genérica para no romper el caso offline legítimo.

Nada que corregir: los hallazgos anteriores ya estaban cerrados en la implementación; el edge del 302 es
comportamiento aceptado por el design.

## Reconciliación de specs (paso 9)

El as-built del slice web coincide con el design `-cloudflare-access` §2 (contrato base de la Function) +
§6-bis (fold del M-1: la Function manda `X-Mitropero-Proxy-Secret`). NO hay drift: el design ya describe el
proxy secret en §6-bis ("amenda §2: la Function ahora SÍ tiene UN secret — solo éste"), que es exactamente lo
construido. Único matiz de lectura: el bloque de código inline de §2 y la nota "(RCFA.1.5) proxy sin secretos"
preceden al fold del M-1; §6-bis los amenda explícitamente. Dejé la nota de reconciliación en
`tasks-cloudflare-access.md` bajo **T1.2** (RCFA.1.5 se lee "sin credenciales de negocio/DB ni anon key"; el
proxy secret es defensa en profundidad, no una credencial de negocio). NO edité los §2/§6-bis del `design-…`
ni los EARS de `requirements-…`: (a) el design ya es internamente consistente (§2 base + §6-bis fold), y (b)
la corrida de backend está reconciliando esos mismos archivos compartidos (sus tasks T6.1/T6.2) en paralelo —
evité tocar sus secciones para no colisionar. `tasks-cloudflare-access.md`: mis tasks (T1.1, T1.2, T3.1–T3.4,
T4.3) quedaron `[x]`.

## Qué queda (deploy-gated / Gate 2.5) — NO es de este slice cerrar

- **Gate 2.5 (veto de diseño liviano + captura), deploy-gated:** el visor es un sitio estático standalone,
  NO parte del harness `app/e2e` (que es Playwright contra la app RN/Expo web). El flujo real no renderiza sin
  la Access application + la EF desplegadas (el `fetch` a `/api/audit_query` necesita la Function detrás de
  Access). Por eso la captura del estado "consola sin login" se toma **post-deploy** contra la página viva
  (tasks-cloudflare-access.md **T5.5**), y el leader vetea el diseño ahí. El chrome de la consola (topbar,
  filtros, tabla, diff) NO cambió respecto de la v1 ya aprobada en el Gate 2.5 anterior — el único cambio
  visual es la ausencia de la pantalla de login (se entra directo a la consola) y "Salir" como link.
- **Deploy (gateado, OK de Raf — acciones externas):**
  - `MITROPERO_AUDIT_EF_URL` (URL pública de la EF) como env del proyecto Pages.
  - `MITROPERO_AUDIT_PROXY_SECRET`: el leader lo genera random y lo setea en AMBOS lados (env de Pages + secret
    de la EF) — mismo valor.
  - Deploy de la web + la Pages Function a Cloudflare Pages, todo detrás de la Access application (Raf la crea:
    policy allow por mails + One-time PIN; pasa team domain + AUD tag para los secrets de la EF).
  - Smoke T5.5: (a) directo a la EF sin JWT → 401; (b) desde el visor tras Access → 200 con filas; (c) JWT con
    `aud` de otra app → 401.

## Estado

Código del slice web + Pages Function completo y verificado estático. Tests de la Function 6/6.
Listo para reviewer + Gate 2. No marco `done` (espera al reviewer + deploy gateado + Gate 2.5 post-deploy).
