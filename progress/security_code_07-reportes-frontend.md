# Security Code Review — 07-reportes (Stream C, FRONTEND)

**Modo**: `code` (Gate 2, ADR-019)
**Veredicto**: **PASS**
**Fecha**: 2026-06-24
**Baseline**: `ad9c0ba9786833f6838f5f6aa665438a1e3143a7` (de `progress/impl_07-reportes-frontend.md`)
**Alcance**: frontend puro que consume las 9 RPC `SECURITY DEFINER` de `0106` (ya deployadas + Gate-2-aprobadas en su propio gate). No toca schema / RLS / Edge Functions / migrations.

> Nota de baseline: trabajamos sobre `main` sin feature-branches y el impl está **sin commitear**, así
> que `git diff <baseline>..HEAD` da vacío. Audité los archivos del working tree listados en
> `git status --porcelain` + el ledger del implementer (lista de archivos creados/modificados). Es el
> conjunto correcto del diff lógico del Stream C frontend.

## Findings HIGH

**Ninguno.** No se detectó ningún hueco explotable. El frontend respeta la frontera de autorización: toda
lectura de reportes pasa por las RPC server-side, que derivan/validan el tenant; el cliente nunca arma un
query directo a las tablas de evento/agregados ni hardcodea un tenant.

## Findings MEDIUM

**Ninguno.**

## Findings LOW / observaciones (no bloquean)

1. **`establishment_overdue_doses` / `establishment_unweighed` exponen `idv` + `visual_id_alt` (identificación
   del animal, no PII de persona)** en las listas de alertas. Es el dato necesario para que la alerta sea
   accionable (R7.10/R7.11) y la RPC ya está tenant-scopeada → no es fuga. Solo se anota porque son
   identificadores ganaderos; ningún dato de persona (email/teléfono/geo) se renderiza ni se loggea. Sin
   acción requerida.
2. **`comparar.tsx` `reloadPair` usa `setTimeout(…, 0)` para re-disparar el efecto** (toggle de
   `idA`/`idB` a `null` y de vuelta). Es un patrón de UI, no de seguridad — el guard `active` del efecto
   evita el set-state-after-unmount. Sin impacto de seguridad; queda como nota de prolijidad para el reviewer
   de código (ya aprobó).

## Cobertura del foco solicitado (1–5)

### 1. No bypass de la frontera de authz — OK
`app/src/services/reports.ts` usa **exclusivamente** `supabase.rpc(<nombre>, args)`. Grep dirigido sobre el
service y sobre todas las pantallas `reportes*.tsx`: **0 matches** de `.from(` — no hay ningún query directo
a `weight_events`, `reproductive_events`, agregados, etc. que saltee la RPC.
- Las 9 RPC consumidas (líneas de `reports.ts`): `session_event_summary` (217), `rodeo_sessions_list` (226),
  `rodeo_pregnancy_kpi` (243), `rodeo_calving_kpi` (258), `rodeo_ccl_distribution` (273),
  `rodeo_calving_by_stage` (282), `rodeo_weight_by_category` (300), `establishment_overdue_doses` (321),
  `establishment_unweighed` (341).
- Toda la I/O está canalizada por `callRpcRows` / `callRpcSingle` (líneas 160–184) → un único punto que llama
  `supabase.rpc`. No hay un segundo camino de datos.
- Excepción auditada y **sana**: `app/app/reportes/sesion/[id].tsx:45` lee el **marco temporal** de la sesión
  con `getSessionById(sessionId)` (`app/src/services/sessions.ts:279`), que es una lectura **local de SQLite**
  (`runLocalQuerySingle` + `buildSessionByIdQuery`, filtra `deleted_at IS NULL`). No es un bypass de la RPC:
  el SQLite local sólo contiene los datos del tenant activo (frontera = PowerSync sync rules, catálogo C1).
  El conteo POR TIPO de evento de esa misma pantalla sí va por la RPC online (`session_event_summary`). Patrón
  preexistente de `sessions.ts` (spec 03, ya gateado), no introducido por este diff.

### 2. Tenant del lado correcto — OK
- `app/app/(tabs)/reportes.tsx`: `establishmentId` sale de `useEstablishment()` (`estState.current.id`,
  línea 69) y `rodeoId` de `useRodeo()` (`activeRodeoId`, línea 71) / del selector local (línea 74–75). **No
  hay ningún literal de UUID** de establecimiento ni rodeo en todo el diff. Grep de `EXPO_PUBLIC` /
  `process.env`: 0 matches.
- Las pantallas de detalle/lista/comparar leen `rodeoId`/`id` de `useLocalSearchParams` **con guard de tipo**
  (`typeof params.x === 'string' ? … : null` — `comparar.tsx:55`, `sesiones.tsx:26`, `sesion/[id].tsx:36`).
  Un param ausente/no-string degrada a `null` (hook deshabilitado), no rompe ni asume.
- El cliente pasa el id **como parámetro**; la autorización la hace la RPC `SECURITY DEFINER` server-side
  (documentado en `reports.ts:13-16`). Un `rodeoId`/`establishmentId` de otro tenant → la RPC responde `42501`
  → el cliente lo mapea a `forbidden` y muestra "No tenés acceso… o ya no está disponible" (no datos del otro
  tenant, no vacío silencioso ambiguo). El cliente **no asume** acceso: no hay un filtro client-side que
  "confíe" en el id para mostrar/ocultar.

### 3. Parseo / render de la respuesta — OK
- **Sin inyección de render**: grep de `dangerouslySetInnerHTML`, `eval(`, `new Function` en todo
  `components/reports/*` + pantallas → 0 matches. Todo se renderiza con `<Text>` de Tamagui (escapado por
  defecto en RN / RN-web). Los datos de la RPC se muestran como strings/números, nunca como markup.
- **Valores límite (es-AR) sin romper** (`app/src/utils/reports-format.ts`, 33 tests `node:test`):
  - `safePercent` (línea 18): guard `den <= 0` → `null` (nunca NaN/Infinity). 0 servidas → "—".
  - `formatPercentAR`/`formatKgAR`/`formatKgDeltaAR` (27/40/52): `null` y `!Number.isFinite` → "—".
    Negativos manejados (`formatKgDeltaAR` usa el signo; `daysSinceLabel` clampa a 0).
  - `toNum` (`reports.ts:205`): `numeric` de Postgres que llega como string → coerción tolerante; no-finito → 0.
  - `cclBarsForMonths` (173): total=0 → 0% en todas las barras (no NaN).
- **`ReportResult` no filtra detalle del server** (`reports.ts:137-152`, `mapRpcError`): el `error.message`
  CRUDO de PostgREST **no** se propaga a la UI. Se mapea a uno de 5 kinds con un mensaje genérico fijo en
  español (`forbidden`/`validation`/`network`/`server`/`offline`). `ReportStates.ReportError` (`message`)
  recibe ese texto ya saneado, no el del server. No hay `err.message`/`error.message` crudo llegando a una
  pantalla (catálogo B1: limpio).

### 4. Online-only sin fallback inseguro — OK
- `callRpcRows` (`reports.ts:165-166`) llama `assertOnline(OFFLINE_MSG)` **antes** de `supabase.rpc`; offline
  → `{ kind: 'offline' }` y **no** dispara la RPC. No hay ningún `catch` que caiga a un caché local
  cross-tenant ni a datos viejos de otro tenant: el estado offline simplemente renderiza
  `ReportStates.ReportOffline` ("Necesitás conexión… conectate y reintentá"). El anti-parpadeo del hook
  (`use-reports.ts:100-105`) conserva en memoria el último `data` **del mismo fetcher** (mismo rodeo/año, por
  las deps del `useCallback`) durante un refresh fallido — no mezcla tenants (guard de secuencia `seqRef`
  descarta resultados de un rodeo/año superado, línea 98).

### 5. Sin secretos en el cliente — OK
- Grep de `service_role` / `serviceRole` / `SERVICE_ROLE` en service + componentes + pantallas: **0 matches**.
- El cliente usa el `supabase` compartido (anon/publishable key del cliente, fuera de este diff). No se
  expone ninguna key server-only ni se construye un admin client. Grep de `console.(log|error|warn|debug)` en
  el service: 0 matches → no hay logging de params/errores que pudiera filtrar algo.

## Spike de dev (`reportes-spike.tsx`) — auditado, sano

- **100% mock**: grep de `supabase` / `.rpc(` / `fetch*` / `use-reports` / `services/reports` en
  `app/app/reportes-spike.tsx` → **0 matches**. Renderiza fixtures locales con los mismos componentes de
  presentación. No puede leer ningún dato de tenant.
- **Bypass de auth gateado a web** (`app/app/_layout.tsx:302`): el `DEV_WEB_ROUTES` (que incluye
  `reportes-spike`) sólo saltea el gate de auth/establecimiento cuando `Platform.OS === 'web'`. En builds
  nativos de producción (ios/android) el spike es **inalcanzable** (rebota al gate normal). Es el mismo patrón
  ya aceptado para los spikes de BLE/tacto. Aun en web no hay nada que filtrar (es mock). Sin riesgo.

## Tabla de inputs (campos que el usuario tipea/elige)

Este frontend **no tiene formularios de texto libre ni buscadores** que concatenen input en queries. Las
entradas del usuario son selección de id (de listas server-provistas) o un stepper numérico acotado.

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| Selector de rodeo (`reportes.tsx`) | set cerrado = `rodeos` del `RodeoContext` (tenant activo) | server (la RPC re-valida tenant; opciones ya scopeadas) | ✅ |
| Stepper de campaña/año (`reportes.tsx` `YearStepper`) | entero; tope `año+1` client (`reportes.tsx:258,297`) espeja la cota `p_year` server | server (cota `p_year` en la RPC; el tope client es UX) | ✅ |
| Selección de sesión A/B (`comparar.tsx`) | set cerrado = `rodeo_sessions_list` (RPC, scopeada al rodeo) | server (la RPC valida tenant del rodeo/sesión) | ✅ |
| `rodeoId`/`id`/`name` de deep-link params | `typeof === 'string'` guard; id → RPC (re-valida); `name` solo se muestra | server (id) / N/A (`name` es display, escapado por `<Text>`) | ✅ |

No hay ningún campo de entrada que requiera límite+validación adicional. Ningún input se concatena en
`.or()/.filter()/ilike/textSearch` (grep: 0 matches) ni en un prompt LLM.

## Tabla de rate limits (acciones abusables tocadas)

El diff **no agrega** ninguna acción abusable nueva (no manda email/SMS, no pega a API externa, no es bulk/
import, no muta). Son lecturas autenticadas vía RPC.

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Lectura de reportes (9 RPC, autenticada) | n.a. (no introducido por este diff) | — | sí (RPC `42501` → forbidden) | El costo/abuso de las RPC se gobierna server-side (su propio Gate 2 backend). El frontend no abre un vector nuevo; el `assertOnline` evita disparos en vacío. Si en el futuro se quisiera acotar abuso de lectura autenticada, es decisión del backend. |

## Dominios del catálogo RAFAQ revisados

- **A1 service-role bypass**: N/A — el frontend no usa `createAdminClient` (es server-only).
- **A2 mass assignment**: N/A — no hay `.insert(body)`/`.update(body)`; el diff no muta.
- **A3 IDOR por FK**: cubierto por la RPC server-side; el cliente pasa id como param y la RPC re-valida
  (`42501` → forbidden). Verificado en pantallas detalle/comparar.
- **A4 BFLA**: la autorización por rol vive en cada RPC `SECURITY DEFINER` (gate backend); el frontend no la
  replica ni la asume.
- **B1 information disclosure (`err.message` crudo)**: limpio — `mapRpcError` sanea todo error a un mensaje
  genérico fijo; nada del server llega crudo a la UI.
- **B2 PII en logs**: limpio — 0 `console.*` en el service; no se loggea nada.
- **B3 over-fetching column-level**: gobernado por las RPC (devuelven shape acotado); el frontend solo mapea
  lo que viene.
- **C1 PowerSync sync rules**: la única lectura local (`getSessionById`) confía en el scoping del store local
  (preexistente, spec 03). Sin cambios introducidos acá.
- **F1 PostgREST filter injection**: limpio — 0 `.or()/.filter()/ilike/textSearch`; params tipados de RPC.

## Dominios excluidos (con justificación)

- **C2/C3/C4 (Realtime/data-at-rest/stale-auth replay)**, **D (secretos/supply chain server)**,
  **E (abuso a escala server)**, **F2/F3/F4 (import/SSRF/email)**, **G (BLE)**, **H (auth/sesión)**,
  **I (compliance/retención)**: fuera del alcance de un frontend de solo-lectura que consume RPC ya gateadas.
  Ninguno es tocado por el diff.

## Archivos analizados

- `app/src/services/reports.ts` (NUEVO) — capa I/O, 9 wrappers `supabase.rpc`, `mapRpcError`.
- `app/src/utils/reports-format.ts` (NUEVO, puro) — formato es-AR + guards de 0/null/negativo.
- `app/src/hooks/use-reports.ts` (NUEVO) — orquestación, anti-parpadeo, guard de secuencia.
- `app/src/components/reports/{ReportStates,KpiCard,CclBars,AlertList,index}.tsx` (NUEVOS) — presentación pura.
- `app/app/(tabs)/reportes.tsx` (MOD) — pantalla principal.
- `app/app/reportes/sesiones.tsx`, `reportes/sesion/[id].tsx`, `reportes/comparar.tsx` (NUEVOS) — pantallas.
- `app/app/reportes-spike.tsx` (NUEVO, dev-only) — spike 100% mock.
- `app/app/_layout.tsx` (MOD) — registro de rutas + gating `DEV_WEB_ROUTES` (verificado: bypass solo en web).
- Referencia (no en el diff, auditada por la lectura local de `[id].tsx`): `app/src/services/sessions.ts`.

## Cobertura indirecta de Sentry security-review

La skill `sentry-skills:security-review` está orientada a vulnerabilidades clásicas de data-flow
(injection/XSS/authz a nivel de request). En este diff **no la corrí como gate principal** porque: (a) el diff
no contiene ningún sink de inyección (0 `.from`/`.or`/`eval`/`dangerouslySetInnerHTML`/template SQL),
(b) la frontera de authz real es server-side (RPC `SECURITY DEFINER`, auditadas en su propio Gate 2 backend),
y (c) la skill **no cubre** los dominios críticos de RAFAQ relevantes acá — scoping por tenant vía RPC,
PowerSync sync rules y el patrón online-guard — que sí audité manualmente arriba. La revisión fue manual,
dirigida por el catálogo RAFAQ y el foco solicitado. **No cubierto por herramienta automática, revisado a
mano**: el camino de datos RPC-only, el mapeo de error sin leak, y el gating del spike.
