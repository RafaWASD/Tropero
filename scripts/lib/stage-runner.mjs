// scripts/lib/stage-runner.mjs — orquestador de stages con ACUMULACIÓN de fallos.
//
// ── POR QUÉ EXISTE (2026-08-17) ─────────────────────────────────────────────────────────────────────
// `scripts/run-tests.mjs` corría cada stage con `execSync` suelto, SIN `try`. `execSync` tira cuando el
// comando devuelve ≠0 y nadie capturaba → el proceso moría en el PRIMER stage rojo y los stages
// siguientes NUNCA se ejecutaban. Con `client unit tests` en la posición 3 de 22, un rojo ahí apagaba
// las 16 suites de backend — las únicas que ven RLS, tenant-isolation, audit y drift de migraciones.
//
// El modo de falla NO era "el check está rojo". Era SILENCIO CON FORMA DE SEÑAL CONOCIDA: se veía un
// único fallo que ya tenía explicación ("es el guard de marca, no es regresión"), se concluía que el
// resto estaba sano, y el resto no había corrido. Pasó de verdad y durante días (spec 23 introdujo un
// header que el guard de marca cazaba). Está documentado en docs/backlog.md.
//
// ── LA DECISIÓN CENTRAL: EL RESUMEN ES TOTAL ────────────────────────────────────────────────────────
// Un stage que no se ejecutó NO desaparece de la salida: se imprime `NO CORRIÓ`, con el motivo y el
// nombre del stage que abortó la corrida. Eso es lo que cierra el agujero de verdad — el defecto no era
// *cortar*, era *callar*. Mientras el resumen nombre a los 22, nadie puede volver a leer "un solo rojo
// conocido" y concluir "el resto está sano".
//
// Con el resumen total, abortar deja de ser peligroso y pasa a ser una decisión de COSTO: los stages de
// build/typecheck se marcan `fatal` (si el árbol no compila, el veredicto ya es "no" y las 16 suites de
// backend cuestan minutos, escriben fixtures en la base DEV COMPARTIDA y suman un escritor concurrente
// al flake conocido de rate-limit de auth). Los stages de TEST nunca son fatales: acumulan.
//
// ── CONTRATO CON LOS CONSUMIDORES (no romper) ───────────────────────────────────────────────────────
//   · `scripts/check.mjs` invoca `run-tests.mjs` como comando y solo mira el EXIT CODE (0 verde / ≠0
//     rojo). No parsea la salida.
//   · `.github/workflows/ci.yml` corre `check.mjs` SIN `SUPABASE_SERVICE_ROLE_KEY` en cada push → los 16
//     stages de DB se saltean y el job tiene que quedar VERDE. Por eso `skipped` NO suma al exit code.
//     Pero sí GRITA en el resumen: un stage salteado no es un stage verde.
//   · `.github/workflows/ci-db.yml` (nightly) corre `run-tests.mjs` CON keys → RC≠0 ante cualquier rojo.

export const STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  SKIPPED: 'skipped',
  NOT_RUN: 'not-run',
};

const ANSI = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m' };

function formatMs(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Primera línea del mensaje de error, sin el volcado gigante de `execSync` (que repite el comando
// entero — la lista de ~170 archivos de test hace 7 KB de ruido por fallo).
function shortReason(err) {
  const raw = String((err && err.message) || err || 'error desconocido');
  return raw.split('\n')[0].slice(0, 200);
}

/**
 * @param {object} o
 * @param {(cmd: string) => void} o.exec        ejecuta el comando; DEBE tirar si el exit code es ≠0.
 * @param {(line: string) => void} [o.log]      sink de la salida en streaming.
 * @param {() => number} [o.now]                reloj inyectable (tests deterministas).
 * @param {boolean} [o.failFast]                corta en el PRIMER rojo, sea fatal o no (modo viejo).
 * @param {boolean} [o.keepGoing]               ignora los `fatal`: corre todos los stages pase lo que pase.
 * @param {boolean} [o.colors]                  ANSI en el resumen.
 */
export function createStageRunner({
  exec,
  log = console.log,
  now = () => Date.now(),
  failFast = false,
  keepGoing = false,
  colors = false,
} = {}) {
  if (typeof exec !== 'function') throw new TypeError('createStageRunner: falta `exec`');
  if (failFast && keepGoing) {
    throw new TypeError('createStageRunner: --fail-fast y --keep-going son mutuamente excluyentes');
  }

  /** @type {{label:string,status:string,exitCode:number|null,ms:number|null,reason:string|null}[]} */
  const results = [];
  /** @type {{label:string, kind:'fatal'|'fail-fast'}|null} */
  let aborted = null;

  const paint = (s, c) => (colors ? `${ANSI[c]}${s}${ANSI.reset}` : s);

  function computeCounts() {
    const c = { total: results.length, pass: 0, fail: 0, skipped: 0, notRun: 0 };
    for (const r of results) {
      if (r.status === STATUS.PASS) c.pass++;
      else if (r.status === STATUS.FAIL) c.fail++;
      else if (r.status === STATUS.SKIPPED) c.skipped++;
      else if (r.status === STATUS.NOT_RUN) c.notRun++;
    }
    return c;
  }

  function record(label, status, extra = {}) {
    const row = { label, status, exitCode: null, ms: null, reason: null, ...extra };
    results.push(row);
    return row;
  }

  // Registra el stage como NO CORRIÓ si ya se abortó. Devuelve true si hubo que hacerlo.
  function shortCircuit(label) {
    if (!aborted) return false;
    const motivo =
      aborted.kind === 'fatal'
        ? `abortado tras el fallo FATAL de '${aborted.label}'`
        : `abortado por --fail-fast tras '${aborted.label}'`;
    record(label, STATUS.NOT_RUN, { reason: motivo });
    log(`\n>>> ${label}`);
    log(`    NO CORRIÓ — ${motivo}`);
    return true;
  }

  return {
    /** Ejecuta un stage. `fatal:true` ⇒ su fallo aborta los siguientes (salvo `--keep-going`). */
    run(label, cmd, { fatal = false } = {}) {
      if (shortCircuit(label)) return;

      log(`\n>>> ${label}`);
      log(`    ${cmd}`);
      const t0 = now();
      try {
        exec(cmd);
        const ms = now() - t0;
        record(label, STATUS.PASS, { ms, exitCode: 0 });
        log(`<<< ${label} OK (${formatMs(ms)})`);
      } catch (err) {
        const ms = now() - t0;
        const exitCode = typeof err?.status === 'number' ? err.status : null;
        record(label, STATUS.FAIL, { ms, exitCode, reason: shortReason(err) });

        if (failFast) {
          aborted = { label, kind: 'fail-fast' };
          log(`<<< ${label} FAIL (exit ${exitCode ?? '?'}, ${formatMs(ms)}) — corto acá (--fail-fast)`);
        } else if (fatal && !keepGoing) {
          aborted = { label, kind: 'fatal' };
          log(
            `<<< ${label} FAIL (exit ${exitCode ?? '?'}, ${formatMs(ms)}) — stage FATAL: no tiene sentido ` +
              `seguir. Para barrer todo igual: --keep-going`,
          );
        } else {
          log(
            `<<< ${label} FAIL (exit ${exitCode ?? '?'}, ${formatMs(ms)}) — SIGO con los stages siguientes ` +
              `(el resumen final los nombra a todos)`,
          );
        }
      }
    },

    /** Registra un stage que NO se ejecuta por una condición declarada (ej.: faltan las keys). */
    skip(label, reason) {
      if (shortCircuit(label)) return;
      record(label, STATUS.SKIPPED, { reason });
      log(`\n>>> ${label}`);
      log(`    SKIP — ${reason}`);
    },

    get results() {
      return results.slice();
    },

    get aborted() {
      return aborted;
    },

    get counts() {
      return computeCounts();
    },

    /**
     * ÚNICA fuente del veredicto.
     *   · FAIL     → rojo, obvio.
     *   · NOT_RUN  → rojo TAMBIÉN. Hoy sólo puede existir después de un FAIL (es lo único que setea
     *                `aborted`), así que es redundante — y va igual, a propósito: si mañana alguien
     *                agrega un camino de aborto que no sea un fallo, el default tiene que ser "no puedo
     *                afirmar que esté verde", no "verde". Un stage que no corrió nunca es evidencia.
     *   · SKIPPED  → verde. Es una condición DECLARADA (faltan las keys) y `ci.yml` corre así en cada
     *                push; el resumen igual lo grita.
     */
    get exitCode() {
      return results.some((r) => r.status === STATUS.FAIL || r.status === STATUS.NOT_RUN) ? 1 : 0;
    },

    /**
     * Resumen TOTAL: una línea por stage declarado, incluidos los que no corrieron. Es la pieza que
     * cierra el defecto — la salida ya no puede sugerir que lo que no se ejecutó está sano.
     */
    summary() {
      const c = computeCounts();
      const width = Math.min(60, Math.max(24, ...results.map((r) => r.label.length)));
      const rule = '='.repeat(Math.max(78, width + 40));
      const thin = '-'.repeat(rule.length);
      const out = [];

      out.push('');
      out.push(rule);
      out.push(
        ` RESUMEN DE STAGES — ${c.total} declarado(s) · ${c.pass} PASS · ${c.fail} FAIL · ` +
          `${c.skipped} SKIP · ${c.notRun} NO CORRIÓ`,
      );
      out.push(rule);

      results.forEach((r, i) => {
        const n = String(i + 1).padStart(2, '0');
        const label = r.label.padEnd(width);
        if (r.status === STATUS.PASS) {
          out.push(` ${n}  ${paint('[ PASS      ]', 'green')}  ${label}  ${formatMs(r.ms).padStart(7)}`);
        } else if (r.status === STATUS.FAIL) {
          out.push(
            ` ${n}  ${paint('[ FAIL      ]', 'red')}  ${label}  ${formatMs(r.ms).padStart(7)}  ` +
              `exit ${r.exitCode ?? '?'}`,
          );
        } else if (r.status === STATUS.SKIPPED) {
          out.push(` ${n}  ${paint('[ SKIP      ]', 'yellow')}  ${label}  ${r.reason ?? ''}`);
        } else {
          out.push(` ${n}  ${paint('[ NO CORRIÓ ]', 'yellow')}  ${label}  ${r.reason ?? ''}`);
        }
      });

      out.push(thin);

      if (c.fail > 0) {
        out.push(` ROJOS (${c.fail}):`);
        results.forEach((r, i) => {
          if (r.status !== STATUS.FAIL) return;
          out.push(`   · ${String(i + 1).padStart(2, '0')}  ${r.label} — exit ${r.exitCode ?? '?'}`);
        });
      }

      if (c.notRun > 0) {
        out.push(
          ` ${paint('⚠', 'yellow')} ${c.notRun} stage(s) NO CORRIERON (${aborted?.kind === 'fatal' ? 'stage fatal' : '--fail-fast'}). ` +
            `NO están verdes: no se ejecutaron.`,
        );
        out.push('   Para barrer todos los stages igual: node scripts/run-tests.mjs --keep-going');
      }

      if (c.skipped > 0) {
        out.push(
          ` ${paint('⚠', 'yellow')} ${c.skipped} stage(s) SALTEADOS por condición declarada. ` +
            `Un stage salteado NO es un stage verde.`,
        );
      }

      if (c.fail === 0 && c.notRun === 0 && c.skipped === 0) {
        // "All tests passed." se conserva porque es el literal que este orquestador imprimió durante
        // años y que citan las bitácoras de `progress/`. Sólo aparece en esta rama: si hay UN fallo, UN
        // skip o UN stage que no corrió, no se imprime.
        out.push(` ${paint('Todos los stages en verde. All tests passed.', 'green')}`);
      }

      out.push(rule);
      return out.join('\n');
    },
  };
}
