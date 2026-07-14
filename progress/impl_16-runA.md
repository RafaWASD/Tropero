baseline_commit: 6aec2749583b9dde1d8410f19a8db0a5a4dc4b4d

# impl 16 — Ambientes y release · Run A (config foundation)

**Feature**: `16-ambientes-y-release` (in_progress, Puerta 1 aprobada).
**Chunk**: SOLO Run A (config: `app.json`→`app.config.ts` + lecturas estáticas en `env.ts`/`env-resolve.ts` + `EXPO_PUBLIC_ENV`/`app-env.ts` + shim E2E de `fixtures.ts`). Runs B–F NO se tocan.
**Baseline (Gate 2)**: `6aec2749583b9dde1d8410f19a8db0a5a4dc4b4d` (SHA previo a la primera task de la feature; trabajamos sobre `main`, sin feature-branch).

## Reconciliación crítica sobre el as-built (NO sobre el snapshot de la spec)

La spec de 16 se escribió antes de la feature 19 (login social) y de Fase 0 (chore Gradle), ambas YA en `main`. Leí el estado ACTUAL antes de tocar:

- **Feature 19** dejó en `app.json`: `scheme: "rafq"`, `ios.usesAppleSignIn: true`, plugin `@react-native-google-signin/google-signin` (con `iosUrlScheme`), plugin `expo-apple-authentication`. En `env-resolve.ts`: `googleWebClientId` OPCIONAL fuera del fail-closed (R7.4 de la 19). Todo PRESERVADO en `app.config.ts` y en el nuevo cableado de `env.ts`.
- **Fase 0** dejó en `app.json` el plugin `expo-sharing`. PRESERVADO.
- `app.json` NO tiene `expo-updates` todavía (Fase 0 lo aporta después) → `app.config.ts` queda estructurado para recibir `updates`/`runtimeVersion`/plugin sin conflicto, no los redacta (design §1 Dependencia de Fase 0).

## Plan (tasks Run A)

- [x] A1 — `app/app.config.ts` (reemplaza `app/app.json`) con `APP_VARIANT`.
- [x] A2 — grep de `extra.supabaseUrl` → eliminar si sin consumidores.
- [x] A3 — `env-resolve.ts`: `composeReader` puro (estático→dinámico→extra).
- [x] A4 — `env.ts`: mapa STATIC (accesos literales) + `composeReader`.
- [x] A5 — `app/src/utils/app-env.ts` (`getAppEnv`/`isE2E`/`APP_E2E_GLOBAL_KEY`) + test.
- [x] A6 — `fixtures.ts`: shim `EXPO_PUBLIC_ENV='e2e'` + `window.__RAFAQ_E2E__=true`.
- [x] A7 — registrar units nuevas en `run-tests.mjs`; check verde (lo corre reviewer/Explore).

## A2 — resultado del grep (R2.5)

`Grep` de `expoConfig.extra`/`.extra.`/`supabaseUrl` en `app/` (`*.ts*`):
- **Ningún** consumidor de la clave literal `Constants.expoConfig.extra.supabaseUrl`.
- El único lector de `extra` es `env.ts → extraRead`, que lee `extra[name]` con `name = EXPO_PUBLIC_*` (nunca la clave `supabaseUrl`). Los demás matches de `supabaseUrl` son destructuring local de `getEnv()`/`getE2EEnv()` (variables), no lecturas de `extra`.
- **Decisión**: `extra.supabaseUrl` ELIMINADO de `app.config.ts` (R2.5 se cumple: no había consumidor). Se conserva `extra.router` y `extra.eas.projectId`.

## Mapa R<n> → archivo:test (Run A)

| R | Cobertura |
|---|---|
| R2.1 | `app/app.config.test.ts` "R2.1: preserva slug/scheme/version/owner/eas.projectId + plugins OAuth de la 19 + expo-sharing" |
| R2.2 | `app/app.config.test.ts` "R2.2/R2.4: APP_VARIANT=development → RAFAQ (Dev) + ar.rafq.app.dev" |
| R2.3 | `app/app.config.test.ts` "R2.3: sin APP_VARIANT → RAFAQ + ar.rafq.app" + "R2.3: APP_VARIANT!=development → RAFAQ" |
| R2.4 | `app/app.config.test.ts` (ids `.dev` vs base distintos → coexisten) |
| R2.5 | `app/app.config.test.ts` "R2.5: extra.supabaseUrl eliminado" + grep documentado arriba |
| R3.1 | `app/src/utils/env-resolve.test.ts` composeReader "(a) estático gana"; static literals en `env.ts`/`app-env.ts` |
| R3.2 | `env-resolve.test.ts` composeReader "(b) cae al dinámico" + "(c) cae a extra"; `app-env.test.ts` fallback dinámico |
| R3.3 | `env-resolve.test.ts` (los tests de `resolveEnv` intactos siguen verdes: fail-closed español sin cambios) |
| R3.4 | `app/src/utils/app-env.test.ts` "getAppEnv dominio + default development" |
| R3.5 | `app/e2e/helpers/fixtures.ts` (shim `EXPO_PUBLIC_ENV='e2e'`) — verificado por la suite E2E completa verde |
| R3.6 | `app-env.test.ts` "(b) EXPO_PUBLIC_ENV=e2e → isE2E true" + "(c) globalThis.__RAFAQ_E2E__=true → isE2E true" |
| R3.7 | `app-env.test.ts` "(a) sin marca ni env → isE2E false" + "(d) marca != true no activa" |
| R1.3 | invariante de check.mjs verde (default DEV) — lo corre reviewer/Explore |

## Verificación local (implementer)

- `pnpm -C app typecheck` → **verde** (`app.config.ts` typecheckea contra `ExpoConfig`; todos los campos as-built existen en el tipo).
- Units nuevas (`env-resolve` + `app-env` + `app.config`) → **26/26 pass** (`node --test` con `ts-ext-resolver`).
- `pnpm exec expo export -p web` → **"Exported: dist"** (13 web bundles). Confirma que `app.config.ts` carga (Expo lo evalúa) y el bundle compila. Sin `design/**/*.png` espurios esta vez; `app/dist` gitignoreado.
- `check.mjs` completo (14 suites, DEV) + suite E2E → los corre el **reviewer/Explore** (verify = read-only). Invariante: default DEV = cero cambio.

## Autorrevisión adversarial (paso 8)

Pasada hostil buscando desviaciones/bugs/gaps; lo encontrado ya está cerrado:

- **Gotcha babel (el riesgo central)**: verifiqué que el fallback dinámico use key VARIABLE (`process.env[ENV_KEY]` / `process.env[name]`), NO un literal — babel solo inlinea `process.env.EXPO_PUBLIC_X` (miembro literal). Así el shim E2E de `fixtures.ts` (runtime) sigue siendo captado por el reader dinámico aunque el estático quede `undefined` en el build. Confirmado contra el patrón histórico de `env.ts`.
- **Shim E2E intacto sin tocar specs**: el reader dinámico se preserva idéntico → los ~70 specs (que setean `globalThis.process.env.EXPO_PUBLIC_*`) siguen andando. El `EXPO_PUBLIC_ENV='e2e'` nuevo lo capta el dynamic read de `app-env.ts`; `window.__RAFAQ_E2E__` lo lee `isE2E()`. Doble gate (flag global O env) → robusto aunque el build inline `EXPO_PUBLIC_ENV` con otro valor.
- **`isE2E()` no tiene camino de usuario**: la marca `window.__RAFAQ_E2E__` solo la pone Playwright vía `addInitScript` antes del boot (mismo patrón que `ble-e2e-flag.ts`, ya vetado por Gate 2). No se puede setear desde UI/input. Strict `=== true` (test (d) cubre valor "true" string → false).
- **`resolveEnv` fail-closed intacto (R3.3)**: no lo toqué; los 8 tests históricos (incl. los de la feature 19) siguen verdes. El copy español no cambió.
- **Preservación de la feature 19 + Fase 0**: test explícito verifica google-signin + apple-authentication + `ios.usesAppleSignIn` (19) y `expo-sharing` (Fase 0) en `app.config.ts`. `scheme: 'rafq'` preservado.
- **`extra.supabaseUrl` (R2.5)**: grep confirmó cero consumidores de la clave literal → eliminado sin romper nada (el fallback `extra` lee `EXPO_PUBLIC_*`, nunca `supabaseUrl`). Test verifica que se fue y que `router`/`eas` quedan.
- **Código muerto evitado**: NO metí `EXPO_PUBLIC_ENV` en el STATIC de `env.ts` (sería inlineado pero nunca consumido por `resolveEnv`) → su acceso estático vive en `app-env.ts`, su consumidor. Reconciliado en `design.md`.
- **Sin colisión de test runners**: `app.config.test.ts`/`app-env.test.ts` usan `node:test` y viven fuera de `e2e/` (Playwright `testDir: './e2e'`) → no los recoge Playwright. `**/*.test.ts` excluido del typecheck; `app.config.ts` sí typecheckea.
- **Scope**: NO toqué `eas.json` (Run B/R4), `metro.config.js` (Fase 0), ni nada de PROD. Run A puro (default DEV).

## Reconciliación de specs (paso 9)

- **`design.md §2`**: agregada nota "Reconciliación as-built (Run A)" — el acceso estático de `EXPO_PUBLIC_ENV` (R3.1) vive en `app-env.ts` (su consumidor), no en el STATIC de `env.ts` (evita código muerto); y el STATIC de `env.ts` suma `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (reconciliación con feature 19). R3.1 sigue cumpliéndose (cada var pública por acceso literal, en el módulo que la consume). Sin cambio de EARS (el *qué* no cambió).
- **`requirements.md`**: sin cambios (los EARS R2.*/R3.* describen el comportamiento tal cual quedó). El estado de Puerta 1 lo owna el leader.
- **`tasks.md`**: A1–A7 marcadas `[x]`.
- **`app.config.ts`** vs snippet de `design.md §1`: `extra.supabaseUrl` eliminado (el snippet ya lo condicionaba al grep). Sin otra divergencia material.
