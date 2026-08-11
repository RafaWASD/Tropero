// dev-crash-gate — ¿se monta el chip «crash de prueba» del `RootErrorBoundary`? (feature 17, R2.6)
//
// ── EL DEFECTO QUE LO SACÓ DEL .tsx (build 5 de iOS, TestFlight, 2026-08-10) ─────────────────────────
// Raf abrió el build de TestFlight en su iPhone y la pantalla principal mostraba el chip «crash»: un
// botón que CIERRA la app a propósito, pensado para validar el pipeline ErrorBoundary → Sentry. Dos
// causas encadenadas, y las dos se arreglaron:
//   1. `getAppEnv()` cae al default `development` cuando falta `EXPO_PUBLIC_ENV`, y NINGÚN perfil de
//      `app/eas.json` la declaraba → todo build (incluido `production`) se creía en desarrollo.
//      Fix: cada perfil declara su ambiente (guard: `app/eas-profiles-guard.test.ts`).
//   2. El gate era `development || preview`, y `preview` es justamente lo que va a los testers (el APK
//      interno) y a TestFlight (`testflight-dev`). O sea que aun con (1) arreglado, el chip seguía
//      apareciéndole a Facundo y podía tocarlo un revisor de Apple. Fix: `development` a secas — y en la
//      vuelta 2, `__DEV__ && development` (ver el bloque de abajo).
//
// ── POR QUÉ ES UN MÓDULO PROPIO Y NO UNA LÍNEA ADENTRO DEL COMPONENTE ────────────────────────────────
// La suite unitaria corre con `node --test` + type-stripping, que **no puede importar JSX**: mientras la
// decisión viviera dentro de `RootErrorBoundary.tsx` el único oráculo posible era un regex sobre el
// fuente — o sea un test que pasa por parecido, no por comportamiento. Es una decisión de una línea y es
// EXACTAMENTE la línea que se equivocó: tiene que ser ejecutable. El componente ya no decide, delega
// (y `dev-crash-gate.test.ts` verifica estáticamente que siga delegando).
//
// ── VUELTA 2 (2026-08-11): SEGUNDA LLAVE, `__DEV__` ──────────────────────────────────────────────────
// `EXPO_PUBLIC_ENV` sola es una llave que depende de que alguien se acuerde de declararla. Los perfiles
// de `eas.json` la declaran (con guard), pero **un bundle que no salga de EAS no lee `eas.json`**:
// `./gradlew assembleRelease` local, `expo run:android --variant release`, un `expo export` embebido, un
// perfil futuro que nazca fuera del guard. En cualquiera de esos, `getAppEnv()` cae al default
// `development` (R3.4) y el chip volvía a aparecer. `__DEV__` NO depende de acordarse de nada: lo escribe
// el bundler en el prelude según el modo del bundle. Un binario release nunca lo tiene en true.
//
// VERIFICADO, no deducido (2026-08-11, Metro real del proyecto vía `runServer` + fetch de la misma URL
// que arma el dev client de Android, `DevServerHelper.kt:292`):
//   GET /..bundle?platform=android&dev=true  → prelude `var __BUNDLE_START_TIME__=…,__DEV__=true,…`
//                                              y `x = __DEV__;` queda como identificador (sin inlinear)
//   GET /..bundle?platform=android&dev=false → prelude `…,__DEV__=false,…`, `x = false;` inlineado y la
//                                              rama `if (__DEV__)` ELIMINADA del bundle
// Y el dev client SÍ pide `dev=true`: Android manda `dev=<settings.isJSDevModeEnabled>`, que por defecto
// es `true` (`DevInternalSettings.kt:49`), y el launcher de iOS lo hardcodea
// (`EXDevLauncherController.m:427`: `index.bundle?platform=%@&dev=true&minify=false`). O sea: el dev
// client del perfil `development` de EAS SIGUE mostrando el chip — que es el único lugar donde sirve.
//   Excepción conocida y aceptada: si alguien apaga "JS Dev Mode" en el menú de RN, el dev client pide
//   `dev=false` y el chip desaparece. Es una decisión explícita de quien desarrolla, no un accidente.
//
// Lo que este AND **no** arregla, para que no quede un falso sentido de cierre: `./gradlew assembleDebug`
// (el build local que se usa en el device de QA) es debug y corre contra Metro → `__DEV__` es `true` y el
// ambiente es `development` → el chip SIGUE apareciendo ahí. Y está bien: eso es literalmente un entorno
// de desarrollo, con Metro atado a la máquina de Raf. El agujero que se cierra es el del bundle RELEASE
// sin `EXPO_PUBLIC_ENV`, no el del debug local.

import { getAppEnv } from './app-env';

/**
 * ¿El bundle se compiló en modo desarrollo? Lee el `__DEV__` que el bundler escribe en el prelude.
 * `typeof` de un identificador NO declarado no tira `ReferenceError` (por eso no hace falta try/catch:
 * un catch que ningún test puede poner en rojo es una rama muerta) → bajo `node --test`, donde `__DEV__`
 * no existe, esto da `false`; los tests simulan el bundler seteando `globalThis.__DEV__`.
 * Se lee el IDENTIFICADOR pelado a propósito (no `globalThis.__DEV__`): es la forma que Metro inlinea,
 * así en un bundle release la comparación se pliega a `false` en tiempo de build.
 */
function isDevBundle(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * `true` SOLO en un bundle de desarrollo Y con ambiente `development`. Las dos llaves, y cada una tapa el
 * agujero de la otra:
 *   - `__DEV__` sin el ambiente: el export web de E2E y cualquier release quedan afuera aunque falte la
 *     variable — pero `pnpm start` apuntando a un backend de preview mostraría el chip.
 *   - el ambiente sin `__DEV__`: un binario release fuera de EAS cae al default `development` (R3.4) y el
 *     chip vuelve. Es el caso que agrega la vuelta 2.
 * Deliberadamente NO incluye `preview` (el APK interno y TestFlight son `preview` — es el defecto del
 * build 5) ni `e2e` (el chip es un overlay absoluto: taparía la esquina superior izquierda de ~70 specs)
 * ni `production`.
 */
export function isDevCrashEnabled(): boolean {
  return isDevBundle() && getAppEnv() === 'development';
}
