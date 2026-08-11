// Tests del gate del chip «crash de prueba» (feature 17 R2.6, corregido tras el build 5 de iOS).
//
// Dos oráculos, y hacen falta los dos:
//   (A) COMPORTAMIENTO — `isDevCrashEnabled()` sobre la MATRIZ `__DEV__` × ambiente. Con el gate de la
//       vuelta 1 (`getAppEnv() === 'development'` a secas) la fila `__DEV__ = false` sale ROJA: eso es lo
//       que hace que este test mida el cambio y no el parecido.
//   (B) ESTÁTICO — que `RootErrorBoundary.tsx` siga DELEGANDO la decisión. (A) no puede ver un componente
//       que vuelva a decidir por su cuenta (`getAppEnv() === ...` inline), que es justo el estado del que
//       venimos y el que node:test no puede importar (es JSX). Y de yapa: NINGUNA pantalla puede tomar
//       una decisión de ambiente inline — el modo de falla fue "algo dev-only que llega a los testers",
//       y se cierra sobre la AUSENCIA (una pantalla nueva que lo intente nace en rojo).
//
// Sobre `__DEV__`: bajo `node --test` no existe (lo escribe el bundler en el prelude del bundle). Los
// tests lo SIMULAN seteando `globalThis.__DEV__`, y limpian después — el estado "ausente" es un caso más
// de la matriz, no el default accidental de la corrida.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDevCrashEnabled } from './dev-crash-gate.ts';
import { APP_ENVS, type AppEnv } from './app-env.ts';
import { stripSourceComments } from './strip-comments.ts';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // app/
const BOUNDARY = join(APP_ROOT, 'app', '_components', 'RootErrorBoundary.tsx');

const g = globalThis as Record<string, unknown>;
const DEV_KEY = '__DEV__';

/** Simula el prelude del bundler. `undefined` = el global NO existe (un runtime sin `__DEV__`). */
function setDev(dev: boolean | undefined): void {
  if (dev === undefined) delete g[DEV_KEY];
  else g[DEV_KEY] = dev;
}

/** Corre el gate con `__DEV__` y `EXPO_PUBLIC_ENV` en el estado pedido. */
function gateWith(dev: boolean | undefined, env: AppEnv | undefined): boolean {
  setDev(dev);
  if (env === undefined) delete process.env.EXPO_PUBLIC_ENV;
  else process.env.EXPO_PUBLIC_ENV = env;
  return isDevCrashEnabled();
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_ENV;
  setDev(undefined);
});

afterEach(() => {
  // Sin leak entre casos NI hacia otros archivos que comparten proceso: un caso que dejó `__DEV__ = true`
  // haría pasar por accidente al siguiente.
  delete process.env.EXPO_PUBLIC_ENV;
  setDev(undefined);
});

// ── (A) COMPORTAMIENTO: la matriz `__DEV__` × ambiente ────────────────────────────────────────────────

test('LAS 4 COMBINACIONES: el chip pide bundle de dev Y ambiente development (AND, no OR)', () => {
  // La matriz completa y explícita, con el escenario real de cada celda. Es la tabla de verdad del gate:
  //
  //   __DEV__ | ambiente     | chip  | escenario real
  //   --------+--------------+-------+------------------------------------------------------------------
  //    true   | development  | SÍ    | `pnpm start` / dev client de EAS / `gradlew assembleDebug` + Metro
  //    true   | preview      | no    | dev client apuntado a un backend de preview
  //    false  | development  | no    | ← LA VUELTA 2: bundle RELEASE sin EXPO_PUBLIC_ENV (gradlew
  //           |              |       |   assembleRelease, expo run --variant release): getAppEnv() cae al
  //           |              |       |   default `development` (R3.4) y el chip volvía a aparecer
  //    false  | preview      | no    | el APK interno / TestFlight — el defecto del build 5
  //
  const matrix: Array<{ dev: boolean; env: AppEnv; expected: boolean; why: string }> = [
    { dev: true, env: 'development', expected: true, why: 'dev server / dev client: el ÚNICO lugar donde el chip sirve' },
    { dev: true, env: 'preview', expected: false, why: 'bundle de dev pero apuntando a preview: no es un ambiente de desarrollo' },
    { dev: false, env: 'development', expected: false, why: 'bundle RELEASE que cayó al default `development` por falta de EXPO_PUBLIC_ENV' },
    { dev: false, env: 'preview', expected: false, why: 'release + preview: el APK de los testers y TestFlight' },
  ];
  for (const { dev, env, expected, why } of matrix) {
    assert.equal(
      gateWith(dev, env),
      expected,
      `__DEV__=${dev} × ambiente=${env} debía dar ${expected} (${why})`,
    );
  }
});

test('bundle RELEASE sin EXPO_PUBLIC_ENV → NO hay chip (el build nativo fuera de EAS)', () => {
  // El agujero exacto de la vuelta 2, aislado: `eas.json` no lo lee nadie en un build local, la variable
  // no existe, `getAppEnv()` devuelve `development`… y aun así el chip NO se monta, porque el bundle es
  // release. Es la mitad del gate que NO depende de que alguien se acuerde de declarar una variable.
  assert.equal(gateWith(false, undefined), false);
});

test('sin EXPO_PUBLIC_ENV pero en bundle de DEV → habilitado (el `pnpm start` local)', () => {
  // La contracara: en la máquina de quien desarrolla el chip tiene que seguir estando. Documenta el
  // acoplamiento con el default de `getAppEnv()`, que ahora solo gobierna al dev server.
  assert.equal(gateWith(true, undefined), true);
});

test('el dev client de EAS (perfil `development`) SIGUE mostrando el chip', () => {
  // VERIFICADO empíricamente (2026-08-11) contra el Metro real del proyecto: el bundle servido con
  // `dev=true` trae `__DEV__=true` en el prelude, y el dev client pide justamente `dev=true` (Android:
  // `settings.isJSDevModeEnabled`, default true en `DevInternalSettings.kt:49`; iOS: hardcodeado en
  // `EXDevLauncherController.m:427`). El perfil `development` de `eas.json` declara
  // `EXPO_PUBLIC_ENV: development` → las dos llaves dan true. Si este caso se pone rojo, el arreglo se
  // convirtió en una regresión: el chip desaparecería del único lugar donde sirve.
  assert.equal(gateWith(true, 'development'), true);
});

test('`__DEV__` AUSENTE (runtime sin la marca del bundler) → NO hay chip (fail-closed)', () => {
  // No es un caso hipotético: es exactamente lo que ve `node --test`, y es la postura correcta para
  // cualquier runtime que no sea un bundle de desarrollo. Ausente ≠ dev.
  for (const env of APP_ENVS) {
    assert.equal(gateWith(undefined, env), false, `el chip quedó habilitado sin __DEV__ en ${env}`);
  }
  assert.equal(gateWith(undefined, undefined), false);
});

test('preview NO habilita el chip (el APK interno y TestFlight son preview — es el defecto del build 5)', () => {
  // Éste es el caso que estaba roto: `preview` es el perfil que se le manda a Facundo y el que sube a
  // TestFlight. Un botón que cierra la app a propósito no puede estar ahí (ni a mano de un revisor de Apple).
  // Se ejerce con `__DEV__ = true` a propósito: así el rojo acusa al gate del AMBIENTE y no al de `__DEV__`
  // (con dev=false pasaría por la razón equivocada, tapado por la otra llave).
  assert.equal(gateWith(true, 'preview'), false);
});

test('production y e2e tampoco habilitan el chip', () => {
  // Igual que arriba: `__DEV__ = true` para que la llave bajo prueba sea el ambiente.
  for (const env of ['production', 'e2e'] as const) {
    assert.equal(gateWith(true, env), false, `el chip quedó habilitado en ${env}`);
  }
});

test('el dominio COMPLETO está cubierto: en bundle de dev, solo development da true', () => {
  // Derivado de APP_ENVS (no una lista escrita a mano acá): si mañana se agrega un ambiente al dominio,
  // este test lo ejerce solo y obliga a decidir explícitamente si el chip va o no.
  const enabled = APP_ENVS.filter((env) => gateWith(true, env));
  assert.deepEqual(enabled, ['development']);
  // Y en bundle release, NINGÚN ambiente lo habilita — ni siquiera uno futuro.
  assert.deepEqual(
    APP_ENVS.filter((env) => gateWith(false, env)),
    [],
  );
});

// ── (B) ESTÁTICO: el componente delega, y ninguna pantalla decide el ambiente inline ──────────────────

test('RootErrorBoundary.tsx delega el gate en isDevCrashEnabled() y NO lo re-implementa', () => {
  // `assert.ok(regex.test(...))` y no `assert.match(...)`: este último vuelca el ARCHIVO ENTERO en el
  // mensaje de error, y un guard cuyo rojo hay que excavar es un guard que se termina ignorando.
  const src = stripSourceComments(readFileSync(BOUNDARY, 'utf8'));
  assert.ok(
    /import\s*\{[^}]*\bisDevCrashEnabled\b[^}]*\}\s*from\s*['"]@\/utils\/dev-crash-gate['"]/.test(src),
    'RootErrorBoundary.tsx dejó de importar el gate desde @/utils/dev-crash-gate',
  );
  assert.ok(
    /isDevCrashEnabled\(\)\s*\?\s*<DevCrashTrigger/.test(src),
    'el montaje de <DevCrashTrigger> ya no está gateado por isDevCrashEnabled()',
  );
  assert.ok(
    !/\bgetAppEnv\b/.test(src),
    'RootErrorBoundary.tsx volvió a leer getAppEnv() directo: la decisión tiene que vivir en dev-crash-gate.ts ' +
      '(un gate adentro de un .tsx no lo puede ejercer ningún test — es JSX, node:test no lo importa)',
  );
  assert.ok(
    !/\b__DEV__\b/.test(src),
    'RootErrorBoundary.tsx lee __DEV__ directo: el gate del chip son DOS llaves (__DEV__ + ambiente) y las dos ' +
      'viven en dev-crash-gate.ts. Media decisión adentro del .tsx es media decisión que ningún test ejerce',
  );
});

test('ninguna pantalla ni componente decide por ambiente inline (guard sobre la AUSENCIA)', () => {
  // El bug fue "algo dev-only que termina visible para los testers". Enumerar los archivos que HOY usan
  // mal el mecanismo no sirve: hay que enumerar la superficie ENTERA y exigir que nadie tome la decisión
  // en un archivo que ningún test puede ejecutar. Si un caso legítimo aparece, la salida no es aflojar el
  // guard: es darle nombre al predicado en src/utils (con su test) o anotarlo acá con el motivo.
  //
  // Superficie = la misma que define `scripts/check-hardcode.mjs` como UI (`app/app` + `src/components`).
  // Los consumidores legítimos de `getAppEnv()` viven FUERA de ella y no son decisiones de render:
  // `services/observability/sentry.native.ts` (el campo `environment`) y `contexts/EstablishmentContext.tsx`
  // (el grupo de tenant de PostHog).
  const ALLOWED = new Set<string>([]); // (vacío a propósito)

  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      const rel = relative(APP_ROOT, full).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;
      if (/\bgetAppEnv\b/.test(stripSourceComments(readFileSync(full, 'utf8')))) offenders.push(rel);
    }
  };
  walk(join(APP_ROOT, 'app'));
  walk(join(APP_ROOT, 'src', 'components'));

  assert.deepEqual(
    offenders,
    [],
    `estos archivos de UI leen getAppEnv() directo (la decisión no la puede ejercer ningún test):\n  ${offenders.join('\n  ')}`,
  );
});
