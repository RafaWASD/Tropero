# Tasks (delta spec 24) — Auth del visor por Cloudflare Access

> Ledger del delta ADR-028 Nivel B. El `tasks.md` base NO se toca. Fuente: `requirements-cloudflare-access.md`
> + `design-cloudflare-access.md`. Cada task cubre ≥1 `RCFA.n`. Los pasos externos (Cloudflare / Supabase
> deploy) van **gateados** (OK de Raf) y los insumos de Raf están marcados **[RAF]**.

## Fase 0 — Insumos de Raf (bloqueantes del deploy, no del código)

- [ ] **T0.1 [RAF]** — Crear la Cloudflare Access application self-hosted sobre el dominio del visor (cubre la
  web + `/api/*`). Cubre: RCFA.4.1.
- [ ] **T0.2 [RAF]** — Policy: *Allow* include = Emails de staff (Raf + Facundo); login method = One-time PIN.
  Cubre: RCFA.4.2.
- [ ] **T0.3 [RAF]** — Pasar el **team domain** (`<team>.cloudflareaccess.com`) + el **AUD tag** de la app.
  Cubre: RCFA.4.3.

## Fase 1 — Pages Function (proxy same-origin)

- [x] **T1.1** — Crear `docs/internal/audit-viewer/functions/api/audit_query.js` con `onRequestPost`: lee
  `Cf-Access-Jwt-Assertion`; ausente → `401` sin llamar a la EF. Cubre: RCFA.1.1, RCFA.1.2.
- [x] **T1.2** — `fetch` `POST` a `env.MITROPERO_AUDIT_EF_URL` reenviando `Cf-Access-Jwt-Assertion` + el body
  crudo + `Content-Type: application/json`; devolver la respuesta upstream tal cual (status + body). Sin
  lógica de negocio, sin confiar en otros headers del cliente. Cubre: RCFA.1.3, RCFA.1.4, RCFA.1.5, RCFA.1.6.
  **[As-built §6-bis (M-1): la Function SÍ manda UN secret, `X-Mitropero-Proxy-Secret` desde
  `env.MITROPERO_AUDIT_PROXY_SECRET` (fail-closed: si no está en el env, no se manda → la EF rechaza 401).
  RCFA.1.5 se lee "sin credenciales de negocio/DB ni anon key" — el proxy secret es defensa en profundidad
  del M-1, no una credencial de negocio.]**

## Fase 2 — EF `audit_query`: swap de auth a JWT de Access

- [x] **T2.1** — Crear `supabase/functions/audit_query/access.ts`: `verifyAccessJwt(token)` con
  `npm:jose@5.9.6` (pin EXACTO) — `createRemoteJWKSet` cacheado a nivel módulo + `jwtVerify` con
  `algorithms:['RS256']`, `issuer=https://<team>`, `audience=CF_ACCESS_AUD`. Fail-closed si faltan
  `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` (→ `401`); cualquier fallo de verificación → `HttpError(401)`;
  extrae `email` (string no vacío, lowercased) o `401`. Cubre: RCFA.2.2–RCFA.2.11.
- [x] **T2.2** — `parseEmailAllowlist(secret)`: `null` si ausente/vacío (Access es autoridad), `Set<string>`
  lowercased si poblado. Cubre: RCFA.2.13. **[Reconciliado as-built: vive en `access-helpers.ts` (módulo puro
  nuevo), NO en `query.ts` — la corrida fijó `query.ts` intacto; ver design §3.3.]**
- [x] **T2.3** — Editar `index.ts`: quitar `createUserClient`/`requireUser`/`parseStaffAllowlist` + el gate
  `MITROPERO_STAFF_USER_IDS`. Poner: **[M-1] secreto proxy `X-Mitropero-Proxy-Secret` en tiempo constante
  ANTES del JWT (fail-closed)** → leer `Cf-Access-Jwt-Assertion` (ausente → `401`) → `verifyAccessJwt` → hook
  opcional `parseEmailAllowlist` → rate limit keyeado por `email`. Pasos validateFilters/queryAudit/render SIN
  cambios. Cubre: RCFA.2.1, RCFA.2.12, RCFA.2.13, RCFA.2.14, RCFA.2.15 + §6-bis (M-1).
- [x] **T2.4** — `supabase/config.toml`: agregar `[functions.audit_query] verify_jwt = false` (patrón del
  bloque `health`). Cubre: RCFA.4.4.
- [x] **T2.5** — Confirmado `query.ts` y `db.ts` intactos (`git diff --stat` vacío; grep: `sql.unsafe`/concat
  solo en el banner de comentario, no en código — §8 M2 válido; `npm:postgres@3.4.5` sin cambios — M3).
  Cubre: RCFA.2.15 (R2.x/R4.x/R5.x/R7.x preservados).

## Fase 3 — Web sin login

- [x] **T3.1** — `index.html`: eliminada la vista `#view-login` (card + form + copy + `#login-error`) y el
  `<script>` de supabase-js (+ SRI); también `#whoami` (la web no conoce el email). "Salir" = link a
  `/cdn-cgi/access/logout`. La consola arranca visible (sin `hidden`). CSP `<meta>`: `script-src 'self'`,
  `connect-src 'self'`. Cubre: RCFA.3.1, RCFA.3.2, RCFA.3.3, RCFA.3.6.
- [x] **T3.2** — `app.js`: eliminados config Supabase / `createClient` / `doLogin`/`doLogout`/`showLogin`/
  `showConsole`/`setLoginError` / `state.accessToken`/`state.email` y el wiring de login/logout.
  `EF_URL = '/api/audit_query'` (same-origin); `callEf` sin `Authorization`/`apikey`. `init` arranca en la
  consola. `handleError`: `401` → "Tu sesión expiró, recargá la página."; quitada la rama `403 not_staff`.
  Cubre: RCFA.3.3, RCFA.3.4, RCFA.3.5.
- [x] **T3.3** — `_headers`: CSP `script-src 'self'` (sin jsDelivr) + `connect-src 'self'` (sin origen
  Supabase); resto igual. Cubre: RCFA.3.6.
- [x] **T3.4** — Confirmado: filtros / tabla / diff (textContent, §8 LOW-3 — grep `innerHTML` = 0) / formato
  es-AR / paginación por cursor sin cambios. Cubre: RCFA.3.7.

## Fase 4 — Tests (foco Gate 1)

- [ ] **T4.1** — Test `access.test.ts` (node:test, jose): generar par RS256 local, firmar un token y exponer
  su JWK por un JWKS mockeado. Falsificar aud/iss/exp/firma/alg/email/config. Cubre: RCFA.2.3, RCFA.2.5–2.11.
  **[Reconciliado DEPLOY-GATED: `access.ts` importa `npm:jose@5.9.6` (specifier Deno-only, NO resoluble por
  node:test ni por el ts-ext-resolver del harness). La corrida de backend downscopeó los tests puros a los
  helpers de `access-helpers.ts`; la verificación jose/JWKS es INTEGRACIÓN, se ejerce en el smoke end-to-end
  del deploy (T5.5: directo sin JWT → 401 · desde el visor → 200 · aud de otra app → 401). La garantía
  estática queda en el código: `algorithms:['RS256']` + `audience`/`issuer` explícitos + fail-closed.]**
- [x] **T4.2** — Test `parseEmailAllowlist` (en `access-helpers.test.ts`): ausente/vacío/solo-comas → `null`
  (no filtra); poblado → `Set` lowercased + trim; email fuera → excluido. **+ [M-1]** tests de
  `proxySecretMatches`/`timingSafeEqualBytes`: fail-closed env ausente, header exigido, match byte-exacto,
  sin early-return por contenido. Registrado en `run-tests.mjs`. Cubre: RCFA.2.13 + §6-bis (M-1).
- [x] **T4.3** — Test de la Pages Function (proxy) — `docs/internal/audit-viewer/functions/api/audit_query.test.mjs`
  (node:test, `fetch` mockeado; 6/6 verde). Falsifica: sin header/header vacío → 401 sin fetch · con JWT →
  reenvía a `MITROPERO_AUDIT_EF_URL` con JWT + proxy secret (del env) + Content-Type + body crudo · status
  upstream tal cual (200/400) · NO propaga Authorization/apikey/proxy-secret spoofeado del cliente · sin proxy
  secret en env → no manda el header. Corre MANUAL (`node --test …`), no cableado a `run-tests.mjs` (vive fuera
  del slice `docs/internal/**`). Cubre: RCFA.1.2, RCFA.1.3, RCFA.1.4, RCFA.1.6.
- [ ] **T4.4** — Test de handler `index.ts` (mockeando `access.ts` + `db.ts`). Cubre: RCFA.2.2, RCFA.2.8,
  RCFA.2.13, RCFA.2.14. **[Reconciliado DEPLOY-GATED: `index.ts` invoca `serveEf`/`Deno.serve`/`Deno.env` en
  el top-level del módulo (Deno-only) → NO importable por node:test sin refactor. La lógica del gate se
  falsifica por sus helpers puros (`access-helpers.test.ts`, T4.2) + el smoke end-to-end (T5.5). Los caminos
  401/403/200 del handler los cubre T5.5.]**
- [x] **T4.5** — Suite existente `query.test.ts` verde (22 pass) tras el swap — los helpers de filtros no
  cambian (`query.ts` intacto). `parseStaffAllowlist` queda como DEAD CODE en `query.ts` (ya no se importa
  desde `index.ts`); no se removió porque la corrida fijó `query.ts` intacto — item menor para el reviewer.
  Cubre: RCFA.2.15.

## Fase 5 — Deploy (gateado — OK de Raf, por acción externa)

- [ ] **T5.1 [RAF/gate]** — Setear secrets de la EF: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`; **retirar**
  `MITROPERO_STAFF_USER_IDS`. Cubre: RCFA.2.11, RCFA.2.12, RCFA.4.3.
- [ ] **T5.2 [gate]** — Generar + commitear `deno.lock` de la function con `jose` pineado (`deno cache`,
  toolchain Deno + red npm — gateado, §8 M3). Cubre: RCFA.2.3 (dep fijada).
- [ ] **T5.3 [gate]** — Deploy de la EF `audit_query` con `--no-verify-jwt`. Cubre: RCFA.4.4.
- [ ] **T5.4 [RAF/gate]** — Proyecto Pages: setear `MITROPERO_AUDIT_EF_URL`; deploy de la Pages Function + la
  web actualizada, detrás de la Access application. Cubre: RCFA.1.5, RCFA.4.1.
- [ ] **T5.5 [gate]** — Verificación end-to-end: (a) directo a la EF sin JWT → `401`; (b) desde el visor (tras
  Access) → `200` con filas; (c) JWT con `aud` de otra app → `401`. Captura de la consola sin login (veto de
  diseño liviano, Gate 2.5). Cubre: RCFA.2.5, RCFA.2.8, RCFA.4.4, RCFA.3.3.

## Reconciliación (al cerrar)

- [ ] **T6.1** — Foldear al `design.md` base (bloque "Deltas posteriores") un puntero a este delta + 1 línea
  + estado; nota as-built bajo R1.3–R1.7 y R6.2/R6.4/R6.9/R6.11 (superseded). No reescribir los EARS base.
- [ ] **T6.2** — Actualizar el `context.md` base o su índice si corresponde (el modelo de auth cambió).
