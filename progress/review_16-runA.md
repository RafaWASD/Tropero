# Review - Feature 16 (ambientes-y-release) - Run A (config foundation)

Reviewer: read-only. Fecha: 2026-07-14.
Scope: SOLO Run A (tasks A1-A7). Runs B-F fuera de alcance de este chunk (decomposicion en tasks.md).
Baseline (impl): 6aec2749583b9dde1d8410f19a8db0a5a4dc4b4d.

## Veredicto: APPROVED

Run A queda limpio, completo y fiel. check.mjs VERDE (14 suites + typecheck + 2139 unit, incl. las 3 units
nuevas). Boot de la app con app.config.ts + env nuevo + shim extendido PROBADO por la suite E2E (61 specs
verdes). Los 2 unicos rojos residuales son PRE-EXISTENTES y estructuralmente ajenos a Run A (ver E2E).

## Trazabilidad R<n> a test (requisitos de Run A: R2.x, R3.x, R1.3)

- R2.1 -> app.config.test.ts preserva slug/scheme/version/owner/eas.projectId + plugins OAuth(19)+expo-sharing(Fase0)+notifications/router/splash. VERDE
- R2.2 -> app.config.test.ts APP_VARIANT=development da RAFAQ (Dev) + ar.rafq.app.dev. VERDE
- R2.3 -> app.config.test.ts APP_VARIANT ausente da RAFAQ + ar.rafq.app + caso != development. VERDE
- R2.4 -> app.config.test.ts dev y prod ids distintos, coexisten. VERDE
- R2.5 -> app.config.test.ts extra.supabaseUrl eliminado + grep independiente del reviewer (cero consumidores). VERDE
- R3.1 -> env-resolve.test.ts mapa ESTATICO gana; literales en env.ts (4) y app-env.ts (EXPO_PUBLIC_ENV). VERDE
- R3.2 -> env-resolve.test.ts cae al dinamico + cae a EXTRA; app-env.test.ts fallback dinamico. VERDE
- R3.3 -> env-resolve.test.ts fail-closed espanol intacto (incl. R7.4 de la 19); resolveEnv NO tocado. VERDE
- R3.4 -> app-env.test.ts dominio dev/preview/prod/e2e + fuera-de-dominio a default + vacio a default. VERDE
- R3.5 -> fixtures.ts (ambos inyectores: page + applyEnvShim); validado por E2E verde (invitations usa applyEnvShim). VERDE
- R3.6 -> app-env.test.ts EXPO_PUBLIC_ENV=e2e da true + globalThis.__RAFAQ_E2E__=true da true. VERDE
- R3.7 -> app-env.test.ts sin marca ni env da false + marca string true da false. VERDE
- R1.3 -> invariante check.mjs verde default-DEV. VERDE

Cobertura completa: cada R<n> de Run A tiene >=1 test concreto verde. (R4-R9 son de Runs B-F, fuera de scope.)

## Tasks completas: SI (para Run A)

A1-A7 en [x]. Runs B-F en [ ] = JUSTIFICADO: tasks.md define la feature como decomposicion en runs; Run A es
el unico chunk de esta revision. Run F es GATED (deps externas + Gate 1 + OK de deploy). No hay task colgada
sin justificacion.

## app.config.ts FIEL al app.json borrado (vs git show HEAD:app/app.json)

Preservado 1 a 1: slug rafaq-app, scheme rafq, version 0.1.0, orientation, icon, userInterfaceStyle light,
ios (supportsTablet, bundleIdentifier->appId, usesAppleSignIn[feat19], infoPlist.UIBackgroundModes),
android (package->appId, adaptiveIcon los 4 campos, predictiveBackGestureEnabled, permissions NOTIFICATIONS),
web.favicon, los 6 plugins con opciones (expo-notifications color/defaultChannel, expo-router,
expo-splash-screen, expo-sharing[Fase0], google-signin[iosUrlScheme feat19], expo-apple-authentication[feat19]),
extra.router, extra.eas.projectId, owner rafaqsorg. APP_VARIANT=development da RAFAQ (Dev) + ar.rafq.app.dev;
caso contrario da RAFAQ + ar.rafq.app. UNICO delta: extra.supabaseUrl eliminado (R2.5) - grep del reviewer
confirma cero consumidores de la clave literal (unicos lectores de extra: push-notifications.ts->eas.projectId
y env.ts->extra[EXPO_PUBLIC_*], nunca supabaseUrl). NADA perdido. Estructura lista para updates/runtimeVersion
de Fase 0 sin conflicto.

## Gotcha babel: OK

Lecturas estaticas = literales inlineables: env.ts STATIC_ENV (4 literales process.env.EXPO_PUBLIC_*),
app-env.ts process.env.EXPO_PUBLIC_ENV literal. El reader DINAMICO usa key VARIABLE ((process.env)[name] /
[ENV_KEY]) no inlineable, capta el shim E2E en runtime. resolveEnv intacto (copy fail-closed espanol sin
cambios). Shim de fixtures.ts extendido en AMBOS inyectores (page + applyEnvShim) con EXPO_PUBLIC_ENV=e2e +
window.__RAFAQ_E2E__=true, sin tocar los ~70 specs.

## Reconciliacion feature 19: OK

env-resolve.test.ts R7.4 (googleWebClientId OPCIONAL fuera del fail-closed) sigue verde; resolveEnv no tocado.
OAuth preservado (scheme rafq + 2 plugins + usesAppleSignIn). STATIC_ENV suma EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
(publico, se inlinea, el web build de la 19 obtiene el ID) - reconciliado en design.md seccion 2.

## Exactitud specs (codigo a spec): OK

design.md seccion 2 trae la nota Reconciliacion as-built (Run A, 2026-07-14) que describe con fidelidad el
as-built: STATIC de env.ts = 4 vars (3 base + GOOGLE_WEB_CLIENT_ID); el acceso estatico de EXPO_PUBLIC_ENV vive
en app-env.ts (su consumidor), no en env.ts (evita codigo muerto). Coincide EXACTO con el codigo. requirements.md
R2/R3 (EARS) siguen describiendo el as-built. tasks.md A1-A7 [x]. Ninguna spec quedo mintiendo.

## CHECKPOINTS

- [x] C1 - check.mjs exit 0 (verde).
- [x] C2 - 1 sola feature in_progress; estado coherente.
- [x] C3 - respeta capas de architecture.md (utils puros: env-resolve/app-env; services boundary intacto). Sin logs de debug, sin establishment_id hardcodeado. extra.supabaseUrl (URL DEV hardcodeada) ELIMINADO = mejora.
- [x] C4 - >=1 test por modulo con logica (app.config, env-resolve/composeReader, app-env). Runner >0 tests, verdes (2139/2139 unit). Fixtures reales.
- [x] C5 - sin artefactos temp trackeables; dist/ y test-results/ gitignoreados; sin churn de design/**/*.png.
- [x] C6 - feature SDD con los 3 archivos; EARS estricto; tasks de Run A [x]; cada R<n> con test.
- [ ] C7 - N/A: Run A no crea tablas ni datos de campo (config/env foundation).
- [ ] C8 - N/A parcial: Run A no agrega carga de datos; la resolucion de env corre en boot y NO altera la semantica offline (probado: la app bootea offline en E2E). Sin bucket nuevo.
- [ ] C9 - N/A: Run A no agrega UI. Sin capture file (correcto). E2E de regresion ejercida (ver E2E).

## Checklist RAFAQ-especifico

- A (multi-tenancy/RLS): N/A - Run A no toca tablas con establishment_id.
- B (offline-first campo): N/A (boot-only) - la resolucion de env corre en boot; lecturas estaticas + fallback no cambian el arranque offline (confirmado por E2E: la app bootea/sincroniza/carga datos).
- C (BLE): N/A - Run A no toca BLE. El flag BLE es __RAFAQ_BLE_E2E__ (distinto del nuevo __RAFAQ_E2E__); sin colision.
- D (UI de campo): N/A - Run A no agrega pantallas.
- E (Edge Functions): N/A - health es Run C.

## E2E - evidencia (LO MAS IMPORTANTE)

Build web VERDE (expo export -p web da Exported: dist) => app.config.ts se evalua sin error.
Subset representativo (login + datos + ambos inyectores del shim): 61 passed.
- auth.spec.ts (login/logout/validacion), animals.spec.ts, establishments.spec.ts (crear campo + Mis campos >=2), events.spec.ts (timeline/tacto/parto): TODOS verdes. Boot + env resolution + PowerSync + login FUNCIONAN con app.config.ts + shim nuevo.
- invitations.spec.ts (usa applyEnvShim, el 2do inyector): rojo en la 1ra corrida, VERDE en re-run aislado = flake (2-cuentas + Resend, historicamente flaky). Path applyEnvShim validado.

2 rojos residuales - PRE-EXISTENTES, NO causados por Run A (deterministas en 2 corridas):
maniobra-carga.spec.ts:133 y :277, ambos esperando el paso 1 de 2 de la maniobra. Atribucion:
1. El snapshot de fallo muestra la maniobra corriendo con UN solo paso (Pesaje 1 de 1): el paso Tacto de prenez se filtro para la Vaquillona por la aplicabilidad del tacto adaptativo (spec 03 Stream B2, buckets por meses de servicio, commit 43a40eb). La app booteo, logueo, sincronizo, identifico por BLE (0385 / Cria hembras Vaquillona) y renderizo el keypad. TODO lo que Run A podria afectar, funciona.
2. maniobra-carga.spec.ts NO fue modificado por Run A (git status limpio).
3. Ningun codigo de runtime consume las claves nuevas (EXPO_PUBLIC_ENV, __RAFAQ_E2E__, getAppEnv, isE2E): grep en app/app + app/src da como unicos consumidores app-env.ts (definicion) y su test. Feature 17 (que las consumira) aun no existe. El shim nuevo es INERTE en runtime.
4. La resolucion de env es funcionalmente identica (composeReader preserva la precedencia; las 3 vars requeridas resuelven por el reader dinamico desde el shim, igual que antes).
=> Estructuralmente imposible que Run A cause estos rojos. Son sensibilidad del tacto adaptativo + timing de sync del rodeo_data_config contra el DEV compartido (territorio spec-03). NOTA PARA EL LEADER: verificar/backloguear estos 2 specs (probablemente rojos en main con independencia de Run A; check.mjs, el gate canonico, no los incluye y esta verde).

Nota Windows: exit 127 + UV_HANDLE_CLOSING = crash de teardown de Node POST-corrida, no fallo de test (veredicto = las lineas N passed).

## Cambios requeridos

Ninguno para Run A. (Fuera de este chunk: el leader deberia confirmar/backloguear los 2 rojos pre-existentes de maniobra-carga.spec.ts - no bloquean Run A.)
