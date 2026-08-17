# Requirements (delta spec 24) — Auth del visor por Cloudflare Access

**Status**: `spec_ready` (delta de spec 24 — Edge Function + web interna). Gate 0 cerrado en
`context-cloudflare-access.md` (Raf, 2026-08-17).
**Fecha**: 2026-08-17
**Autor**: spec_author

> **Delta, no refundición** (ADR-028 Nivel B). Estas requirements EXTIENDEN spec 24 sin reescribir
> `requirements.md` base. Cambian el **modelo de auth** del visor: de login Supabase (usuarios de la app,
> `requireUser` + allowlist `MITROPERO_STAFF_USER_IDS`) a **Cloudflare Access** (identidad organizacional
> aislada, provisionada por Raf; login por One-time PIN). Todo lo demás de la feature —filtros validados,
> query parametrizada, paginación, rate-limit, muro fail-closed, no-leak, resolución de actor/labels, render
> del diff— queda **igual**.
>
> Numeradas `RCFA.n` para no colisionar con los IDs estables de spec 24. Fuente de verdad primaria: el
> contexto refinado y aprobado `specs/active/24-audit-viewer/context-cloudflare-access.md`.
>
> **Naming (rebrand):** todo identificador NUEVO nace `miTropero`/`mitropero` (secrets `CF_ACCESS_*`,
> binding `MITROPERO_AUDIT_EF_URL`, headers `X-Mitropero-*` heredados de `serveEf`).

## Glosario (delta)

- **Access** — Cloudflare Access (Zero Trust). Gatea en el borde: nadie llega al visor sin pasar su policy
  (allowlist de mails + One-time PIN). Inyecta el header `Cf-Access-Jwt-Assertion` (JWT firmado RS256) en los
  requests server-side que pasan por él.
- **Pages Function** — función serverless de Cloudflare Pages en el MISMO dominio del visor
  (`docs/internal/audit-viewer/functions/api/audit_query.js`). Proxy fino same-origin: recibe el
  `Cf-Access-Jwt-Assertion` (que Access inyecta) y lo reenvía a la EF.
- **AUD tag** — el `aud` de NUESTRA Access application (no del team). Identifica la app puntual; un JWT
  emitido para otra app del mismo team tiene otro `aud`.
- **team domain** — `<team>.cloudflareaccess.com`. Emisor (`iss`) de los JWT y host del JWKS
  (`/cdn-cgi/access/certs`).

---

## US-A — Pages Function: proxy same-origin que reenvía el JWT de Access

> Como staff, quiero que la web (que no puede leer la cookie HttpOnly de Access ni llamar cross-dominio a la
> EF) llegue a la EF a través de una función del mismo dominio que reenvíe el JWT de Access.

- **RCFA.1.1** — El sistema deberá proveer una Pages Function en
  `docs/internal/audit-viewer/functions/api/audit_query.js` que atienda `POST /api/audit_query` same-origin.
- **RCFA.1.2** — Cuando la Pages Function recibe un request, el sistema deberá leer el header
  `Cf-Access-Jwt-Assertion` del request entrante (inyectado por Access server-side); si el header está
  ausente o vacío, deberá responder `401` sin llamar a la EF.
- **RCFA.1.3** — El sistema deberá hacer `fetch` `POST` a la EF `audit_query` de Supabase reenviando el
  header `Cf-Access-Jwt-Assertion` + el body del `POST` + `Content-Type: application/json`.
- **RCFA.1.4** — El sistema deberá devolver al cliente la respuesta de la EF tal cual (status + body), sin
  transformarla.
- **RCFA.1.5** — El sistema no deberá contener secretos, credenciales de base ni lógica de negocio en la
  Pages Function; solo deberá conocer la URL pública de la EF vía binding/env de Pages
  (`MITROPERO_AUDIT_EF_URL`).
- **RCFA.1.6** — El sistema no deberá derivar identidad ni confianza de headers provistos por el cliente; la
  única entrada de confianza de la Pages Function es el `Cf-Access-Jwt-Assertion` que Access inyecta, y la
  autorización real la hace la EF verificando ese JWT criptográficamente (RCFA.2.x).

---

## US-B — EF `audit_query`: swap de auth a JWT de Cloudflare Access verificado

> Como auditor de seguridad, quiero que la EF deje de confiar en Supabase Auth y solo acepte un JWT de Access
> verificado criptográficamente contra el JWKS del team, con `aud` EXACTO de nuestra app, sin ningún bypass.

- **RCFA.2.1** — El sistema deberá quitar de la EF la resolución de usuario por `requireUser` (JWT de
  Supabase) y el gate por `MITROPERO_STAFF_USER_IDS`. *(Supersede R1.3, R1.4, R1.5, R1.6, R1.7.)*
- **RCFA.2.2** — Cuando la EF recibe un request `POST`, el sistema deberá tomar el JWT de Access
  exclusivamente del header `Cf-Access-Jwt-Assertion`; si ese header está ausente o vacío, deberá responder
  `401` `unauthorized` sin leer el audit.
- **RCFA.2.3** — El sistema deberá verificar la firma del JWT con algoritmo **RS256** contra el JWKS del team
  (`https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`), restringiendo explícitamente los algoritmos
  aceptados a `["RS256"]` (rechaza `alg:none`, HS256 y cualquier algorithm-substitution).
- **RCFA.2.4** — El sistema deberá cachear las claves del JWKS entre invocaciones (no refetchear en cada
  request), refrescando ante un `kid` desconocido (rotación de claves).
- **RCFA.2.5** — El sistema deberá validar que el claim `aud` del JWT sea EXACTAMENTE igual a
  `CF_ACCESS_AUD` (el AUD tag de NUESTRA Access application); un `aud` distinto —incluido el de otra app del
  mismo team— deberá responder `401`.
- **RCFA.2.6** — El sistema deberá validar que el claim `iss` del JWT sea `https://<CF_ACCESS_TEAM_DOMAIN>`;
  un `iss` distinto deberá responder `401`.
- **RCFA.2.7** — El sistema deberá validar que el JWT no esté vencido (`exp`); un token vencido deberá
  responder `401`.
- **RCFA.2.8** — Si la verificación falla por cualquier motivo (firma inválida, `aud`/`iss` distinto, `exp`
  vencido, forma inválida, JWKS inalcanzable), entonces el sistema deberá responder `401` `unauthorized` y no
  ejecutar ninguna lectura del audit (fail-closed).
- **RCFA.2.9** — El sistema no deberá aceptar el JWT sin verificar su firma criptográfica ni confiar en
  ningún header de identidad no verificado; la identidad de staff sale SOLO del JWT de Access verificado.
- **RCFA.2.10** — El sistema deberá extraer el `email` del claim del JWT verificado; si el claim `email` está
  ausente o no es un string, deberá responder `401`.
- **RCFA.2.11** — Si falta cualquiera de los secrets `CF_ACCESS_TEAM_DOMAIN` o `CF_ACCESS_AUD`, entonces el
  sistema deberá rechazar el request (`401`) y nunca abrir el acceso (fail-closed ante config ausente).
- **RCFA.2.12** — El sistema deberá retirar el uso y el secret `MITROPERO_STAFF_USER_IDS` de la EF (deja de
  existir la allowlist por uuid; la allowlist ahora vive en la policy de Access).
- **RCFA.2.13** — Donde el secret **opcional** `CF_ACCESS_EMAIL_ALLOWLIST` esté presente y no vacío, el
  sistema deberá además exigir que el `email` verificado pertenezca a esa allowlist (`403`/`401` si no).
  *(Defensa en profundidad; default recomendado: ausente ⇒ Access es la autoridad. Ver design §6.)*
- **RCFA.2.14** — El sistema deberá keyear el rate limit por el `email` verificado del JWT de Access, en
  reemplazo del `user.id` del baseline (preservando el cap y la ventana de R3.5).
- **RCFA.2.15** — El sistema no deberá modificar la validación de filtros (`query.ts`), la query
  parametrizada (`db.ts`), la paginación, el muro fail-closed, la resolución de actor/labels ni el no-leak;
  los requirements baseline R2.x, R3.1–R3.4, R3.6, R4.x, R5.x, R7.x quedan intactos y verificables sin
  cambios.

---

## US-C — Web: sin login propio, llama a la Pages Function same-origin

> Como staff, quiero abrir el visor y ya estar dentro (Access me gateó en el borde), sin loguear otra vez.

- **RCFA.3.1** — El sistema deberá eliminar de `index.html` la vista de login email/password y su copy; la
  página ya no autentica. *(Supersede R6.2.)*
- **RCFA.3.2** — El sistema deberá eliminar la carga de `@supabase/supabase-js` (el `<script>` de CDN + su
  SRI) y toda configuración de cliente/anon key/URL de Supabase de la web; la web ya no requiere secretos ni
  la anon key. *(Supersede R6.11.)*
- **RCFA.3.3** — Cuando se abre la página, el sistema deberá arrancar directamente en la consola (filtros +
  resultados), sin gate de login en el cliente.
- **RCFA.3.4** — El sistema deberá invocar `/api/audit_query` **same-origin** por `fetch` `POST` con los
  filtros en el body (nunca en la URL) y **sin** header `Authorization` ni `apikey`; la cookie de Access
  viaja same-origin automáticamente. *(Supersede R6.4.)*
- **RCFA.3.5** — Si la respuesta es `401`, entonces el sistema deberá mostrar un aviso de "sesión expirada,
  recargá la página" (Access re-autentica al recargar) y no pintar datos del audit. *(Supersede R6.9: ya no
  existe el caso `403 not_staff`.)*
- **RCFA.3.6** — El sistema deberá actualizar el CSP (en `_headers` y en el `<meta http-equiv>`): quitar
  `https://cdn.jsdelivr.net` de `script-src` y apuntar `connect-src` a `'self'` (same-origin), retirando el
  origen de Supabase.
- **RCFA.3.7** — El sistema no deberá cambiar el formulario de filtros, el render de la tabla, el diff
  expandible (sin `innerHTML`, §8 LOW-3), el formato es-AR ni la paginación por cursor; los requirements
  baseline R6.3, R6.5–R6.8 y R5.4/R5.5 se preservan (solo cambia el transporte a same-origin).

---

## US-D — Access como autoridad del borde + invariantes de deploy

> Como miTropero, quiero que el visor viva detrás de una Access application con allowlist de mails y que la
> EF quede como único gate criptográfico, sin migración ni degradar el muro fail-closed.

- **RCFA.4.1** — El sistema deberá servir la web y la Pages Function detrás de una **misma** Cloudflare
  Access application self-hosted sobre el dominio del visor, de modo que Access inyecte
  `Cf-Access-Jwt-Assertion` server-side en los requests a `/api/*`.
- **RCFA.4.2** — La Access application deberá tener una policy de allow por mails específicos (staff) y
  One-time PIN como método de login. *(Provisiona Raf en el dashboard de Zero Trust.)*
- **RCFA.4.3** — El sistema deberá tomar el team domain y el AUD tag de la Access application y setearlos como
  los secrets `CF_ACCESS_TEAM_DOMAIN` y `CF_ACCESS_AUD` de la EF antes de habilitar el nuevo gate.
  *(Insumo de Raf → deploy gateado.)*
- **RCFA.4.4** — El sistema deberá desplegar la EF `audit_query` con `verify_jwt=false`: el gateway de
  Supabase deja de exigir un JWT de Supabase, y la EF queda como único gate vía el JWT de Access verificado
  (RCFA.2.x). Un request directo a la EF sin un JWT de Access válido para nuestro `aud` deberá responder
  `401`.

---

## Requirements baseline SUPERSEDED por este delta

| Baseline | Qué decía | Reemplazo |
|---|---|---|
| R1.3 | `requireUser` sobre JWT de Supabase; 401 si no hay sesión | RCFA.2.2 + RCFA.2.8 (401 si no verifica el JWT de Access) |
| R1.4 | allowlist desde `MITROPERO_STAFF_USER_IDS` | RCFA.2.12 (se retira) + RCFA.4.2 (allowlist = policy de Access) |
| R1.5 | `403 not_staff` si `user.id` ∉ allowlist | Sin equivalente: la no-pertenencia se corta en Access (borde). Fallo de auth en la EF = `401` (RCFA.2.8) |
| R1.6 | pertenencia solo del `user.id` del JWT, nunca del body/headers | RCFA.2.9 (identidad solo del JWT de Access verificado) |
| R1.7 | secret ausente ⇒ nadie es staff (`403`) | RCFA.2.11 (config ausente ⇒ fail-closed `401`) |
| R6.2 | login Supabase (supabase-js) + JWT en memoria | RCFA.3.1 + RCFA.3.3 (Access gatea en el borde; sin login propio) |
| R6.4 | `fetch` a la EF con `Authorization: Bearer <JWT>` | RCFA.3.4 (`/api/audit_query` same-origin, sin `Authorization`) |
| R6.9 | mensaje "sin acceso" ante `403 not_staff` | RCFA.3.5 (ya no hay `403 not_staff`; `401` ⇒ recargar) |
| R6.11 | web sin secretos: solo URL Supabase + anon key | RCFA.3.2 (web sin URL Supabase ni anon key) |

## Requirements baseline PRESERVADOS (sin cambios)

- **R1.1, R1.2** — EF `audit_query` con `serveEf`; `405` a método ≠ POST.
- **R2.1–R2.9** — filtros en el body, validación autoritativa server-side, SQL parametrizado.
- **R3.1–R3.4, R3.6** — orden `id DESC`, cap `100`, cursor `before`, `next_cursor`, `id` como string.
- **R3.5** — rate limit (re-keyeado por email en RCFA.2.14; el cap/ventana no cambian).
- **R4.1–R4.6** — conexión directa a Postgres, sin credenciales al cliente, muro fail-closed intacto, sin
  migración, columnas forenses, cross-tenant salvo filtro.
- **R5.1–R5.5** — resolución de actor + labels es-AR + diff legible.
- **R7.1–R7.5** — no-leak en logs, errores opacos, PII a staff documentada, scraping acotado.

---

## Mapa de trazabilidad (context-cloudflare-access.md → RCFA)

| Origen (context / alcance) | Requirements |
|---|---|
| Pages Function proxy fino; 401 si no viene el header | RCFA.1.1, RCFA.1.2, RCFA.1.5, RCFA.1.6 |
| Reenvía header + body a la EF, respuesta tal cual | RCFA.1.3, RCFA.1.4 |
| Swap: quitar `requireUser` + `MITROPERO_STAFF_USER_IDS` | RCFA.2.1, RCFA.2.12 |
| Verificar JWT de Access: RS256 + JWKS del team + cache | RCFA.2.2, RCFA.2.3, RCFA.2.4 |
| `aud` EXACTO de nuestra app; `iss`/`exp` | RCFA.2.5, RCFA.2.6, RCFA.2.7 |
| Fallo ⇒ 401, sin bypass; extraer email | RCFA.2.8, RCFA.2.9, RCFA.2.10 |
| Secrets nuevos + fail-closed ante ausencia | RCFA.2.11, RCFA.4.3 |
| Defensa en profundidad opcional (email allowlist) | RCFA.2.13 |
| Rate-limit re-key + resto de la EF igual | RCFA.2.14, RCFA.2.15 |
| Web sin login/supabase-js; arranca en consola; same-origin | RCFA.3.1–RCFA.3.4 |
| 401 ⇒ recargar; CSP; resto de la web igual | RCFA.3.5, RCFA.3.6, RCFA.3.7 |
| Access application + policy + PIN (Raf) | RCFA.4.1, RCFA.4.2 |
| EF única puerta; directo sin JWT ⇒ 401; sin migración | RCFA.4.4, RCFA.2.15 (R4.x) |
