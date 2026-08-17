// Tests de scripts/lib/env-target.mjs (spec 16 Run B, B1 / R5.1/R5.2/R5.3/R5.12/R5.13).
// node:test puro (sin red, sin process.exit). Verifica la resolución de target + la guarda destino-aware.
//
// ── LOS GUARDS DEL RENAME DE ENV VARS (rebrand fase 7, 2026-08-17) ───────────────────────────────────
// La segunda mitad del archivo (bloques GUARD-ENV-*) no prueba la resolución de ambiente: vigila el
// RENAME `RAFAQ_*` → `MITROPERO_*` de las dos env vars de este módulo, que fallan de maneras distintas.
//
//   · `*_CONFIRM_PROD` falla CERRADA. Se aceptan los dos nombres porque la tipea Raf a mano y la setea
//     el workflow de backup; el mensaje de error nombra el NUEVO.
//   · `*_KNOWN_PROD_REFS` falla ABIERTA: leer sólo el nombre nuevo sin que nadie lo setee vacía la lista
//     de refs de PROD y la guarda destino-aware pierde el refuerzo SIN NINGÚN SÍNTOMA. Por eso: unión de
//     los dos nombres + `assertKnownProdRefsCoverage`, que convierte la degradación en un bloqueo.
//
// Los guards están escritos para que el próximo rename NAZCA EN ROJO, no para documentar el actual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveTarget,
  ProdGuardError,
  KnownProdRefsCoverageError,
  parseEnvFlag,
  positionalArgs,
  knownProdRefs,
  knownProdRefsCoverageGap,
  assertKnownProdRefsCoverage,
  prodConfirmed,
  prodConfirmedVia,
  legacyConfirmNotice,
  CONFIRM_PROD_ENV,
  LEGACY_CONFIRM_PROD_ENV,
  ACCEPTED_CONFIRM_PROD_ENVS,
  KNOWN_PROD_REFS_ENV,
  LEGACY_KNOWN_PROD_REFS_ENV,
  ACCEPTED_KNOWN_PROD_REFS_ENVS,
} from './env-target.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const DEV = { SUPABASE_PROJECT_REF: 'devref123', SUPABASE_ACCESS_TOKEN: 'sbp_tok' };
const DEV_PROD = { ...DEV, SUPABASE_PROJECT_REF_PROD: 'prodref999' };
const CONFIRM = { [CONFIRM_PROD_ENV]: '1' };

test('B1(a) R5.1: sin --env → target dev con el ref de dev', () => {
  const t = resolveTarget([], DEV);
  assert.equal(t.env, 'dev');
  assert.equal(t.ref, 'devref123');
  assert.equal(t.pointsToProd, false);
  assert.equal(t.host, 'https://api.supabase.com/v1/projects/devref123');
});

test('B1(a) R5.1: un posicional (archivo) sin --env → sigue dev', () => {
  const t = resolveTarget(['supabase/migrations/0125_health_status.sql'], DEV);
  assert.equal(t.env, 'dev');
  assert.equal(t.ref, 'devref123');
});

test('B1(b) R5.2: --env prod SIN confirmación → ProdGuardError', () => {
  assert.throws(
    () => resolveTarget(['--env', 'prod'], DEV_PROD),
    (err) => {
      assert.ok(err instanceof ProdGuardError);
      assert.equal(err.reason, 'explicit-prod');
      assert.equal(err.ref, 'prodref999');
      return true;
    },
  );
});

test('B1(c) R5.3: --env prod + confirmación → target prod con ref/token correctos', () => {
  const t = resolveTarget(['--env', 'prod'], { ...DEV_PROD, ...CONFIRM });
  assert.equal(t.env, 'prod');
  assert.equal(t.ref, 'prodref999');
  assert.equal(t.token, 'sbp_tok');
  assert.equal(t.pointsToProd, true);
  assert.equal(t.host, 'https://api.supabase.com/v1/projects/prodref999');
});

test('B1(c) --env=prod (forma con =) también resuelve prod con confirm', () => {
  const t = resolveTarget(['--env=prod'], { ...DEV_PROD, ...CONFIRM });
  assert.equal(t.env, 'prod');
  assert.equal(t.ref, 'prodref999');
});

test('B1(d): --env inválido → Error (no ProdGuardError)', () => {
  assert.throws(
    () => resolveTarget(['--env', 'staging'], DEV_PROD),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(!(err instanceof ProdGuardError));
      assert.match(err.message, /--env inválido/);
      return true;
    },
  );
});

test('B1(e) R5.12 destino-aware: --env dev pero ref dev == ref PROD → exige confirm IGUAL', () => {
  // Slot dev mal seteado: SUPABASE_PROJECT_REF apunta al ref conocido de PROD.
  const misconfigured = { SUPABASE_PROJECT_REF: 'prodref999', SUPABASE_ACCESS_TOKEN: 'sbp_tok', SUPABASE_PROJECT_REF_PROD: 'prodref999' };
  assert.throws(
    () => resolveTarget([], misconfigured), // default dev, SIN confirm
    (err) => {
      assert.ok(err instanceof ProdGuardError);
      assert.equal(err.reason, 'destino-aware');
      assert.equal(err.ref, 'prodref999');
      return true;
    },
  );
  // Con confirm, procede (target dev, pero marcado pointsToProd).
  const t = resolveTarget([], { ...misconfigured, ...CONFIRM });
  assert.equal(t.env, 'dev');
  assert.equal(t.pointsToProd, true);
});

test('B1(e) destino-aware por la lista de refs (nombre nuevo): ref dev en la lista → exige confirm', () => {
  const env = { SUPABASE_PROJECT_REF: 'aaa', SUPABASE_ACCESS_TOKEN: 'tok', [KNOWN_PROD_REFS_ENV]: 'bbb, aaa , ccc' };
  assert.throws(() => resolveTarget([], env), ProdGuardError);
});

test('R5.12: default dev con ref dev ≠ ref prod → NO exige confirm (no falso positivo)', () => {
  const t = resolveTarget([], DEV_PROD); // devref123 ≠ prodref999
  assert.equal(t.env, 'dev');
  assert.equal(t.pointsToProd, false);
});

test('R5.13: ProdGuardError NUNCA incluye el token en su mensaje', () => {
  try {
    resolveTarget(['--env', 'prod'], DEV_PROD);
    assert.fail('debía tirar');
  } catch (err) {
    assert.ok(!err.message.includes('sbp_tok'));
    assert.equal(err.token, undefined); // ni siquiera lo carga como propiedad
  }
});

test('resolveTarget: falta SUPABASE_ACCESS_TOKEN → Error (con confirm ya pasado)', () => {
  assert.throws(
    () => resolveTarget(['--env', 'prod'], { SUPABASE_PROJECT_REF_PROD: 'p', ...CONFIRM }),
    /Falta SUPABASE_ACCESS_TOKEN/,
  );
});

test('resolveTarget: --env prod + confirm pero falta ref PROD → Error de ref (tras la guarda)', () => {
  assert.throws(
    () => resolveTarget(['--env', 'prod'], { SUPABASE_ACCESS_TOKEN: 'tok', ...CONFIRM }),
    /Falta SUPABASE_PROJECT_REF_PROD/,
  );
});

test('parseEnvFlag: soporta --env x, --env=x, ausencia', () => {
  assert.equal(parseEnvFlag(['--env', 'prod']), 'prod');
  assert.equal(parseEnvFlag(['--env=dev']), 'dev');
  assert.equal(parseEnvFlag(['foo.sql']), undefined);
});

test('positionalArgs: descarta --env <val>, --env=val, --backfill, --out-dir <val>', () => {
  assert.deepEqual(positionalArgs(['--env', 'prod', 'file.sql']), ['file.sql']);
  assert.deepEqual(positionalArgs(['file.sql', '--env=dev']), ['file.sql']);
  assert.deepEqual(positionalArgs(['--backfill', '--env', 'dev']), []);
  assert.deepEqual(positionalArgs(['--out-dir', '/tmp/x', 'a.sql']), ['a.sql']);
});

test('knownProdRefs: une SUPABASE_PROJECT_REF_PROD + la lista, trimmea', () => {
  const s = knownProdRefs({ SUPABASE_PROJECT_REF_PROD: ' p1 ', [KNOWN_PROD_REFS_ENV]: 'p2, p3' });
  assert.ok(s.has('p1') && s.has('p2') && s.has('p3'));
  assert.equal(knownProdRefs({}).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GUARD-ENV-* — el rename `RAFAQ_*` → `MITROPERO_*` de las env vars (rebrand fase 7)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

test('GUARD-ENV-0: los DOS nombres de cada var siguen declarados (sacar el viejo es un cambio con condición)', () => {
  // Literales HARDCODEADOS a propósito: si este test derivara los nombres del módulo, no podría ver el
  // día que alguien borre el nombre viejo. Ese borrado es legítimo, pero tiene una condición previa
  // (ver docs/backlog.md) — el rojo de acá es la pregunta "¿ya se cumplió?", no un test desactualizado.
  assert.equal(CONFIRM_PROD_ENV, 'MITROPERO_CONFIRM_PROD');
  assert.equal(LEGACY_CONFIRM_PROD_ENV, 'RAFAQ_CONFIRM_PROD');
  assert.deepEqual([...ACCEPTED_CONFIRM_PROD_ENVS], ['MITROPERO_CONFIRM_PROD', 'RAFAQ_CONFIRM_PROD']);

  assert.equal(KNOWN_PROD_REFS_ENV, 'MITROPERO_KNOWN_PROD_REFS');
  assert.equal(LEGACY_KNOWN_PROD_REFS_ENV, 'RAFAQ_KNOWN_PROD_REFS');
  assert.deepEqual(
    [...ACCEPTED_KNOWN_PROD_REFS_ENVS],
    ['MITROPERO_KNOWN_PROD_REFS', 'RAFAQ_KNOWN_PROD_REFS'],
    'sacar el nombre PRE-rebrand de la lista de refs de PROD es el cambio que FALLA ABIERTO: si nadie ' +
      'seteó el nombre nuevo, la guarda destino-aware se queda sin refuerzo y no lo avisa nadie.',
  );
});

test('GUARD-ENV-1: la confirmación de PROD vale bajo CUALQUIERA de los dos nombres', () => {
  // El motivo no es estético: la tipea Raf a mano y la memoria muscular es el nombre viejo. Una guarda
  // que bloquea a las 3 AM porque cambió de nombre es una trampa, no una protección.
  for (const name of ACCEPTED_CONFIRM_PROD_ENVS) {
    assert.equal(prodConfirmed({ [name]: '1' }), true, `${name} debería valer como confirmación`);
    assert.equal(prodConfirmedVia({ [name]: '1' }), name);
    const t = resolveTarget(['--env', 'prod'], { ...DEV_PROD, [name]: '1' });
    assert.equal(t.env, 'prod');
    assert.equal(t.confirmedVia, name);
  }
});

test('GUARD-ENV-2: la confirmación sigue siendo estricta (=== "1"), fail-closed', () => {
  for (const name of ACCEPTED_CONFIRM_PROD_ENVS) {
    for (const value of ['0', '', 'true', 'yes', 'si', '1 ', ' 1']) {
      assert.equal(
        prodConfirmed({ [name]: value }),
        false,
        `${name}="${value}" NO puede abrir la guarda de PROD`,
      );
    }
  }
  assert.equal(prodConfirmed({}), false);
  assert.equal(prodConfirmedVia({}), null);
});

test('GUARD-ENV-3: el nombre nuevo tiene precedencia y el viejo avisa que está deprecado', () => {
  assert.equal(prodConfirmedVia({ [CONFIRM_PROD_ENV]: '1', [LEGACY_CONFIRM_PROD_ENV]: '1' }), CONFIRM_PROD_ENV);
  // El aviso es barato y es lo que evita que el nombre viejo se quede para siempre por inercia.
  const notice = legacyConfirmNotice(LEGACY_CONFIRM_PROD_ENV);
  assert.ok(notice, 'confirmar con el nombre viejo tiene que avisar');
  assert.match(notice, new RegExp(CONFIRM_PROD_ENV), 'el aviso tiene que nombrar el nombre NUEVO');
  assert.equal(legacyConfirmNotice(CONFIRM_PROD_ENV), null, 'el nombre nuevo no avisa nada');
  assert.equal(legacyConfirmNotice(null), null);
  // `confirmedVia` es null cuando la confirmación no hizo falta (target dev normal): sin eso, un script
  // imprimiría el aviso de deprecación en cada corrida contra DEV.
  assert.equal(resolveTarget([], { ...DEV_PROD, [LEGACY_CONFIRM_PROD_ENV]: '1' }).confirmedVia, null);
  assert.equal(
    resolveTarget(['--env', 'prod'], { ...DEV_PROD, [LEGACY_CONFIRM_PROD_ENV]: '1' }).confirmedVia,
    LEGACY_CONFIRM_PROD_ENV,
  );
});

test('GUARD-ENV-4: el mensaje de la guarda nombra el nombre NUEVO (y no el viejo)', () => {
  // Si el error nombrara el viejo, el rename nunca terminaría: el operador seguiría exportando el viejo
  // porque es lo que el propio error le dice que exporte.
  const err = (() => { try { resolveTarget(['--env', 'prod'], DEV_PROD); return null; } catch (e) { return e; } })();
  assert.ok(err instanceof ProdGuardError);
  assert.match(err.message, new RegExp(CONFIRM_PROD_ENV));
  assert.ok(
    !err.message.includes(LEGACY_CONFIRM_PROD_ENV),
    `el mensaje no debe empujar al nombre viejo: "${err.message}"`,
  );
});

test('GUARD-ENV-5: la lista de refs de PROD es la UNIÓN de los dos nombres, no un fallback', () => {
  // Éste es EL test del modo de falla abierto. Con `nuevo ?? viejo`, setear el nombre nuevo APAGARÍA en
  // silencio los refs declarados en el viejo — y nada se pondría rojo.
  const both = knownProdRefs({
    [KNOWN_PROD_REFS_ENV]: 'nuevo1, nuevo2',
    [LEGACY_KNOWN_PROD_REFS_ENV]: 'viejo1',
  });
  assert.deepEqual([...both].sort(), ['nuevo1', 'nuevo2', 'viejo1']);

  // Y cada nombre por separado tiene que alcanzar para que la guarda destino-aware dispare.
  for (const name of ACCEPTED_KNOWN_PROD_REFS_ENVS) {
    const env = { SUPABASE_PROJECT_REF: 'solo-este', SUPABASE_ACCESS_TOKEN: 'tok', [name]: 'solo-este' };
    assert.ok(knownProdRefs(env).has('solo-este'), `${name} no se está leyendo`);
    assert.throws(
      () => resolveTarget([], env),
      ProdGuardError,
      `con ${name} seteado, un slot dev apuntando a ese ref TIENE que exigir confirmación`,
    );
  }
});

test('GUARD-ENV-6: una lista de refs que el módulo NO lee CORTA (la degradación deja de ser muda)', () => {
  // El oráculo. No es "la lista quedó vacía" —eso es inalcanzable teniendo SUPABASE_PROJECT_REF_PROD
  // seteado, o sea un test que no puede fallar— sino el SKEW: el ambiente declara refs de PROD bajo un
  // nombre que el código no mira. Cubre las dos direcciones del rename a medias.
  const env = {
    SUPABASE_PROJECT_REF: 'devref123',
    SUPABASE_ACCESS_TOKEN: 'tok',
    TROPERO_KNOWN_PROD_REFS: 'refA, refB', // nombre que ACCEPTED_KNOWN_PROD_REFS_ENVS no incluye
  };
  const gaps = knownProdRefsCoverageGap(env);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'TROPERO_KNOWN_PROD_REFS');
  assert.deepEqual(gaps[0].missing, ['refA', 'refB']);

  assert.throws(() => assertKnownProdRefsCoverage(env), KnownProdRefsCoverageError);
  assert.throws(
    () => resolveTarget([], env), // ← target DEV, el camino de todos los días: igual corta
    (err) => {
      assert.ok(err instanceof KnownProdRefsCoverageError);
      assert.match(err.message, /TROPERO_KNOWN_PROD_REFS/, 'el error tiene que NOMBRAR la variable ignorada');
      assert.match(err.message, new RegExp(KNOWN_PROD_REFS_ENV), 'y decir cuál es el nombre bueno');
      return true;
    },
  );
});

test('GUARD-ENV-7: cobertura completa NO corta (sin falsos positivos)', () => {
  // Los tres casos vivos: sólo el viejo, sólo el nuevo, los dos. Ninguno puede bloquear a nadie.
  for (const env of [
    { [LEGACY_KNOWN_PROD_REFS_ENV]: 'r1, r2' },
    { [KNOWN_PROD_REFS_ENV]: 'r1' },
    { [KNOWN_PROD_REFS_ENV]: 'r1', [LEGACY_KNOWN_PROD_REFS_ENV]: 'r2' },
    { [KNOWN_PROD_REFS_ENV]: '' }, // vacía = no declara nada
    { [KNOWN_PROD_REFS_ENV]: '  ,  ' }, // basura separadora, nada declarado
    {},
  ]) {
    assert.deepEqual(knownProdRefsCoverageGap({ ...DEV, ...env }), [], JSON.stringify(env));
  }
  // Un nombre ajeno cuyos refs YA están cubiertos por SUPABASE_PROJECT_REF_PROD no es una degradación:
  // esos refs se siguen tratando como PROD. El guard mide cobertura, no obediencia al naming.
  assert.deepEqual(
    knownProdRefsCoverageGap({ ...DEV, SUPABASE_PROJECT_REF_PROD: 'p1', OTRO_KNOWN_PROD_REFS: 'p1' }),
    [],
  );
  // Y el ambiente de HOY (sin ninguna de las dos vars) no puede quedar bloqueado por este guard.
  assert.equal(resolveTarget([], DEV).env, 'dev');
});

test('GUARD-ENV-SH: powersync-deploy.sh acepta EXACTAMENTE los mismos nombres que el módulo JS', () => {
  // `powersync-deploy.sh` es bash: no puede importar env-target.mjs y tiene su propia copia del criterio.
  // Dos copias del mismo criterio sin nada que las ate = la misma variable exportada abre una guarda y
  // bloquea la otra. Este guard DERIVA los nombres del módulo, así que renombrar allá pone el .sh en rojo.
  const sh = readFileSync(join(repoRoot, 'scripts', 'powersync-deploy.sh'), 'utf8');
  const condLines = sh.split(/\r?\n/).filter((l) => /^\s*(if|elif)\s+\[/.test(l));
  assert.ok(condLines.length >= 3, `esperaba condiciones en el .sh y encontré ${condLines.length}`);

  for (const name of ACCEPTED_CONFIRM_PROD_ENVS) {
    assert.ok(
      condLines.some((l) => l.includes(name)),
      `scripts/powersync-deploy.sh no CONDICIONA sobre ${name} (mencionarlo en un comentario no cuenta): ` +
        'esa variable abre la guarda en los scripts JS y bloquea la del deploy de PowerSync.',
    );
  }
  // Dirección inversa: ningún nombre de confirmación en el .sh que el módulo JS no acepte.
  const enElSh = new Set(sh.match(/[A-Z0-9_]*CONFIRM_PROD/g) ?? []);
  for (const name of enElSh) {
    assert.ok(
      ACCEPTED_CONFIRM_PROD_ENVS.includes(name),
      `scripts/powersync-deploy.sh nombra ${name}, que prodConfirmed() NO acepta: skew entre las dos copias.`,
    );
  }
  // El mensaje de aborto tiene que empujar al nombre nuevo (mismo criterio que ProdGuardError).
  assert.match(sh, new RegExp(`ABORTADO:[^\\n]*${CONFIRM_PROD_ENV}`));
});
