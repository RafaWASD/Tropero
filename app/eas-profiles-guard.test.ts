// GUARD del ambiente por PERFIL de `app/eas.json`, escrito sobre la AUSENCIA.
//
// ── EL DEFECTO (build 5 de iOS, TestFlight, 2026-08-10) ──────────────────────────────────────────────
// Raf abrió el build en su iPhone y la pantalla principal tenía el chip «crash» — un botón DEV-ONLY que
// cierra la app a propósito. La causa raíz no era el chip: `getAppEnv()` cae al default `development`
// cuando falta `EXPO_PUBLIC_ENV`, y NINGUNO de los 5 perfiles de `eas.json` la declaraba
// (`grep -c EXPO_PUBLIC_ENV eas.json` → 0). O sea: **todos** los builds, incluido `production`, se creían
// en desarrollo.
//
// El radio de daño va más allá del chip. Los otros dos consumidores del ambiente son
// `sentry.native.ts` (`environment:`) y `EstablishmentContext.tsx` (el grupo de tenant de PostHog). Hoy
// no duelen porque no hay DSN ni key en estos perfiles, pero el día que se prendan **todo** llegaría
// etiquetado `development` y no habría forma de distinguir el error de un productor real de una prueba
// de Raf. Un dato de observabilidad mal etiquetado no se nota: se cree.
//
// ── POR QUÉ UN GUARD Y NO "acordarse" ───────────────────────────────────────────────────────────────
// Lo que falló NO fue un valor mal puesto: fue que **nadie estaba mirando que estuviera puesto**. Por eso
// el oráculo enumera los perfiles DESDE el archivo (no una lista escrita acá) y exige que cada uno
// declare su ambiente: un perfil nuevo **nace en rojo** hasta que alguien decida a qué ambiente pertenece.
// El dominio sale de `APP_ENVS` (`src/utils/app-env.ts`), la misma constante que usa `getAppEnv()` para
// aceptar o descartar el valor — así el guard no puede quedar desincronizado de la app.
//
// ── LO QUE ESTE GUARD **NO** CUBRE (declarado, no fingido) ──────────────────────────────────────────
//  1. **Las EAS Environment Variables del dashboard.** Si un perfil algún día usa `"environment": "..."`
//     en vez del bloque `env` inline (es lo que pide R4.4 de la spec 16, hoy NO implementado así), las
//     variables viven en el servidor de EAS y este archivo no las ve. Ese día el guard tiene que crecer
//     (o el `env` inline queda como declaración redundante y verificable).
//  2. **Los OTA (`eas update`).** El campo `env` del build profile NO viaja a los updates (R4.5): un
//     update publicado sin `--environment` puede correr con otro valor. Fuera del alcance de un archivo.
//  3. **Que el ambiente declarado sea el CORRECTO.** El guard verifica presencia y dominio, más el pin de
//     los 5 perfiles de hoy. No puede saber si `preview-dev` "debería" ser otra cosa.
//  4. **La coherencia ambiente ↔ backend.** A propósito: `preview-dev`/`testflight-dev` declaran ambiente
//     `preview` pero apuntan al backend DEV, mientras que `preview` apunta a PROD. `EXPO_PUBLIC_ENV`
//     describe la MADUREZ del release, no la base de datos. Cruzar ambas cosas acá daría un rojo falso.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ENVS } from './src/utils/app-env.ts';
import { stripSourceComments } from './src/utils/strip-comments.ts';

const APP_ROOT = dirname(fileURLToPath(import.meta.url)); // app/
const EAS_JSON = join(APP_ROOT, 'eas.json');

const ENV_VAR = 'EXPO_PUBLIC_ENV';

/**
 * Dominio ADMITIDO en un perfil de build = el dominio de la app MENOS `e2e`.
 *
 * `e2e` es un valor del harness de tests, no de un binario: lo inyecta el shim de Playwright
 * (`e2e/helpers/fixtures.ts`) sobre el export web. Un build de EAS que lo declarara arrancaría con
 * `isE2E() === true` en el teléfono de alguien → Sentry `enabled:false` y PostHog `disabled:true` **en
 * silencio** (esa es literalmente la fórmula de `sentry.native.ts` / `posthog.native.tsx`): observabilidad
 * apagada sin que nada lo diga. Se rechaza a propósito, aunque `getAppEnv()` sí lo acepte como valor.
 */
const ALLOWED_IN_BUILD_PROFILE = APP_ENVS.filter((e) => e !== 'e2e');

interface BuildProfile {
  extends?: string;
  env?: Record<string, string>;
}
interface EasJson {
  build?: Record<string, BuildProfile>;
}

/** Parsea el `eas.json` tolerando comentarios (EAS los permite; hoy el archivo no tiene). */
function parseEasJson(text: string): EasJson {
  return JSON.parse(stripSourceComments(text)) as EasJson;
}

/**
 * `env` EFECTIVO de un perfil, resolviendo la cadena de `extends` (EAS mergea el `env` del padre y el
 * hijo pisa clave por clave). Sin esto, un perfil que hereda su ambiente daría un rojo FALSO — y un rojo
 * falso es la forma más común de que alguien afloje un guard.
 */
function effectiveEnv(
  profiles: Record<string, BuildProfile>,
  name: string,
  seen: string[] = [],
): { env: Record<string, string> } | { error: string } {
  if (seen.includes(name)) return { error: `cadena de \`extends\` circular: ${[...seen, name].join(' → ')}` };
  const profile = profiles[name];
  if (!profile) return { error: `\`extends\` apunta a un perfil inexistente: "${name}"` };
  const own = profile.env ?? {};
  if (!profile.extends) return { env: { ...own } };
  const parent = effectiveEnv(profiles, profile.extends, [...seen, name]);
  if ('error' in parent) return parent;
  return { env: { ...parent.env, ...own } };
}

/**
 * El oráculo, PURO (recibe el JSON ya parseado) para poder ejercerlo contra mutantes sin tocar el archivo
 * real. Devuelve una violación por perfil, **nombrando el perfil** (si el guard no dice CUÁL, obliga a
 * excavar y se termina ignorando).
 */
export function collectEnvViolations(eas: EasJson, allowed: readonly string[]): string[] {
  const profiles = eas.build ?? {};
  const names = Object.keys(profiles);
  if (names.length === 0) return ['`eas.json` no declara ningún perfil de build (¿se rompió el archivo?)'];

  const violations: string[] = [];
  for (const name of names) {
    const resolved = effectiveEnv(profiles, name);
    if ('error' in resolved) {
      violations.push(`perfil "${name}": ${resolved.error}`);
      continue;
    }
    const value = resolved.env[ENV_VAR];
    if (value === undefined) {
      violations.push(
        `perfil "${name}": no declara \`${ENV_VAR}\` → ese build se creería en \`development\` ` +
          `(default de getAppEnv()): chip de crash visible y observabilidad mal etiquetada`,
      );
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      violations.push(`perfil "${name}": \`${ENV_VAR}\` está vacía → para getAppEnv() es lo mismo que ausente`);
      continue;
    }
    if (!allowed.includes(value)) {
      violations.push(
        `perfil "${name}": \`${ENV_VAR}\` = "${value}", fuera del dominio admitido {${allowed.join(', ')}}`,
      );
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) EL ARCHIVO REAL
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('TODO perfil de build de eas.json declara EXPO_PUBLIC_ENV, y con un valor del dominio', () => {
  const eas = parseEasJson(readFileSync(EAS_JSON, 'utf8'));
  const violations = collectEnvViolations(eas, ALLOWED_IN_BUILD_PROFILE);
  assert.deepEqual(violations, [], `\n  ${violations.join('\n  ')}\n`);
});

test('el mapeo vigente perfil → ambiente está pineado (un cambio deliberado pasa por acá)', () => {
  // El test de arriba cubre la AUSENCIA (y hace que un perfil nuevo nazca en rojo). Éste cubre el VALOR:
  // un dedazo que ponga `production` en el perfil de los testers —o al revés— no se nota mirando el
  // archivo, y el síntoma aparece meses después en un dashboard de Sentry que mezcla todo.
  const eas = parseEasJson(readFileSync(EAS_JSON, 'utf8'));
  const expected: Record<string, string> = {
    development: 'development',
    'preview-dev': 'preview',
    preview: 'preview',
    'testflight-dev': 'preview',
    production: 'production',
  };
  for (const [name, want] of Object.entries(expected)) {
    const resolved = effectiveEnv(eas.build ?? {}, name);
    assert.ok(!('error' in resolved), `no se pudo resolver el perfil "${name}" (¿lo renombraron?)`);
    assert.equal(
      (resolved as { env: Record<string, string> }).env[ENV_VAR],
      want,
      `el perfil "${name}" cambió de ambiente`,
    );
  }
});

test('`e2e` NO es un ambiente válido para un perfil de build', () => {
  // Decisión declarada (ver el comentario de ALLOWED_IN_BUILD_PROFILE): está en el dominio de la APP pero
  // no en el de un binario. Este assert es lo que impide que alguien "amplíe el dominio al de AppEnv" por
  // simetría y deje pasar un build con la observabilidad apagada en silencio.
  assert.ok(!ALLOWED_IN_BUILD_PROFILE.includes('e2e' as never));
  const mutant: EasJson = { build: { production: { env: { [ENV_VAR]: 'e2e' } } } };
  const violations = collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /"production".*fuera del dominio/s);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (2) MUTANTES: que el guard se ponga rojo por lo que tiene que ponerse rojo, y NOMBRE el perfil
//     (un guard sin sus mutantes es una aserción que nadie probó que pueda fallar)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** El archivo real, con un perfil mutado. */
function realWith(mutate: (build: Record<string, BuildProfile>) => void): EasJson {
  const eas = parseEasJson(readFileSync(EAS_JSON, 'utf8'));
  mutate(eas.build ?? {});
  return eas;
}

test('MUTANTE: si a UN perfil le falta EXPO_PUBLIC_ENV → rojo, nombrando cuál', () => {
  const mutant = realWith((build) => {
    delete build['testflight-dev'].env?.[ENV_VAR];
  });
  const violations = collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 1, `esperaba 1 violación, hubo ${violations.length}: ${violations.join(' | ')}`);
  assert.match(violations[0], /"testflight-dev"/);
  assert.match(violations[0], /no declara/);
});

test('MUTANTE: valor fuera de dominio ("staging") → rojo, nombrando perfil y valor', () => {
  const mutant = realWith((build) => {
    build.preview.env![ENV_VAR] = 'staging';
  });
  const violations = collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /"preview"/);
  assert.match(violations[0], /staging/);
});

test('MUTANTE: valor vacío → rojo (para getAppEnv() es lo mismo que ausente)', () => {
  const mutant = realWith((build) => {
    build.production.env![ENV_VAR] = '';
  });
  const violations = collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /"production".*vac/s);
});

test('MUTANTE: un perfil NUEVO sin la variable nace en rojo (el caso que motivó el guard)', () => {
  const mutant = realWith((build) => {
    build['testflight-prod'] = { autoIncrement: true, env: { EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' } };
  });
  const violations = collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /"testflight-prod"/);
});

test('un perfil nuevo que HEREDA el ambiente por `extends` NO da rojo falso', () => {
  // EAS mergea el `env` del perfil extendido. Si el guard no resolviera la cadena, este caso legítimo
  // saldría rojo — y un rojo falso es la excusa perfecta para aflojar el guard.
  const mutant = realWith((build) => {
    build['preview-hotfix'] = { extends: 'preview', env: { EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' } };
  });
  assert.deepEqual(collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE), []);
});

test('...pero heredar de un perfil que TAMPOCO la declara sigue siendo rojo (los dos)', () => {
  const mutant: EasJson = {
    build: { base: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' } }, hijo: { extends: 'base' } },
  };
  const violations = collectEnvViolations(mutant, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 2);
  assert.match(violations.join('\n'), /"base"/);
  assert.match(violations.join('\n'), /"hijo"/);
});

test('MUTANTE: `extends` roto o circular → rojo explícito (y no un crash del guard)', () => {
  const roto: EasJson = { build: { hijo: { extends: 'no-existe' } } };
  assert.match(collectEnvViolations(roto, ALLOWED_IN_BUILD_PROFILE)[0], /inexistente/);
  const ciclo: EasJson = { build: { a: { extends: 'b' }, b: { extends: 'a' } } };
  const violations = collectEnvViolations(ciclo, ALLOWED_IN_BUILD_PROFILE);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /circular/);
});

test('MUTANTE: un eas.json sin perfiles NO pasa en verde por vacío', () => {
  // Un guard que enumera puede volverse vacuo si la enumeración se rompe (archivo movido, clave renombrada).
  assert.equal(collectEnvViolations({}, ALLOWED_IN_BUILD_PROFILE).length, 1);
  assert.equal(collectEnvViolations({ build: {} }, ALLOWED_IN_BUILD_PROFILE).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (3) EL LADO DE LA APP: que el valor declarado en eas.json sea el que la app va a leer de verdad
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('cada valor declarado en eas.json es reconocido por getAppEnv() (no cae al default)', async () => {
  // Sin esto, el guard verificaría un string contra otro string. Acá se ejecuta el consumidor real: un
  // valor bien escrito en el archivo pero que `getAppEnv()` descarte volvería al default `development`,
  // que es exactamente el defecto que estamos cerrando.
  const { getAppEnv } = await import('./src/utils/app-env.ts');
  const eas = parseEasJson(readFileSync(EAS_JSON, 'utf8'));
  const previous = process.env[ENV_VAR];
  try {
    for (const [name, profile] of Object.entries(eas.build ?? {})) {
      const resolved = effectiveEnv(eas.build ?? {}, name);
      if ('error' in resolved) assert.fail(`perfil "${name}": ${resolved.error}`);
      const value = resolved.env[ENV_VAR];
      process.env[ENV_VAR] = value;
      assert.equal(getAppEnv(), value, `el perfil "${name}" declara "${value}" pero getAppEnv() no lo reconoce`);
      void profile;
    }
  } finally {
    if (previous === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = previous;
  }
});
