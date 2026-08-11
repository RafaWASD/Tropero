# Gate 1 — Security (modo `spec`) — 17-observabilidad (Sentry + PostHog)

- **Fecha**: 2026-08-11
- **Input**: `specs/active/17-observabilidad/{requirements,design,context,external-setup}.md`
- **Foco declarado (por la spec y el leader)**: PRIVACIDAD — que ningún breadcrumb/evento/captura lleve
  `opData` ni PII (R4.2, R4.4, R6.4, R7.1, R1.6, R3.3, R5.3) + el scrubber defense-in-depth (R7.4).
- **Método**: no asumí las afirmaciones de privacidad de la spec; las verifiqué contra el código real que
  dice instrumentar (`connector.ts`, `ble/logging.ts`, `AuthContext.tsx`, `EstablishmentContext.tsx`,
  `powersync/provider.tsx`) y contra el schema de PII (`0068_user_private_pii.sql`,
  `0080_denormalize_member_name_on_user_roles.sql`).

## Veredicto: **PASS (0 HIGH)**

La spec es genuinamente cuidadosa con la privacidad. Los 6+ caminos hacia Sentry/PostHog están limpios por
diseño y verificados contra el código. No hay hueco de seguridad concreto y explotable según el diseño
actual → 0 HIGH. Hay 4 MEDIUM (no bloqueantes, recomendados cerrar en la spec antes/durante la implementación)
y 2 LOW. Ninguno alcanza el umbral HIGH.

---

## Respuestas a los 6 puntos de foco del gate

**1. Los 6 caminos hacia terceros — auditados contra código, todos limpios:**

| Camino | Payload (diseño) | Verificación contra código real | PII/opData/token? |
|---|---|---|---|
| `captureConsole('error')` | args de cualquier `console.error` | grep del árbol: los únicos `console.error` reales son `provider.tsx:89` y `:140` (`connect/reconnect FAILED`, loguean `err` de transporte) + stubs de `react-native-web` (BackHandler). `connector.ts` usa `console.warn`/`console.log`, nunca `error`. `err` es error de socket/WASM/red, no fila ni token. | No (hoy) |
| `captureException` (ErrorBoundary) | `error` de un throw de render | Objeto Error de React (message + component stack). El scrubber es key-based → no cubre PII embebida en `message` (ver M1), pero no hay call site que hoy meta PII en un throw. | No (hoy) |
| Breadcrumb navegación | `{ pathname }` derivado de `segments.join('/')` | `useSegments()` de expo-router devuelve los NOMBRES de segmento del filesystem (`['animal','[id]']` → `animal/[id]`), NO la URL resuelta con ids reales ni el query string. Elección correcta: cierra el id de animal y el `?token=` de invitación de raíz. | No |
| Breadcrumb BLE (`logTransportEvent`) | `kind` + campos diagnósticos | Revisé las 16 variantes de `TransportLogEvent`: enums de razón, contadores, `ms`, booleanos, `deviceId` (hardware del bastón, no persona) y `message` de error de transporte. Cero EID/caravana/nombre/dato de campo. | No |
| `upload_rejected` (`surfaceUploadRejection`) | `{ table, op, code }` | `surfaceUploadRejection(op, error)` ya extrae SOLO `op?.table`, `op?.op` (UpdateType) y `code` string en su `console.warn`. `opData` nunca entra. El sink NO toca `fetchCredentials`/JWT (método separado, intacto). | No |
| Eventos de dominio | `{type}` / `{rows}` / `{role}` | Metadata no identificatoria. Sin id de animal/caravana/nombre/email/campo. | No |
| `identify`/`group`/`register` (PostHog) | `user.id` / `establishment_id` / `{role, establishment_id, env}` | Ver punto 2 abajo y L2. Spec explícita: id solo, sin email/name; register sin name/province/city. | No (a nivel spec) |

**2. Completitud del denylist R7.4:** el schema real de `user_private` (0068) tiene exactamente dos campos de
contacto: `email` y `phone` — **ambos ya en el denylist**. La cobertura recursiva de `contexts`/`extra`/
`breadcrumbs[].data`/`request`/`tags` se cumple SI el walk recorre el grafo completo del event (el diseño dice
"walk recursivo" genérico → OK a nivel spec; el implementer debe garantizar que efectivamente cubre
`breadcrumbs[].data` que es array-de-objetos y `request.headers`). Ciclos/profundidad: el diseño §3 especifica
`WeakSet` + corte de profundidad → OK. **Fail-safe: NO está especificado el modo de falla** (ver M2). **Gap de
denylist: `member_name`** (columna real, nombre denormalizado de coworker = PII) puede NO ser atrapada según la
semántica de match (ver M3).

**3. `captureConsole('error')` como vector:** hoy ningún `console.error` del árbol loguea PII/opData/token
(verificado por grep — los dos reales cargan `err` de transporte, limpios). El scrubber cubre claves
estructuradas pero NO valores string embebidos (ver M1). Sin leak actual.

**4. Env vars:** confirmado — `EXPO_PUBLIC_SENTRY_DSN` y `EXPO_PUBLIC_POSTHOG_KEY` son claves de cliente
write-only (ingestion), embebidas por diseño; committearlas en un repo privado es práctica estándar, NO es
exposición de secreto. El único secreto real, `SENTRY_AUTH_TOKEN`, está correctamente tratado como EAS secret,
**NO** `EXPO_PUBLIC_*` y **NO** committeado (external-setup.md §Pendiente + R9.2). Sin finding.

**5. Input del usuario:** prácticamente nulo. El fallback del ErrorBoundary (R2.2) es texto es-AR estático; el
crash de prueba (R2.6) lanza un error hardcodeado. Ninguno toma input → sin superficie de inyección. **La única
superficie de input** es el gesto de shake-feedback (R2.7, GATED-FASE0), que recolecta texto libre del tester +
screenshot → ver M4.

**6. Sin superficie SQL/RLS:** confirmado. El diseño §7 lo declara explícito ("no crea ni modifica tablas ni
policies — es frontend runtime"). El único dato de tenancy que sale es `establishment_id` (UUID no-PII, derivado
de contexto ya scopeado por RLS, nunca hardcodeado). Sin migración, sin policy, sin trigger nuevos.

---

## Findings HIGH

Ninguno.

---

## Findings MEDIUM (no bloqueantes — cerrar en la spec)

### M1 — El scrubber key-based no atrapa secretos/PII embebidos en VALORES string (URLs de auto-breadcrumbs HTTP, mensajes)
El scrubber R7.4 redacta por **nombre de clave**. Estructuralmente NO puede redactar un secreto que viaja
dentro de un VALOR string bajo una clave no sensible. El caso concreto: `@sentry/react-native` instrumenta
`fetch`/`xhr` por defecto y genera breadcrumbs con la URL bajo `data.url`. Si una URL llevara un token/apikey en
query param, cae bajo la clave `url` (no está en el denylist) → **pasa el scrubber**. Mismo patrón para el
deep-link de invitación `/invite?token=...` si algo lo capturara como URL.
- **Atenuante fuerte**: el path de sesión (`fetchCredentials` → header `Authorization`, no URL) queda intacto;
  el único secreto que Supabase Realtime pone en la URL es el `apikey` anon (público, no es leak); el JWT de
  usuario, por diseño de los SDKs, va en header/join-payload, no en la URL. El breadcrumb de navegación propio
  usa `segments.join('/')`, no la URL resuelta → ya cerrado.
- **Por qué MEDIUM y no LOW**: el scrubber es la red de seguridad declarada para lo automático; su límite
  (solo-claves) no está reconocido en la spec, que lo enmarca 100% alrededor de claves del denylist.
- **Fix**: (a) decidir en la config nativa (Fase 0) qué integraciones de breadcrumbs HTTP quedan habilitadas —
  o deshabilitarlas; (b) agregar a `redactBreadcrumb` un stripping del query string de `data.url` (o de toda
  clave `url`/`to`/`from`), para que ningún token/apikey pueda viajar en un valor string.

### M2 — Modo de falla del scrubber sin especificar (debe ser fail-CLOSED)
R7.4 y diseño §3 no definen qué pasa si `redactEvent`/`redactBreadcrumb` **tira** (o se cuelga por un input
patológico). La frase "no rompe el envío ni el flujo" es ambigua: si se interpreta como "el evento igual se
envía", podría enviarse **sin redactar** = leak. El scrubber es el control central de privacidad → su falla
debe ser fail-closed: en excepción, **descartar el evento** (devolver `null` en `beforeSend`), nunca devolver
el event original sin redactar.
- **Fix**: la spec debe fijar explícitamente: `redactEvent` envuelto en `try/catch` que ante error devuelve
  `null` (drop, fail-closed), no el event crudo. Agregar un test de falsificación que fuerce un throw interno
  y asserte que NO sale el payload sin redactar.

### M3 — Semántica de match del denylist sin definir; afecta `member_name` (PII real) y sobre-redacción de `pathname`
El diseño dice "match case-insensitive" pero no aclara **exacto-de-clave** vs **substring**. Consecuencias
opuestas y ambas relevantes:
- Si es exacto-de-clave: `member_name` (columna real de `user_roles`, 0080 — nombre denormalizado de coworker =
  PII) **NO** se atrapa con la clave `name`. También `full_name`, `first_name`, etc.
- Si es substring: `pathname`, `establishment_name`, `lostEstablishmentName`, `rpcName` se redactan de más →
  rompe la utilidad de los breadcrumbs (no es hueco de seguridad, pero degrada la feature).
- **Fix**: definir match por **límite de token** (partir la clave por `_`/`camelCase` y comparar segmentos), y
  **agregar `member_name` al denylist** explícitamente (o el término `member`), para no depender de la
  semántica. `apellido` ya está; `member_name`/`nombre` cubren el resto de nombres de persona.

### M4 — Shake feedback (R2.7) + attachments de Sentry (screenshot/view-hierarchy) BYPASSEAN el scrubber
El gesto de feedback por shake (R2.7, GATED-FASE0) recolecta **texto libre del tester + un screenshot**, y las
opciones `attachScreenshot`/`attachViewHierarchy` de `@sentry/react-native`, si se activaran, adjuntan la
pantalla / árbol de vistas. Todo esto viaja como **envelope items separados** que el scrubber key-based sobre
`event` NO toca, y el texto libre es un `message` donde el scrubber tampoco atrapa PII. Sobre un tenant real
(no el de prueba) un screenshot muestra caravanas, nombres de coworkers y datos del establecimiento → es la
tensión más filosa con R7.1 / Ley 25.326.
- **Atenuantes**: es gesto explícito del tester (consentimiento implícito), beta-scoped, gated a Fase 0, con
  `attachScreenshot`/`attachViewHierarchy` **off por default** (la spec no los prende).
- **Por qué MEDIUM**: la spec trata R2.7 a la ligera ("API a confirmar") sin decidir la postura de privacidad,
  y es el único lugar donde la promesa "nada de PII a terceros" tiene un hueco real.
- **Fix**: la spec debe fijar AHORA (aunque se implemente en Fase 0): mantener `attachScreenshot` y
  `attachViewHierarchy` **explícitamente OFF**; para el widget de feedback, o deshabilitar el screenshot, o
  documentar consentimiento + retención del feedback de testers. Que quede como requisito, no como "a confirmar".

---

## Anexo LOW

### L1 — El diseño §3 subdimensiona la superficie de `captureConsole`
La afirmación "el connector loguea con `console.warn`/`console.log` (no `error`)" es correcta para
`connector.ts`, pero el **provider** de PowerSync (`provider.tsx:89` y `:140`) sí hace
`console.error('[powersync] … FAILED:', err)`. `captureConsole('error')` **las captura**. Auditadas: `err` es
error de conexión de transporte (sin `opData`/token/PII) → R1.6 se sostiene HOY, y son logs `TODO(debug
15-powersync)` temporales. Solo es una imprecisión del texto del diseño (dice "no error" de forma
generalizada); conviene que la spec reconozca estos dos call sites en la auditoría de `captureConsole`.

### L2 — Punto exacto donde el gate de CÓDIGO debe verificar que no haya object-spread
`AuthUser` empaqueta `{id, email, name}` y `EstablishmentState.active.current` empaqueta
`{id, name, province, city, role}`. La spec es explícita y correcta (identify solo `id`; register solo
`{role, establishment_id, env}`), así que no hay finding de spec — pero es el lugar preciso donde el
security_analyzer en modo `code` debe confirmar que el implementer pasó campos sueltos y NO spreeó el objeto
(un `identify(id, user)` o `register({...current})` filtraría email/name/city).

---

## Tabla de inputs (campos que el usuario tipea)

| Campo | Límite (largo/charset/formato) | Validación | OK? |
|---|---|---|---|
| Fallback ErrorBoundary (R2.2) | — (texto es-AR estático, sin input) | n/a | OK |
| Crash de prueba (R2.6, dev-only) | — (throw hardcodeado, sin input) | n/a | OK |
| Shake feedback (R2.7, GATED-FASE0) | **sin definir** (texto libre → Sentry, tercero) | n/a (no persiste en DB propia; va a Sentry) | ⚠ M4 |

No hay formularios, buscadores ni prompts nuevos. La única entrada de usuario es el feedback de shake, que no
toca la DB propia sino que envía a un tercero (Sentry) → el riesgo no es inyección sino PII (M4).

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Envío de eventos a Sentry | n.a. (RAFAQ) | — | — | Cliente→tercero. Quota del plan Developer free (~5k/mes). `tracesSampleRate:0`. Un `console.error` en loop podría quemar quota (los eventos se dropean al tope, no hay costo $). No es endpoint propio de RAFAQ. |
| Envío de eventos a PostHog | n.a. (RAFAQ) | — | — | Cliente→tercero, autocapture OFF (whitelist-by-construction), buffer en disco. No es endpoint propio. |
| Sinks best-effort (upload_rejected / BLE breadcrumb / domain events) | n.a. | — | sí (try/catch propio, nunca propaga ni demora — R4.5) | No abusables externamente; disparados por eventos internos. |

Esta feature no agrega ningún endpoint/Edge Function propio ni acción bulk/import ni buscador → no hay
superficie de rate limiting server-side RAFAQ. Ojo (denial-of-wallet leve): `captureConsole` amplifica cualquier
`console.error` a un evento Sentry; con free tier el techo es "eventos dropeados", no cargo. No bloqueante.

---

## Dominios de seguridad revisados (trazabilidad)

- **B. Exposición de datos** — B1 (info disclosure), B2 (PII en logs/telemetry): CENTRAL de este gate.
  Revisado en profundidad (los 6 caminos + scrubber). Limpio por diseño; residuales en M1/M4.
- **C. Offline/sync** — C1/C2 no aplican (no toca sync rules ni Realtime channels; solo lee el choke point
  `surfaceUploadRejection` sin cambiar qué se sincroniza). C3 (data-at-rest): no aplica (Sentry/PostHog
  bufferean sus propios eventos en disco, ya scrubbeados/sin-PII; no persisten PII nueva). C4: no aplica.
- **D. Secretos y supply chain** — D1 (service_role en cliente): n/a (no toca claves de servicio). D3
  (secrets): revisado — solo claves write-only embebidas; `SENTRY_AUTH_TOKEN` fuera del bundle (punto 4).
- **E. Abuso a escala** — E2 (denial-of-wallet): nota leve sobre quota de Sentry (tabla de rate limits).
- **F. Inyección** — F1/F3/F4: n/a (sin filtros PostgREST con input, sin `fetch` a URL de usuario, sin
  templates de email). Sin superficie de inyección (punto 5).
- **G. BLE** — G1 revisado: el sink de breadcrumb lee `TransportLogEvent` (diagnóstico), no persiste ni cambia
  el trust boundary del bastón; sin EID en claro.
- **H. Auth/sesión** — H3 (token en URL): revisado — el breadcrumb de navegación usa `segments.join('/')`
  (route template), no la URL resuelta → el `?token=` de invitación no se captura. Cerrado por diseño.
- **A. Authz object/función** — n/a: sin Edge Function nueva, sin `createAdminClient()`, sin `.insert(body)`.

## Dominios excluidos (con justificación)

- **Multi-tenant RLS / superficie SQL**: excluido — feature frontend-runtime, no crea/modifica tablas ni
  policies (diseño §7, confirmado). El único dato de tenancy es `establishment_id` no-PII derivado de contexto
  ya scopeado.
- **Mass assignment / IDOR / service-role bypass (A1–A3)**: excluido — no hay query a DB nueva ni Edge Function.
- **Ingesta de archivos / SSRF (F2/F3)**: excluido — no hay import ni `fetch` a URL controlada por usuario.
- **Compliance retención/borrado (I1)**: parcialmente tocado vía M4 (postura de privacidad del feedback), pero
  el borrado de cuenta / retención de datos propios no está en scope de esta feature.

---

## Nota para el leader

**PASS**: la spec puede avanzar. Los 4 MEDIUM no bloquean pero son baratos de cerrar y valen la pena
incorporarlos a `requirements.md`/`design.md` antes de implementar (especialmente **M2 fail-closed** y **M4
attachments off**, que son one-liners de requisito y evitan un ida-y-vuelta en el gate de código). M1 y M3 son
para el implementer/gate de código. Ninguno requiere decisión arquitectónica ni discusión con humano.
