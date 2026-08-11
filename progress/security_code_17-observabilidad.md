# Security — code review (Gate 2) · feature 17-observabilidad

**Modo:** `code` · **Baseline:** `0d16152d71065e6e188e8ece90754fed972921d6` · **Foco:** privacidad (PII/opData/secretos hacia Sentry/PostHog).

## Veredicto: PASS (0 HIGH)

No hay findings HIGH-confidence explotables hoy. Los 6 caminos outbound son whitelist-by-construction, el sink del connector no toca credenciales, el scrubber es fail-closed real y no se committeó ningún secreto. Queda **1 MEDIUM** (completitud del denylist del scrubber) — no bloqueante, recomendado fixear antes de que crezcan los call sites de `console.error`.

---

## Findings HIGH de Sentry (skill)

Ninguno. La skill `sentry-skills:security-review` no aplica sus patrones Critical/High (eval/exec/SQLi/XSS/command-injection/hardcoded-secret) a este diff: no hay sinks de ejecución, ni interpolación en queries, ni HTML dinámico, ni secretos hardcodeados. El dominio real acá es data-protection (CWE-532 information exposure through logs), cubierto abajo.

## Findings RAFAQ-SPECIFIC

Ninguno de severidad HIGH. Verificaciones (todas pasan):

- **Sink `upload_rejected` (el motivo del gate) — LIMPIO.** `connector.ts::surfaceUploadRejection` → `captureUploadRejected(op, error)` → `sentry.native.ts:65-75` → `Sentry.captureMessage('upload_rejected', { level:'warning', tags: buildUploadRejectedPayload(op, error) })`. `buildUploadRejectedPayload` (`payloads.ts:33-45`) extrae EXCLUSIVAMENTE `table`/`op`/`code` con `asString`; `op.opData` no se lee nunca. `op.op` es enum `UpdateType`, `op.table` nombre de tabla, `error.code` un SQLSTATE (`42501`/`23505`…). Cero PII. Segundo cerrojo: `beforeSend`→`redactEvent` re-camina el evento entero (incluidos `tags`), y `opData` está en el denylist. El call está en su propio `try/catch` (`connector.ts:219-225`), no propaga ni demora el drenado.
- **El sink NO toca `fetchCredentials`/JWT.** `surfaceUploadRejection` recibe solo `(op, error)` desde los `catch` de `uploadData` (`connector.ts:127`) y `applyIntentTransaction` (`connector.ts:181`). `fetchCredentials` (`connector.ts:40-56`) es un método aparte que devuelve `{ endpoint, token }` y no comparte estado con el sink. Confirmado R4.5.
- **breadcrumb BLE — sin EID.** `logging.ts` union `TransportLogEvent` (líneas 15-71): revisé los 20+ miembros; ninguno lleva el EID crudo, `tag`, `idv` ni datos de animal. `eid_rejected` lleva solo un `reason` enum (NO el EID malformado). Los free-text (`message`/`label` de `read_loop_error`/`connect_error`/`liveness_lost`/`bridge_timeout`) son strings de transporte, no PII. `buildBleBreadcrumb` (`payloads.ts:53-59`) spread OK.
- **breadcrumb navegación — route-template, no URL resuelta.** `_layout.tsx` effect `[segments]` → `trackNavigation(segments.join('/'))`. `useSegments()` de expo-router devuelve segmentos de ARCHIVO (`animal/[id]`), sin valores ni query. `buildNavigationBreadcrumb` lleva solo `{ pathname }`. Cero id/token resuelto.
- **identify/group/register — sin PII.** `AuthContext.tsx` → `identifyUser(state.user.id)` (UUID, no email/nombre; guard por-usuario). `EstablishmentContext.tsx` → `setTenantGroup(id, role, env)` → `group('establishment', id)` + `register({role, establishment_id, env})` (`payloads.ts:76-82`). `establishment_id` derivado del contexto scopeado por RLS, no hardcodeado. `resetIdentity()` en `SIGNED_OUT` (evita cruce de identidades en teléfono compartido).
- **eventos de dominio — solo metadata.** `invitar.tsx` `{ role }` (enum `InvitableRole`, NO el email de la invitación — confirmado: el `email` del form no se pasa). `carga.tsx` `{ type: maneuver }` (id de maniobra). `useImportRodeo.ts` `{ rows: importedOk }` (conteo). Ninguno lleva idv/tag/nombre/email.
- **captureException del ErrorBoundary.** `RootErrorBoundary.componentDidCatch` → `captureExceptionSafe(error, {mechanism:'RootErrorBoundary'})`. Pasa por `beforeSend`→scrubber. `attachScreenshot:false` + `attachViewHierarchy:false` (`sentry.native.ts:42-43`) → sin PII visual (R7.5).
- **captureConsole('error').** `captureConsoleIntegration({levels:['error']})` sube los args de todo `console.error`. Sitios de producción en el árbol: `provider.tsx:89` y `:140` (loguean un `err` de conexión con prefijo benigno; sin token/opData). Los demás `console.error` matcheados son de stubs de react-native-web (no corren en device) o comentarios. Todos backstopped por el scrubber.
- **Scrubber fail-closed REAL.** `redactEvent`/`redactBreadcrumb` (`redact.ts:129-147`): `try { walk } catch { return null }` → Sentry descarta. Test de falsificación con getter hostil (`redact.test.ts:47-58`) lo prueba. Walk con corte `MAX_DEPTH=16`, ciclos vía `WeakSet` con backtracking, copia no-mutante. Cubre todo el evento (no enumera sub-objetos: camina la raíz recursiva → `contexts`/`extra`/`tags`/`breadcrumbs[].data`/`request` incluidos).
- **Secretos — nada committeado.** `.env.example` solo placeholders (`<public-key>`, `phc_<project-token>`). `.env.local` gitignored (`.env*.local`) y NO trackeado (`git ls-files` vacío). `external-setup.md` (untracked) solo menciona `SENTRY_AUTH_TOKEN` como concepto → EAS secret, no committeado. Grep de secretos reales (`phc_…`, `sntrys_`, `service_role`, `ingest.sentry.io/<id>` real) en archivos trackeados: 0 hits. Las 3 `EXPO_PUBLIC_*` son claves de cliente write-only (ingestión), no secretos.

## False positives descartados (skill)

- **`.env.example` con "DSN/keys"** → placeholders, no valores; y aun con valores reales serían write-only ingestion keys (públicas por diseño), no secretos. No es finding.
- **`Sentry.captureMessage(..., { tags })` con un `error` crudo** → el `error` NO se adjunta; solo se le extrae `.code`. Sin fuga.
- **BLE `message`/`label` string fields** → transporte, no PII; y scrubString taparía cualquier secreto embebido. LOW/no-finding.

---

## MEDIUM (no bloqueante)

### [MED-1] Denylist del scrubber incompleto para claves de credencial opacas + match exacto-normalizado
- **Location:** `app/src/services/observability/redact.ts:18-45` (denylist) + `:58-60` (`isDeniedKey` usa `Set.has` exacto).
- **Confidence:** High (el gap existe); **exploitabilidad HOY: baja** (no hay camino vivo que emita una sesión a Sentry).
- **Issue:** `normalizeKey` colapsa separadores/casing pero `isDeniedKey` matchea por **igualdad exacta** contra el set. Por eso `token` en el denylist **NO** cubre `refresh_token` (→ `refreshtoken`) ni `access_token` (→ `accesstoken`). Faltan además `session`, `secret`, `api_key`/`apikey`, `pwd`/`passwd`, `jwt`, `credential`, `pin`, `set-cookie`/`cookie` (todos en la tabla "avoid in logs" de la referencia data-protection de la skill). La defensa string (`STRING_SECRET_PATTERNS`) atrapa el `access_token` (es un JWT `eyJ…`) pero **NO** el `refresh_token` de Supabase, que es opaco (`v1.M…`) → no matchea ningún patrón.
- **Impact:** Si a futuro cualquier `console.error(..., session)` o `console.error(..., authObj)` cae en el árbol (el scrubber existe justamente como "guarda sobre la ausencia" para ese caso — `redact.ts:9`), `captureConsole('error')` lo serializa y el `refresh_token` **escaparía** (ni key-match ni string-match lo tapan). Un refresh token permite acuñar access tokens = takeover de cuenta hasta rotación/revocación. Hoy no hay tal `console.error` (whitelist-by-construction + los 2 sitios reales loguean un `err` benigno), por eso es MEDIUM y no HIGH.
- **Fix (elegí uno):**
  1. Cambiar `isDeniedKey` a match por inclusión sobre términos-raíz: `token`, `secret`, `password`/`passwd`/`pwd`, `session`, `apikey`, `credential`, `cookie`, `auth` — así `refresh_token`/`access_token`/`sessionid`/`api_key` colapsan solos. (Cuidado con falsos amigos benignos como `authenticated`/`authored`; si molesta, usar prefijo/sufijo `_token`/`token_`.)
  2. O ampliar `DENYLIST_RAW` con `access_token`, `refresh_token`, `session`, `secret`, `api_key`, `apikey`, `pwd`, `passwd`, `jwt`, `credential`, `pin`, `cookie`.
  3. Recomendado además: sumar un patrón string para el refresh token de Supabase si algún día viaja en un valor suelto (o confiar en el key-match del punto 1/2, que es lo robusto). Y agregar un test de falsificación con `{ session: { access_token:'eyJ…', refresh_token:'v1.opaco' } }` que asserte que **ninguno** de los dos sobrevive el serializado.

---

## LOW (anexo)

- **[LOW-1]** `captureConsoleIntegration` captura TODO `console.error` de la app; los 2 sitios de `provider.tsx` loguean un objeto `err` de conexión. Si ese `err` alguna vez trae texto libre con PII no-secreta (no clave, no patrón string), el scrubber key-based no lo tapa. Límite conocido y documentado (design §3, M1). Mitigado por R1.6/T10 (auditoría de call sites). Sin acción para este gate.
- **[LOW-2]** BLE `message`/`label` (free-text de transporte) se spreadea al breadcrumb sin key-deny. No es PII; scrubString cubre secretos embebidos. Aceptable.

---

## Archivos analizados

`observability/{env,redact,payloads,navigation,sentry,sentry.native,posthog,posthog.native}.{ts,tsx}` + `redact.test.ts`/`payloads.test.ts` · `_layout.tsx` · `_components/RootErrorBoundary.tsx` · `contexts/{AuthContext,EstablishmentContext}.tsx` · `powersync/connector.ts` · `ble/logging.ts` · `{invitar,maniobra/carga}.tsx` · `hooks/useImportRodeo.ts` · `.env.example` · (out-of-diff, contexto) `external-setup.md`, `.gitignore`.

## Cobertura indirecta (advertencia)

- La skill `sentry-skills:security-review` **no** cubre desde su ángulo: (a) el modelo de datos del SDK de Sentry/PostHog (qué campos adjunta `captureMessage`/`captureException` por defecto — lo verifiqué a mano: breadcrumbs acumulados van al evento y pasan por `beforeSend`), (b) la semántica de `normalizeKey`/`Set.has` (revisión manual → MED-1), (c) el union de tipos BLE (revisión manual → sin EID). Todo eso lo cubrí manualmente arriba.
- **NO corrí** `check.mjs` completo, ni migrations, ni el E2E full (por instrucción). No verifiqué en device que el SDK nativo respete `enabled:false`/`disabled:true` (es Fase 0, gated) — la ruta JS es no-op por platform-split, confirmado por lectura.
