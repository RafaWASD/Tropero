// Tests de scripts/lib/stage-runner.mjs — el orquestador de stages de `scripts/run-tests.mjs`.
//
// ── QUÉ FALSIFICA ESTE ARCHIVO ──────────────────────────────────────────────────────────────────────
// El defecto que cerró la unidad del 2026-08-17: `run()` llamaba a `execSync` SIN `try`, así que el
// PRIMER stage rojo mataba el proceso y los stages siguientes NUNCA CORRÍAN. Con `client unit tests` en
// la posición 3 de 22, un rojo ahí apagaba las 16 suites de backend (RLS, tenant-isolation, audit, drift
// de migraciones) y la salida no decía absolutamente nada al respecto.
//
// Los tests de comportamiento ejercen el mecanismo con un `exec` INYECTADO (sin spawnear procesos, sin
// red, sin DB): un stage rojo no corta a los siguientes, el exit code sigue siendo ≠0, y —lo central—
// el RESUMEN NOMBRA A TODOS los stages declarados, incluidos los que no se ejecutaron.
//
// Los guards estáticos del final vigilan LA AUSENCIA en `scripts/run-tests.mjs`: que no vuelva a
// aparecer un `execSync` fuera del runner, que nadie meta un `process.exit()` que trunque el resumen, y
// que ningún stage de TEST se marque `fatal` (sería exactamente el agujero de nuevo, pero con permiso).
// Sin estos guards, la regresión se reintroduce con una línea y en silencio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStageRunner, STATUS } from './stage-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const RUN_TESTS_PATH = resolve(repoRoot, 'scripts', 'run-tests.mjs');

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────

/** Error con la forma que tira `execSync` cuando el comando devuelve ≠0. */
function execError(status, cmd) {
  const e = new Error(`Command failed: ${cmd}\ncon un volcado gigante que no queremos en el resumen`);
  e.status = status;
  return e;
}

/**
 * `exec` inyectado: falla los comandos cuyo nombre esté en `redSet`, y registra en `calls` TODO lo que
 * se le pidió ejecutar. `calls` es el oráculo de "¿corrió o no corrió?".
 */
function fakeExec(redSet = new Set(), calls = []) {
  return (cmd) => {
    calls.push(cmd);
    if (redSet.has(cmd)) throw execError(1, cmd);
  };
}

function silentRunner(opts = {}) {
  const calls = [];
  const lines = [];
  const runner = createStageRunner({
    exec: fakeExec(opts.red ?? new Set(), calls),
    log: (l) => lines.push(l),
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    ...opts,
  });
  return { runner, calls, lines };
}

// ── comportamiento: el corazón de la unidad ─────────────────────────────────────────────────────────

test('un stage rojo NO corta: los stages siguientes SÍ se ejecutan', () => {
  const { runner, calls } = silentRunner({ red: new Set(['cmd-b']) });

  runner.run('a', 'cmd-a');
  runner.run('b', 'cmd-b'); // rojo
  runner.run('c', 'cmd-c');
  runner.run('d', 'cmd-d');

  // El oráculo real: el `exec` fue invocado para los 4, no para los 2 primeros.
  assert.deepEqual(calls, ['cmd-a', 'cmd-b', 'cmd-c', 'cmd-d']);
  assert.deepEqual(
    runner.results.map((r) => [r.label, r.status]),
    [
      ['a', STATUS.PASS],
      ['b', STATUS.FAIL],
      ['c', STATUS.PASS],
      ['d', STATUS.PASS],
    ],
  );
});

test('el exit code es ≠0 con cualquier rojo, aunque los siguientes pasen', () => {
  const { runner } = silentRunner({ red: new Set(['cmd-b']) });
  runner.run('a', 'cmd-a');
  runner.run('b', 'cmd-b');
  runner.run('c', 'cmd-c');
  assert.equal(runner.exitCode, 1);
});

test('el exit code es 0 cuando no hay ningún rojo', () => {
  const { runner } = silentRunner();
  runner.run('a', 'cmd-a');
  runner.run('b', 'cmd-b');
  assert.equal(runner.exitCode, 0);
});

test('el RESUMEN nombra a TODOS los stages declarados, no sólo al que falló', () => {
  const { runner } = silentRunner({ red: new Set(['cmd-b']) });
  runner.run('typecheck client', 'cmd-a');
  runner.run('client unit tests', 'cmd-b');
  runner.run('RLS suite', 'cmd-c');
  runner.run('Audit suite (spec 18)', 'cmd-d');

  const s = runner.summary();
  for (const label of ['typecheck client', 'client unit tests', 'RLS suite', 'Audit suite (spec 18)']) {
    assert.ok(s.includes(label), `el resumen tiene que nombrar «${label}»`);
  }
  assert.match(s, /4 declarado\(s\) · 3 PASS · 1 FAIL/);
  assert.match(s, /ROJOS \(1\):/);
  assert.match(s, /client unit tests — exit 1/);
});

test('el resumen NO arrastra el volcado gigante de execSync (solo la primera línea del error)', () => {
  const { runner } = silentRunner({ red: new Set(['cmd-a']) });
  runner.run('a', 'cmd-a');
  assert.doesNotMatch(runner.summary(), /volcado gigante/);
  assert.match(runner.results[0].reason, /^Command failed: cmd-a$/);
});

// ── stages fatales: cortan, pero NO callan ──────────────────────────────────────────────────────────

test('un stage `fatal` corta, y los siguientes quedan NO CORRIÓ (no desaparecen ni cuentan como verdes)', () => {
  const { runner, calls } = silentRunner({ red: new Set(['tsc']) });

  runner.run('typecheck client', 'tsc', { fatal: true });
  runner.run('client unit tests', 'cmd-unit');
  runner.run('RLS suite', 'cmd-rls');

  assert.deepEqual(calls, ['tsc'], 'después del fatal no se ejecuta NADA');
  assert.deepEqual(
    runner.results.map((r) => r.status),
    [STATUS.FAIL, STATUS.NOT_RUN, STATUS.NOT_RUN],
  );
  assert.equal(runner.counts.pass, 0, 'un stage que no corrió NO es un stage verde');
  assert.equal(runner.exitCode, 1);
});

test('el resumen de un corte fatal NOMBRA los stages que no corrieron y dice por qué', () => {
  const { runner } = silentRunner({ red: new Set(['tsc']) });
  runner.run('typecheck client', 'tsc', { fatal: true });
  runner.run('RLS suite', 'cmd-rls');
  runner.run('Audit suite (spec 18)', 'cmd-audit');

  const s = runner.summary();
  // Esto es LA aserción de la unidad: la salida no puede sugerir que lo no ejecutado está sano.
  assert.ok(s.includes('RLS suite'), 'el resumen nombra la suite que no corrió');
  assert.ok(s.includes('Audit suite (spec 18)'), 'idem');
  assert.match(s, /NO CORRIÓ/);
  assert.match(s, /abortado tras el fallo FATAL de 'typecheck client'/);
  assert.match(s, /2 stage\(s\) NO CORRIERON/);
  assert.match(s, /--keep-going/, 'el resumen tiene que decir cómo barrer todo igual');
});

test('un stage `fatal` que PASA no corta nada', () => {
  const { runner, calls } = silentRunner();
  runner.run('typecheck client', 'tsc', { fatal: true });
  runner.run('RLS suite', 'cmd-rls');
  assert.deepEqual(calls, ['tsc', 'cmd-rls']);
  assert.equal(runner.exitCode, 0);
});

test('--keep-going ignora el `fatal`: los 3 stages corren igual', () => {
  const { runner, calls } = silentRunner({ red: new Set(['tsc']), keepGoing: true });
  runner.run('typecheck client', 'tsc', { fatal: true });
  runner.run('client unit tests', 'cmd-unit');
  runner.run('RLS suite', 'cmd-rls');

  assert.deepEqual(calls, ['tsc', 'cmd-unit', 'cmd-rls']);
  assert.equal(runner.counts.notRun, 0);
  assert.equal(runner.exitCode, 1, 'seguir corriendo NO blanquea el rojo');
});

test('--fail-fast recupera el comportamiento viejo: corta en el primer rojo, sea fatal o no', () => {
  const { runner, calls } = silentRunner({ red: new Set(['cmd-b']), failFast: true });
  runner.run('a', 'cmd-a');
  runner.run('b', 'cmd-b');
  runner.run('c', 'cmd-c');

  assert.deepEqual(calls, ['cmd-a', 'cmd-b']);
  assert.equal(runner.counts.notRun, 1);
  assert.match(runner.summary(), /abortado por --fail-fast tras 'b'/);
  assert.equal(runner.exitCode, 1);
});

test('--fail-fast y --keep-going juntos son un error de uso, no un default silencioso', () => {
  assert.throws(() => createStageRunner({ exec: () => {}, failFast: true, keepGoing: true }), TypeError);
});

// ── skips declarados: verdes para el CI, pero ruidosos ──────────────────────────────────────────────

test('un SKIP declarado no ensucia el exit code (ci.yml corre sin keys en cada push)', () => {
  const { runner, calls } = silentRunner();
  runner.run('typecheck client', 'tsc');
  runner.skip('RLS suite', 'falta SUPABASE_SERVICE_ROLE_KEY en el env');
  runner.skip('Audit suite (spec 18)', 'falta SUPABASE_SERVICE_ROLE_KEY en el env');

  assert.deepEqual(calls, ['tsc'], 'un stage salteado no se ejecuta');
  assert.equal(runner.exitCode, 0);
  assert.equal(runner.counts.skipped, 2);
});

test('el resumen GRITA los skips: un stage salteado no es un stage verde', () => {
  const { runner } = silentRunner();
  runner.run('typecheck client', 'tsc');
  runner.skip('RLS suite', 'falta SUPABASE_SERVICE_ROLE_KEY en el env');

  const s = runner.summary();
  assert.match(s, /\[ SKIP\s+\]\s+RLS suite/);
  assert.match(s, /1 stage\(s\) SALTEADOS/);
  assert.match(s, /NO es un stage verde/);
  assert.doesNotMatch(s, /Todos los stages en verde/);
});

test('un SKIP después de un corte fatal no se ejecuta ni se pierde del resumen', () => {
  const { runner, calls } = silentRunner({ red: new Set(['tsc']) });
  runner.run('typecheck client', 'tsc', { fatal: true });
  runner.skip('RLS suite', 'falta SUPABASE_SERVICE_ROLE_KEY en el env');

  assert.deepEqual(calls, ['tsc']);
  assert.equal(runner.results[1].status, STATUS.NOT_RUN);
  assert.ok(runner.summary().includes('RLS suite'));
});

test('el verde total se anuncia sólo cuando no hay FAIL ni SKIP ni NO CORRIÓ', () => {
  const { runner } = silentRunner();
  runner.run('a', 'cmd-a');
  runner.run('b', 'cmd-b');
  assert.match(runner.summary(), /Todos los stages en verde/);
});

// ── modos de falla raros ────────────────────────────────────────────────────────────────────────────

test('un error SIN `status` (ENOENT: el binario no existe) se registra FAIL, no revienta el runner', () => {
  const calls = [];
  const runner = createStageRunner({
    exec: (cmd) => {
      calls.push(cmd);
      if (cmd === 'pnpm.cmd typecheck') {
        const e = new Error('spawnSync pnpm.cmd ENOENT');
        e.errno = -4058;
        throw e; // sin `status`
      }
    },
    log: () => {},
  });

  runner.run('typecheck client', 'pnpm.cmd typecheck');
  runner.run('RLS suite', 'cmd-rls');

  assert.equal(runner.results[0].status, STATUS.FAIL);
  assert.equal(runner.results[0].exitCode, null);
  assert.equal(runner.exitCode, 1);
  assert.match(runner.summary(), /exit \?/);
  assert.deepEqual(calls, ['pnpm.cmd typecheck', 'cmd-rls'], 'un ENOENT tampoco tapa a los siguientes');
});

test('createStageRunner sin `exec` falla fuerte en vez de simular una corrida verde', () => {
  assert.throws(() => createStageRunner({}), TypeError);
});

test('un stage NO CORRIÓ nunca cuenta como evidencia de verde (exit code ≠0 aunque no hubiera FAIL)', () => {
  // Hoy NOT_RUN sólo puede aparecer después de un FAIL (es lo único que setea `aborted`), así que este
  // test es redundante A PROPÓSITO: fija la REGLA para el día que alguien agregue un camino de aborto
  // que no sea un fallo. El default tiene que ser "no puedo afirmar que esté verde".
  const { runner } = silentRunner({ red: new Set(['tsc']) });
  runner.run('typecheck client', 'tsc', { fatal: true });
  runner.run('RLS suite', 'cmd-rls');

  assert.equal(runner.counts.notRun, 1);
  assert.equal(runner.counts.pass, 0);
  assert.equal(runner.exitCode, 1);
});

test('`summary()` no depende de `this` (se puede desestructurar sin romperse)', () => {
  const { runner } = silentRunner();
  runner.run('a', 'cmd-a');
  const { summary } = runner;
  assert.match(summary(), /1 declarado\(s\) · 1 PASS/);
});

test('`results` es una copia: nadie puede reescribir el veredicto desde afuera', () => {
  const { runner } = silentRunner({ red: new Set(['cmd-a']) });
  runner.run('a', 'cmd-a');
  const stolen = runner.results;
  stolen.length = 0;
  assert.equal(runner.results.length, 1);
  assert.equal(runner.exitCode, 1);
});

// ── GUARDS ESTÁTICOS sobre scripts/run-tests.mjs ────────────────────────────────────────────────────
// Escritos sobre la AUSENCIA: no verifican que los 22 stages de hoy estén bien puestos, verifican que no
// se pueda volver a introducir el mecanismo que los apagaba.

const runTestsSrc = readFileSync(RUN_TESTS_PATH, 'utf8');

// Los guards de abajo escanean CÓDIGO, no prosa. `run-tests.mjs` es 80% comentario y esos comentarios
// nombran justamente lo que los guards prohíben (`process.exit()`, `execSync`) — la primera versión de
// este archivo dio rojo cazando su propia documentación. Se descartan las líneas que son comentario
// entero; una línea `código; // comentario` conserva el código. (El archivo no usa comentarios de
// bloque; si algún día los usa, hay que extender esto.)
const codeOnly = (src) =>
  src
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
const runTestsCode = codeOnly(runTestsSrc);

test('GUARD: run-tests.mjs ejecuta comandos por UN SOLO punto (el `exec` inyectado en el runner)', () => {
  const found = (runTestsCode.match(/execSync\(/g) ?? []).length;

  // El mensaje se DERIVA del caso que se dio. "Sobra un execSync" y "falta el del runner" son dos
  // problemas opuestos y el texto anterior asumía siempre el primero: con 0 call sites decía "apareció
  // un `execSync(` fuera del runner", que manda a buscar justo lo que no está. Quien lee esto a las 3 de
  // la mañana se guía por esta línea, no por el código del test. (La rama del `else` sólo puede darse
  // con `found === 0`: con 1 la aserción no falla y el mensaje no se usa.)
  const diagnostico =
    found > 1
      ? `SOBRA: hay ${found} call sites de \`execSync(\` y el runner usa UNO SOLO, así que ${found - 1} ` +
        'ejecuta(n) comandos por fuera del `exec` inyectado: quedan fuera del `try`, fuera del resumen ' +
        'total, y si tiran vuelven a matar el proceso apagando los stages siguientes SIN DECIRLO. Ese es ' +
        'EXACTAMENTE el defecto que cerramos el 2026-08-17. Pasá esos comandos por `runner.run()`.'
      : 'FALTA: no hay NINGÚN `execSync(` en el archivo (0 call sites). El comando que el runner recibe ' +
        'como `exec` desapareció o cambió de nombre — y el runner sin `exec` no ejecuta nada. Si lo ' +
        'reemplazaste por otra primitiva, no la dejes suelta: el `exec` inyectado TIENE que tirar cuando ' +
        'el comando devuelve ≠0 (de eso vive la acumulación de fallos y el resumen total). Mirá también ' +
        'el guard del import de `node:child_process`, que es por donde tiene que entrar.';

  assert.equal(found, 1, diagnostico);
  assert.match(runTestsSrc, /import \{ createStageRunner \} from '\.\/lib\/stage-runner\.mjs'/);
  assert.match(runTestsSrc, /console\.log\(runner\.summary\(\)\)/, 'el resumen total tiene que imprimirse');
});

test('GUARD: la única primitiva de ejecución que ENTRA al archivo es `execSync` (anclado en el import)', () => {
  // Escrito sobre la AUSENCIA, y anclado en la IMPORTACIÓN a propósito. El guard de arriba cuenta
  // `execSync(`: vigila un NOMBRE, y por eso tiene un agujero de clase — un `spawnSync`, un
  // `execFileSync` o un `exec` sueltos ejecutarían un comando por fuera del runner y ninguno de los dos
  // guards lo vería. Enumerar acá los nombres prohibidos sería otra LISTA QUE SE PUDRE, que es la misma
  // clase de bug que venimos cerrando en este archivo (la lista de skips escrita a mano nombraba 10 de
  // las 16 suites).
  //
  // El cuello de botella que NO se puede esquivar es la puerta de entrada: en Node, TODA primitiva de
  // ejecución de comandos —exec, execFile, execSync, execFileSync, spawn, spawnSync, fork— sale de
  // `node:child_process`. Mientras el archivo traiga de ahí `execSync` y NADA MÁS, la primitiva nueva
  // (se llame como se llame, la agregue quien la agregue) OBLIGA a tocar esta línea, y nace en rojo sin
  // que el guard tenga que conocer su nombre.
  //
  // Se cierra también la puerta de atrás: un `require('node:child_process')` o un
  // `await import('node:child_process')` esquivan el import estático. Por eso la regla no es "el import
  // está bien escrito" sino "el módulo se nombra UNA sola vez en todo el archivo, y esa vez es el import".
  const mentions = [...runTestsCode.matchAll(/(['"])(?:node:)?child_process\1/g)];
  assert.equal(
    mentions.length,
    1,
    `\`child_process\` se nombra ${mentions.length} vece(s) en el código. Tiene que ser UNA sola: la del ` +
      'import estático de arriba de todo. Un segundo `require(...)` o `await import(...)` del módulo es ' +
      'una primitiva de ejecución entrando por la puerta de atrás, fuera del `exec` inyectado al runner.',
  );

  const imp = runTestsCode.match(/import\s*\{([^}]*)\}\s*from\s*'node:child_process';/);
  assert.ok(
    imp,
    "El único acceso permitido a child_process es `import { execSync } from 'node:child_process';`. Si " +
      'cambió la forma (import default, namespace, sin el prefijo `node:`), actualizá este guard a ' +
      'propósito — no lo aflojes de paso.',
  );

  const bindings = imp[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(
    bindings,
    ['execSync'],
    'El import de `node:child_process` trae algo más que `execSync`. Toda primitiva de ejecución nueva ' +
      'puede correr un comando SIN pasar por el `exec` inyectado en el runner: ese comando quedaría fuera ' +
      'del try/catch, fuera del resumen total y —si tira— volvería a matar el proceso apagando los stages ' +
      'siguientes en silencio. Ese es exactamente el defecto que este archivo existe para impedir. Si de ' +
      'verdad hace falta otra primitiva, pasala por `createStageRunner({ exec })` y justificá el cambio acá.',
  );
});

test('GUARD: el exit code sale de `process.exitCode`, y ningún `process.exit()` puede truncar el resumen', () => {
  assert.match(runTestsCode, /process\.exitCode = runner\.exitCode/);

  const summaryAt = runTestsCode.indexOf('console.log(runner.summary())');
  assert.ok(summaryAt > 0);
  for (const m of runTestsCode.matchAll(/process\.exit\(/g)) {
    assert.ok(
      m.index < summaryAt,
      'Hay un `process.exit()` después de imprimir el resumen. En Windows stdout a un pipe es asíncrono ' +
        'y eso TRUNCA el resumen justo cuando importa. Usá `process.exitCode`.',
    );
  }
});

test('GUARD: ningún stage de TEST se marca `fatal` (sólo el typecheck puede cortar)', () => {
  const fatalLines = runTestsCode
    .split('\n')
    .filter((l) => /fatal:\s*true/.test(l) && !l.trimStart().startsWith('//'));

  assert.ok(fatalLines.length >= 1, 'el typecheck tiene que seguir siendo fatal');
  for (const l of fatalLines) {
    assert.match(
      l,
      /typecheck/,
      'Se marcó `fatal: true` un stage que no es el typecheck. Un stage de TEST fatal reabre el agujero ' +
        'que cerramos: su rojo apagaría a los que vienen atrás. Si de verdad hace falta, justificalo acá ' +
        'y actualizá este guard a propósito.',
    );
  }
});

test('GUARD: no se perdieron stages — siguen declarados al menos los 22 conocidos', () => {
  const callSites = runTestsCode.match(/^\s*(?:run|db)\(/gm) ?? [];
  assert.ok(
    callSites.length >= 22,
    `Hay ${callSites.length} call sites de stage y esperábamos ≥22. Si borraste un stage a propósito, ` +
      'bajá el número acá con el motivo. Un stage que desaparece del archivo NUNCA MÁS CORRE, y esta ' +
      'es la única señal barata de eso.',
  );
});

test('GUARD: las 16 suites de DB se saltean UNA POR UNA (nada de listas paralelas escritas a mano)', () => {
  const dbCallSites = runTestsCode.match(/^\s*db\(/gm) ?? [];
  assert.ok(dbCallSites.length >= 16, `esperaba ≥16 stages gateados por keys, hay ${dbCallSites.length}`);
  assert.match(
    runTestsSrc,
    /runner\.skip\(label, 'falta SUPABASE_SERVICE_ROLE_KEY/,
    'el SKIP tiene que derivarse del call site real. La lista a mano que había antes nombraba 10 de 16.',
  );
});

// ── extracción de CALL SITES COMPLETOS (no líneas sueltas) ──────────────────────────────────────────
// Un stage puede declararse en una línea (`db('RLS suite', `node --test …`);`) o en varias — y este
// archivo YA usa la forma multilínea para los stages 2 a 6. Cualquier guard que razone por LÍNEA es
// ciego a la segunda forma. Estas tres funciones devuelven el TEXTO COMPLETO de cada llamada: se ubica
// el nombre (`run` / `db` / `runner.run`, nunca un `.run` de otro objeto ni un `run` que sea parte de
// otra palabra) y se avanza hasta el paréntesis que lo cierra, contando paréntesis y SALTANDO strings.
// Saltar strings no es cosmético: los labels tienen paréntesis adentro ('Animal suite (spec 02)') y los
// comandos son template literals.
//
// Límite conocido y aceptado: no se interpretan literales de regex ni templates anidados. Hoy no hay
// ninguno adentro de un call site; si algún día los hay, el balanceo puede desincronizar y el guard se
// pone ROJO. Es la dirección segura de fallar: pide una mirada humana, no regala un verde.

/** Índice de la comilla que CIERRA el literal que abre en `i`. -1 si no cierra. */
function endOfString(src, i) {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++; // escape: el próximo carácter no delimita nada
      continue;
    }
    if (c === quote) return j;
    if (quote !== '`' && c === '\n') return -1; // '…' y "…" no cruzan de línea
  }
  return -1;
}

/** Índice del paréntesis que CIERRA el que abre en `open`, ignorando los que viven dentro de strings. */
function endOfCall(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(src, i);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Todos los call sites de stage del archivo, con su texto de argumentos y el rango que ocupan. */
function stageCallSites(src) {
  const re = /(?<![\w$.])((?:runner\s*\.\s*)?(?:run|db))\s*\(/g;
  const sites = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = endOfCall(src, open);
    const to = close === -1 ? src.length : close;
    sites.push({ callee: m[1].replace(/\s+/g, ''), args: src.slice(open + 1, to), from: open + 1, to });
    if (close !== -1) re.lastIndex = close + 1; // no re-escanear lo que ya quedó adentro de este call site
  }
  return sites;
}

test('GUARD: TODO stage que pega contra la DB remota pasa por `db()`, nunca por `run()`', () => {
  // Escrito sobre la AUSENCIA. El riesgo real es una suite NUEVA agregada con `run(` adentro del bloque:
  // en `ci.yml` (que corre SIN keys en cada push) se ejecutaría igual, fallaría por falta de credenciales
  // y pondría el badge en rojo permanente — la forma más rápida de que un CI deje de significar algo.
  //
  // La primera versión de este guard NO cubría ese riesgo: filtraba LÍNEA POR LÍNEA, así que solo cazaba
  // al infractor cuando el `run(` y el path `supabase/tests/…` caían en la MISMA línea. Lo que se le
  // escapaba era justamente el copy-paste más probable: los stages 4, 5 y 6 de `run-tests.mjs` ya están
  // escritos en multilínea, y clonar uno de ellos para una suite de DB entraba en verde. Falsificado el
  // 2026-08-17 pegando ese mutante en run-tests.mjs: la suite daba 26/26 con el agujero abierto.
  //
  // Ahora la regla se ancla en la MENCIÓN del path, no en la forma de la llamada: toda aparición de
  // `supabase/tests/…` en el código tiene que caer DENTRO de un call site de `db()`. Eso cierra las tres
  // formas de evadirlo — el `run(` de una línea, el `run(` multilínea, y el `runner.run(` que saltea el
  // alias— y además pone en rojo la mención SUELTA (una constante, un array de suites armado aparte):
  // si el archivo cambia de forma, que el guard exija una decisión explícita en vez de mirar al costado.
  const sites = stageCallSites(runTestsCode);
  const mentions = [...runTestsCode.matchAll(/supabase\/tests\/[\w./-]*/g)];

  // Sanity del ESCÁNER, antes del veredicto: si el extractor dejara de encontrar call sites (un cambio
  // de forma del archivo, un desbalanceo), `offenders` quedaría vacío y este guard sería un verde
  // automático — un test que no puede fallar. Que reviente acá primero, con el número a la vista.
  assert.ok(mentions.length >= 16, `esperaba ≥16 menciones de supabase/tests/, encontré ${mentions.length}`);
  assert.ok(sites.length >= 22, `el extractor encontró ${sites.length} call sites (<22): se rompió el escaneo`);

  const offenders = [
    ...new Set(
      mentions
        .filter((men) => {
          const site = sites.find((s) => men.index >= s.from && men.index < s.to);
          return !(site && site.callee === 'db');
        })
        .map((men) => {
          const site = sites.find((s) => men.index >= s.from && men.index < s.to);
          if (!site) return `${men[0]} — mencionada FUERA de todo call site de stage`;
          const label = (site.args.match(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/) ?? [])[2] ?? '?';
          return `${site.callee}('${label}') → ${men[0]}`;
        }),
    ),
  ];

  assert.deepEqual(
    offenders,
    [],
    'Estas suites de DB no están gateadas por `db()`. Sin keys se ejecutarían igual y romperían ci.yml. ' +
      '(Si lo que aparece es prosa y no una llamada, va en una línea de comentario propia: este guard ' +
      'escanea el código con los comentarios de línea enteros ya descartados.)',
  );
});
