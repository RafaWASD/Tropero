# Security review (modo `code`) — feature 16-ambientes-y-release · Run A (config foundation)

**Veredicto: PASS**

- **Baseline (Gate 2)**: `6aec2749583b9dde1d8410f19a8db0a5a4dc4b4d` (registrado en `progress/impl_16-runA.md` línea 1). Trabajamos sobre `main` sin feature-branch → todos los cambios de Run A están **sin commitear** en el working tree (`baseline_commit == HEAD`). Diff calculado con `git diff HEAD -- <files>` + archivos nuevos untracked + `git show HEAD:app/app.json` para el borrado.
- **Skill corrida**: `sentry-skills:security-review` sobre el diff. Superficie de ataque nula (config estática + resolución de env pura, sin sinks de inyección, sin input attacker-controlled que llegue a DB/comando/HTML). Data-flow trazado a mano para cada foco.
- **Resultado**: 0 findings HIGH. 0 findings RAFAQ-SPECIFIC. Ningún secreto al bundle, fail-closed intacto, flag E2E no explotable, `app.config.ts` fiel al `app.json` borrado.

---

## Findings HIGH de Sentry

Ninguno. La skill no identificó patrones vulnerables con input attacker-controlled: el diff no tiene sinks (no `eval`/`exec`/SQL/`innerHTML`/`fetch(userUrl)`), y todos los valores de config son **constantes server/build-controlled**, no atacables.

## Findings RAFAQ-SPECIFIC

Ninguno. Detalle de la verificación por foco:

### Foco 1 — Secrets al bundle (PASS)
Trazado todo lo que viaja al cliente vía `app.config.ts` + `extra` + `EXPO_PUBLIC_*`:
- `app.config.ts`: solo constantes públicas por diseño — `slug`, `scheme:'rafq'`, `version`, `owner:'rafaqsorg'`, `eas.projectId`, ids de app, y el `iosUrlScheme` de Google (`com.googleusercontent.apps.167085605126-...`). El reversed iOS client ID de Google es **público por diseño** (va embebido en todo cliente OAuth) y está **preservado verbatim** del `app.json` (no es nuevo). Ningún `service_role`, token, secret ni connection string.
- `extra`: quedó `{ router: {}, eas: { projectId } }`. Se **eliminó** `extra.supabaseUrl` (era `https://xrhlxxdnfzvdnztacofj.supabase.co`, valor público de todos modos, sin consumidores — grep A2/R2.5). Reducción de superficie, no regresión.
- `env.ts STATIC_ENV` (`app/src/utils/env.ts:16-21`): solo referencia `process.env.EXPO_PUBLIC_SUPABASE_URL`, `_ANON_KEY`, `_POWERSYNC_URL`, `_GOOGLE_WEB_CLIENT_ID`. Las 4 son `EXPO_PUBLIC_*` = **públicas por diseño** (URL Supabase, anon key, PowerSync URL, Google web client ID de feature 19). No se agregó ningún `EXPO_PUBLIC_*` nuevo secreto. La anon key es la publishable key (RLS es la frontera real), no la `service_role`.
- `APP_VARIANT` (`app.config.ts:25`): sin prefijo `EXPO_PUBLIC_`, se lee en **config-eval time (Node, build)**, nunca se bundlea; su dominio es `development`/otros, no es secreto.

### Foco 2 — Fail-closed de env (PASS)
- `resolveEnv` (`app/src/utils/env-resolve.ts:52-68`) es **byte-idéntico** al baseline: el `throw` accionable en español ante falta de cualquiera de las 3 requeridas (líneas 57-62) está intacto. El diff solo **insertó** `composeReader` antes; no tocó `resolveEnv`.
- `composeReader` (`env-resolve.ts:33-45`) trata string vacío como ausente en las 3 capas (`if (s && s.length > 0)`, `if (d && d.length > 0)`, y `extraRead` devuelve `undefined` para `''`) → nunca "resuelve" a `''`. Si ninguna capa aporta valor devuelve `undefined`, y `resolveEnv` tira el Error. No cae a default inseguro ni a string vacío. Cubierto por el test nuevo "R3.2: si ninguno resuelve → undefined (resolveEnv decide el fail-closed)" y por los tests históricos de `resolveEnv` que siguen verdes.

### Foco 3 — Flag E2E no explotable en prod (PASS)
`isE2E()` (`app/src/utils/app-env.ts:48-55`) es doble-gate:
- `globalThis.__RAFAQ_E2E__ === true` (strict) — solo lo pone Playwright vía `addInitScript` antes del boot (`app/e2e/helpers/fixtures.ts:41,71`). `fixtures.ts` es harness de test, **nunca se bundlea** en la app. No hay camino desde UI/input de usuario para setear ese global. Mismo patrón ya vetado por Gate 2 en `ble-e2e-flag.ts` (`=== true`, test (d) confirma que `'true'` string → false).
- `getAppEnv() === 'e2e'` — requiere `EXPO_PUBLIC_ENV === 'e2e'`, que es build/deploy-controlled. Un build de prod setea `production` (o ausente → default `development`, `app-env.ts:14`), nunca `e2e` por accidente. Valor fuera de dominio → default `development` (`app-env.ts:38-41`).
- **No queda colgado**: en Run A `isE2E()` aún no tiene consumidor. El consumidor futuro (feature 17: `enabled: !!dsn && !isE2E()`) usa el flag para **desactivar** telemetría, no para habilitar privilegios. Aun en un escenario teórico de XSS (que ya implicaría control de la página), setear `__RAFAQ_E2E__` solo apagaría telemetría — no hay escalación de privilegio. No explotable.

### Foco 4 — `app.config.ts` fiel/seguro (PASS)
Diff contra `git show HEAD:app/app.json`:
- **Idéntico** en todo lo sensible: `scheme:'rafq'`, `ios.usesAppleSignIn:true`, plugins google-signin (mismo `iosUrlScheme`) + apple-authentication (feature 19) + expo-sharing (Fase 0) + notifications/router/splash — mismo set, mismo orden. `android.permissions:['NOTIFICATIONS']` sin cambios: **no se agregaron permisos**. `infoPlist.UIBackgroundModes`, adaptiveIcon, favicon, `supportsTablet` preservados.
- **Únicas diferencias funcionales**: (a) variante dev agrega sufijo `.dev` al app id + " (Dev)" al name cuando `APP_VARIANT==='development'` (feature intencional R2.4; para builds no-dev el resultado es semánticamente idéntico al `app.json`); (b) `extra.supabaseUrl` eliminado (público, sin consumidores).
- `APP_VARIANT` **no filtra config de prod en dev ni viceversa**: solo ramifica `name` + app `id`. NO selecciona backend/endpoints — las URLs/keys vienen de `EXPO_PUBLIC_*` inyectadas por el perfil EAS (Run B, fuera de scope), no de este archivo. Sin riesgo de que un build dev apunte al backend de prod por este archivo.

## False positives descartados

La skill no emitió findings sobre este diff (sin sinks). No hubo que descartar false positives; el trabajo fue verificación positiva de los 4 focos + confirmar que `resolveEnv` no se debilitó.

## Tabla de inputs

Run A no introduce ni modifica formularios, buscadores, campos de texto libre ni prompts. Los únicos "inputs" son variables de entorno **server/build-controlled** (no attacker-controlled):

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `process.env.APP_VARIANT` (build-time) | dominio implícito `development` vs resto | server (build-time, Node) — solo ramifica name/id | OK |
| `EXPO_PUBLIC_ENV` (build/runtime) | dominio `{development,preview,production,e2e}`, fuera-de-dominio → default `development` | server (validación de dominio en `getAppEnv`, `app-env.ts:38-41`) | OK |
| `EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY/_POWERSYNC_URL` | requeridas | server — fail-closed en `resolveEnv` (throw) | OK |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | opcional (feature 19, fuera del fail-closed) | server — degradación aceptada R7.4 | OK |
| `globalThis.__RAFAQ_E2E__` | strict `=== true` | no attacker-controlled (solo Playwright addInitScript, no-bundleado) | OK |

## Tabla de rate limits

Run A no toca ninguna acción abusable (no Edge Functions, no email/SMS, no APIs externas, no bulk/import, no buscadores, no endpoints). Es config estática + resolución de env pura.

| acción | rate limit (sí/no/n.a.) | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| (ninguna) | n.a. | n.a. | n.a. | Run A no expone acciones con costo/frecuencia; sin superficie de abuso |

## Archivos analizados

- `app/app.config.ts` (nuevo) — vs `git show HEAD:app/app.json` (borrado)
- `app/app.config.test.ts` (nuevo)
- `app/src/utils/app-env.ts` (nuevo) + `app/src/utils/app-env.test.ts` (nuevo)
- `app/src/utils/env-resolve.ts` (`composeReader` agregado; `resolveEnv` intacto) + `env-resolve.test.ts`
- `app/src/utils/env.ts` (`STATIC_ENV` + `composeReader`)
- `app/e2e/helpers/fixtures.ts` (shim E2E)
- `scripts/run-tests.mjs` (registro de 2 units nuevas — sin superficie de seguridad)
- Referencia comparada: `app/app/_components/ble-e2e-flag.ts` (patrón de flag E2E ya vetado)

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: n.a. — Run A no toca `supabase/functions/*`.
- **RLS / migrations**: n.a. — Run A no toca DB ni policies.
- **PowerSync sync rules**: n.a. — Run A no toca `sync-streams/*` ni schema PowerSync.
- **BLE**: n.a. — no se toca `services/ble/*`; solo se compara contra el patrón de `ble-e2e-flag.ts` como referencia del guard E2E.
- La skill de Sentry no cubre nativamente Deno/RLS/PowerSync/RN, pero **ninguno de esos dominios está en el diff de Run A** → sin gap de cobertura para este chunk. Estos dominios entran cuando aterricen Runs B–F (eas.json, deploys, OTA).
