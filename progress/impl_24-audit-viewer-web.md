baseline_commit: 3d3afc9d7ff4eea12f4acd00205060914f8ce6be

# impl 24 — Visor web interno del audit log (PÁGINA WEB)

> Corrida acotada: **solo `docs/internal/audit-viewer/`**. La Edge Function
> (`supabase/functions/audit_query/**`) la hace otra corrida en paralelo; acá se sigue el contrato del
> `design.md` §2.1 sin tocar `supabase/`.

## Alcance de esta corrida
Fase Web del `tasks.md`: **T7–T13** (`index.html`, `app.js`, `_headers`). Las tasks EF (T1–T6), tests
de EF (T14–T18), guard de muro (T18), smoke deploy (T19) y deploy (T20–T22) NO son de esta corrida.

## Archivos creados
- `docs/internal/audit-viewer/index.html` — un solo document, CSS inline (paleta miTropero
  `--primary:#1E5A3E`, molde `docs/marketing/landing-proximamente/`), dos vistas (login / consola) por
  toggle de `hidden`. Login = email+password. Consola = filtros + tabla + "Ver más". `<meta robots noindex,
  nofollow>` + `<meta referrer no-referrer>` + `<meta http-equiv=CSP>` (defensa en profundidad). Carga
  supabase-js pineado+SRI y `app.js`.
- `docs/internal/audit-viewer/app.js` — IIFE `'use strict'`. Login supabase-js → JWT en memoria; fetch a la
  EF; render de tabla; diff expandible; paginación; formato es-AR. Cero `innerHTML`.
- `docs/internal/audit-viewer/_headers` — headers de Cloudflare Pages (noindex, Referrer-Policy, X-Frame,
  nosniff, CSP acotado, Permissions-Policy).

## Config (público por diseño, R6.11) — de `.env.local`
- URL DEV: `https://xrhlxxdnfzvdnztacofj.supabase.co` (`EXPO_PUBLIC_SUPABASE_URL`).
- anon/publishable key: `sb_publishable_iCiWUjiUycJJlHT0XSKs4w_HJ6bdktb` (`EXPO_PUBLIC_SUPABASE_ANON_KEY`).
- Cliente `createClient(url, key, { auth: { persistSession:false, autoRefreshToken:false } })` → el token
  **no toca localStorage**; el `access_token` se guarda en una variable JS del closure (`state.accessToken`).
- Todas las llamadas a la EF: `POST <url>/functions/v1/audit_query`, headers
  `Authorization: Bearer <token>` + `apikey: <anon>` + `Content-Type: application/json`, **filtros en el
  body** (nunca en la URL — validado por grep, no hay querystring).

## Decisión del pin/SRI de supabase-js [§8 M1]  — CERRADA con SRI real
- **Versión EXACTA:** `@supabase/supabase-js@2.112.3` (última 2.x estable al 2026-08-16, resuelta vía la API
  de jsDelivr).
- **CDN + archivo:** `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.js`
  (bundle **UMD original, estático**, 211907 bytes, `Cache-Control: immutable`, expone `window.supabase`).
- **SRI (sha384):** `sha384-qafw21c/iciq0VXsi9FzkfoQv5I/V0iqE4lSNcKXPnW9/UTJLnv5CcN4FHxVLnKg`
  (calculado descargando el archivo y hasheándolo; el `<script>` lleva `integrity` + `crossorigin="anonymous"`
  + `referrerpolicy="no-referrer"`). **No hay TODO pendiente de hash** — el SRI es real y verificado.
- **Por qué jsDelivr UMD y no `esm.sh@2` (lo que decía el design §3.1):** el entry de esm.sh es un wrapper de
  re-export; sus sub-módulos NO quedan cubiertos por el SRI del `<script>` → el SRI sería casi decorativo. El
  UMD de jsDelivr es **un único archivo self-contained** → un solo hash cubre toda la lib que maneja el JWT de
  staff. Cumple M1 de verdad.
- **Por qué el `.js` original y NO el `.min.js`:** jsDelivr **genera** `supabase.min.js` dinámicamente y su
  propio header advierte *"Do NOT use SRI with dynamically generated files"* (su hash puede cambiar). El
  `dist/umd/supabase.js` es el archivo tal cual viene del paquete npm (inmutable) → SRI estable.
- Reconciliado en `design.md` §3.1 y §3.4 (as-built = jsDelivr pineado + SRI; CSP permite `cdn.jsdelivr.net`,
  ya no `esm.sh`).

## Render / comportamiento (contrato design §2.1 y §3.3)
- **Columnas:** Fecha (es-AR `dd/mm/aaaa hh:mm`, `Intl.DateTimeFormat('es-AR', tz America/Argentina/
  Buenos_Aires)` — `ts` es instante ISO completo, `new Date` correcto), Actor (`actor.name` + `actor.email`,
  o el `auth_uid`/"—" si `actor===null`), Tabla (`table_label`), Operación (badge por op: Alta/Cambio/Baja con
  color, `title`=op crudo), operationId (`request_id` monospace truncado con ellipsis + botón Copiar).
- **Diff expandible:** unión de claves `record`∪`old_record`. INSERT=nuevos; DELETE=eliminados;
  UPDATE=`label: antes → después` colapsando iguales (`valuesEqual` con `JSON.stringify` para objetos).
  `FIELD_LABELS` es-AR (role→Rol, active→Activo, establishment_id→Campo, user_id→Usuario, + varios); clave
  sin label → cruda. Valores por `formatValue` (bool→Sí/No, null→"—", objeto→JSON).
- **Paginación:** "Ver más" re-consulta con `before = next_cursor` y **acumula** filas; se oculta cuando
  `next_cursor` viene `null`.
- **Errores:** 401 → logout + vuelta al login ("Tu sesión expiró"). 403 `not_staff` → notice
  "No tenés acceso a esta herramienta" y NO pinta ninguna fila. 429/400/5xx → copy es-AR sin exponer internals.

## [§8 LOW-3] Anti-XSS — CRÍTICO, cumplido y verificado empíricamente
- **Cero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`** en `app.js` (grep = 0 en
  código; las 2 apariciones de "innerHTML"/"localStorage" son en comentarios). Todo el DOM se arma con
  `document.createElement` + `textContent` (helpers `el`/`txtEl`). Los valores de `record`/`old_record` y el
  `name`/`email` del actor van SIEMPRE por `textContent`.
- Verificado en runtime: un payload `<img src=x onerror="window.__xss=1">` inyectado en `record.note` y en
  `actor.name` se renderiza **como texto inerte**; `window.__xss` queda `undefined`, no se crea ningún `<img>`.

## Verificación (no hay EF deployada — deploy-gated)
- `node --check app.js` → **SYNTAX OK**.
- grep: sin `innerHTML`/`localStorage`/`sessionStorage`/`eval`/`document.write` en código; fetch usa POST +
  Bearer + apikey + body (sin querystring); `<script>` con pin exacto + `integrity` + `crossorigin`.
- **Sin linter JS en el repo** (la app vive en `app/`; no hay `package.json` raíz ni eslint para
  `docs/internal`). Compensado con smokes headless reales (Playwright de `app/`).
- **Smoke 1 (happy + XSS + paginación):** login mock → consola → 2 filas → expandir UPDATE muestra
  `Rol: member → owner` y **colapsa** `Activo` (sin cambios) → `window.__xss` NO se ejecuta, 0 `<img>`
  inyectados, payload como texto → `next_cursor:null` oculta "Ver más". **PASS.**
- **Smoke 2 (403 not_staff):** notice "No tenés acceso a esta herramienta", 0 filas, sin "Ver más". **PASS.**
- **Veto de diseño (capturas a scratchpad, no commiteadas):** login centrado, consola con tabla, fila
  expandida con diff legible. Sin recorte de descendientes ('í' de "auditoría", 'p' de "Tropero"), es-AR
  completo, naming miTropero (0 RAFAQ), jerarquía y badges por color OK. Conversión de zona verificada
  (14:03Z → 11:03 ART). Los scripts de smoke se corrieron desde `app/` como temp y se borraron (scope =
  docs/internal only; no se commitea nada bajo `app/`).
- **`node scripts/check.mjs` NO se corrió a propósito:** el cambio es 100% estático en `docs/internal/**`
  (sin código/tests de la app) → check.mjs no cubre nada de esto, y hay una corrida paralela tocando
  `supabase/` + posible 2º cliente Supabase ⇒ correrlo solo agregaría el flake conocido de rate-limit
  (memoria [[reference_check_red_rate_limit]]) sin señal útil.

## Autorrevisión adversarial (paso 8)
- **XSS almacenado (LOW-3):** buscado con grep + falsificado en runtime con payload real en record y actor →
  cerrado (texto inerte).
- **Token en storage:** confirmado `persistSession:false` + `autoRefreshToken:false` + token solo en
  variable de closure; grep localStorage/sessionStorage = 0. La contraseña se limpia del input tras login.
- **PII/secretos en el cliente:** solo URL DEV + anon key (públicas). No hay service_role ni `SUPABASE_DB_URL`
  (eso vive en la EF).
- **Filtros en la URL:** falsificado que el fetch no arma querystring — todo va en el body.
- **Deps CDN pineadas:** versión exacta + SRI del archivo estático (no del `.min` generado). Única dep CDN.
- **CSP que no rompe la app:** `default-src 'none'` + allowlist mínima; verificado en runtime (la consola
  carga supabase-js del CDN y pega a Supabase sin violaciones de CSP en el smoke sobre `file://`).
- **Edge del diff:** campo agregado/quitado en UPDATE (undefined de un lado) → `— → valor` / `valor → —`
  vía `formatValue(undefined)='—'`; `actor===null` → uid o "—"; `request_id===null` → "—" sin botón Copiar.
- **Encontrado y corregido durante el armado:** referencié `.sr-only` en el `<th>` de detalle y faltaba la
  clase → la agregué al CSS.

## Reconciliación de specs (paso 9)
- `design.md` §3.1 y §3.4: as-built del CDN (jsDelivr UMD pineado + SRI, no `esm.sh`) y del CSP
  (`cdn.jsdelivr.net`, `default-src 'none'`, meta de defensa en profundidad).
- `tasks.md` T7–T13 → `[x]`; T13 dice "jsDelivr pineado" en vez de "esm.sh".
- Requirements NO cambian de *qué* (R6.x intactos): el cambio es de *cómo* (host del CDN) → va en design, no
  en EARS.

## Mapa R<n> → verificación (web)
| R | Verificación |
|---|---|
| R6.1 (estático versionado) | `docs/internal/audit-viewer/{index.html,app.js,_headers}` |
| R6.2 (JWT en memoria, no localStorage) | `persistSession:false`; grep localStorage=0; autorrevisión |
| R6.3 (form de filtros) | `#filters` (from/to/uid/est/req/table select/op select); smoke 1 |
| R6.4 (POST Bearer, body, no URL) | `callEf`; grep sin querystring; smoke 1 |
| R6.5 (columnas de la fila) | `renderRow`; captura 02; smoke 1 |
| R6.6 (expandir diff) | `renderDiff`+toggle; captura 03; smoke 1 |
| R6.7 (paginación next_cursor) | `loadMore`/`updateMore`; smoke 1 (oculto con null) |
| R6.8 (fecha es-AR) | `DATE_FMT`/`formatDate`; captura 02 (11:03 ART) |
| R6.9 (403 → sin acceso, sin datos) | `handleError`; smoke 2 |
| R6.10 (noindex) | `<meta robots noindex>` + `_headers X-Robots-Tag` |
| R6.11 (sin secretos) | solo URL+anon; sin service_role/DB_URL |
| R5.4/R5.5 (diff legible + resalte + labels) | `renderDiff`/`FIELD_LABELS`; captura 03 |
| §8 M1 (pin+SRI) | `<script>` versión exacta + integrity real |
| §8 LOW-2 (guards from/to) | `dateToIso` chequea `typeof === 'string'` antes de `new Date` (lado web) |
| §8 LOW-3 (anti-XSS) | grep innerHTML=0 + smoke 1 (payload inerte) |

## N/A documentados
- **Offline-first:** N/A — herramienta web interna de escritorio para staff (no corre en la app RN, no toca
  PowerSync, no carga en campo). Igual que design §5.
- **Capture de Gate 2.5 estándar (`app/e2e/captures/*.capture.ts`, ADR-029):** N/A en esta corrida por dos
  motivos: (1) mi scope es **`docs/internal/**` únicamente** (no puedo escribir bajo `app/`); (2) el harness
  de capturas es para las **pantallas RN** con viewport **mobile 412×915** — no encaja una consola web de
  escritorio fuera del Expo app. Por eso `tasks.md` T23 define el Gate 2.5 como "veto del leader (checklist
  web adaptado) + capturas de login/consola/fila expandida". Dejé generadas 3 capturas de referencia en el
  scratchpad (01-login, 02-consola-resultados, 03-fila-expandida-diff) para ese veto; se ven bien.

## Qué queda (fuera de esta corrida)
- **Gate 2.5 (leader):** veto de diseño web + capturas de los 3 estados (login, resultados, diff expandido).
  Las 3 ya renderizan bien (adjunto referencia en scratchpad). Sugerencia: agregar estados vacío/error a las
  capturas si se quiere cobertura total.
- **Deploy (gated, OK de Raf):** publicar el estático en Cloudflare (Pages nuevo vs ruta en el Worker — T20),
  con `_headers`. Ajustar `connect-src`/URL+anon si se apunta a PROD en vez de DEV. Verificar `noindex` y que
  la consola cargue supabase-js del CDN post-deploy (T22).
- **Depende de la EF (otra corrida):** el smoke E2E real (T19) contra la EF deployada — la web ya cumple el
  contrato del design §2.1; si la EF cambia la forma de la respuesta, revisar `renderRow`/`renderDiff`.
