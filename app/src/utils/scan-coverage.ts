// assertScanCoverage — la AUTO-VERIFICACIÓN de cobertura que todo guard que escanea archivos tiene que
// hacer sobre SÍ MISMO antes de declararse verde.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────────
// **Un verificador roto y un verificador que no encuentra nada se ven exactamente igual: verde.**
// En este repo eso ya pasó DOS veces con guards escritos a propósito para cerrar bugs de clase:
//   1. El guard del teclado chequeaba el PREDICADO EQUIVOCADO (buscaba el uso *incorrecto* de un
//      componente en vez de la *ausencia* de él) → no podía ver `maniobra/identificar.tsx`, que no
//      montaba nada. Verde con 23 superficies rotas adentro.
//   2. Los 3 guards estáticos blanqueaban comentarios con dos regexes, y ese blanqueo abría un bloque
//      FALSO ante un `/*` escrito dentro de un comentario de LÍNEA: se comía el archivo hasta el próximo
//      cierre de bloque. Medido sobre el árbol de `fc4d164`: **556 líneas de código invisibles en 6
//      archivos** de `app/app`+`app/src` (341 en `maniobra/identificar.tsx`, 113 en
//      `asignar-caravanas.tsx`, 84 en `FindOrCreateOverlay.tsx`, 10 en `_layout.tsx`, 6+2 en los dos de
//      SIGSA). Los guards recortaban su propia entrada sin avisar. Verde otra vez.
// Los dos fallos comparten la forma: el guard se quedó sin ENTRADA (o con menos de la que cree tener) y
// no tenía cómo darse cuenta. Esto es lo que lo cierra.
//
// ── LAS DOS PREGUNTAS ───────────────────────────────────────────────────────────────────────────────
//  (A) ¿Cuántos archivos miré?  → contra un PISO explícito. Si el glob deja de matchear (se renombra una
//      carpeta, se mueve `src/`, se rompe el `listFiles`), el guard se pone ROJO en vez de pasar en
//      vacío.
//  (B) ¿Miré los archivos ENTEROS? → dos chequeos por archivo sobre el texto post-blanqueo:
//        · BALANCE DE LLAVES — el código que le queda al guard tiene que tener `{}` balanceadas y no
//          bajar nunca de cero. Es la invariante que un blanqueo desbocado ROMPE: si un comentario falso
//          se traga un pedazo del archivo, se lleva llaves de apertura y quedan cierres huérfanos.
//          Verificado: con el blanqueo VIEJO sobre `fc4d164`, los 3 archivos afectados dan profundidad
//          NEGATIVA (`identificar.tsx` −3, `asignar-caravanas.tsx` −2, `FindOrCreateOverlay.tsx` −2);
//          con el escáner con estado, los 364 archivos de `app/app`+`app/src` cierran en 0.
//        · RETENCIÓN — un archivo grande que después del blanqueo conserva una fracción ridícula de sus
//          líneas está siendo comido. Cubre el caso extremo ("un archivo de 1270 líneas que queda en
//          200") que el balance también vería, pero de forma directa y legible.
//
// ⚠️ HONESTIDAD SOBRE EL ALCANCE DE CADA UNO: la RETENCIÓN sola NO habría cazado el bug histórico.
// Medido: `maniobra/identificar.tsx` pasaba de 0.814 (escáner correcto) a **0.529** con el blanqueo
// viejo — muy por encima de cualquier piso sensato. El que sí lo caza es el BALANCE. Por eso están los
// dos y por eso el piso de retención es bajo: no es la red principal, es la red del caso extremo.
//
// ── LO QUE ESTO **NO** CUBRE (declarado, no descubierto después) ─────────────────────────────────────
//  · Un blanqueo que blanquee **de MENOS** (p. ej. la identidad, que deja los comentarios adentro). No
//    lo caza: el balance se calcula sobre el texto ya pasado por el escáner canónico, que limpiaría esos
//    comentarios. No importa, porque ese fallo es RUIDOSO por otro lado — un guard que ve los comentarios
//    reporta falsos positivos y lo cubren los tests "una mención en un comentario no dispara" de cada guard.
//    El fallo SILENCIOSO —el que se ve verde— es blanquear de MÁS, y ese es el que estos dos chequeos cazan.
//  · Que el PREDICADO del guard sea el equivocado. Eso no es cobertura de entrada, es diseño del oráculo,
//    y se cierra falsificando (mutar el árbol real y ver rojo), no desde acá.

// ⚠️ Este módulo NO importa `node:assert` (ni ningún builtin de Node) a propósito: vive en `app/src`, que
// el `tsconfig` del cliente type-checkea SIN los tipos de Node (los guards pueden usarlos porque
// `**/*.test.ts` está excluido, este archivo no lo está). Señaliza tirando un `Error` con el diagnóstico
// completo, que `node:test` reporta igual que un assert fallido.

import { stripSourceCommentsAndStrings } from './strip-comments';

export interface ScanCoverageOptions {
  /** Nombre del guard, para que el mensaje diga quién se quedó ciego. */
  guard: string;
  /** Los archivos que el guard efectivamente va a escanear. */
  files: string[];
  /** Piso de archivos esperado. Debajo de esto, el glob se rompió. */
  minFiles: number;
  /** Cómo mostrar un archivo en el mensaje (path relativo). */
  label: (file: string) => string;
  /** Contenido crudo del archivo. */
  read: (file: string) => string;
  /** EL BLANQUEO QUE USA EL GUARD — es lo que estamos auditando, no una copia. */
  strip: (src: string) => string;
  /**
   * ⚠️ **SOLO PARA EL TEST DE LA PROPIA ALLOWLIST** (`scan-coverage.test.ts`). Si viene, **REEMPLAZA** a
   * `SCAN_COVERAGE_ALLOW` — es lo único que permite medir el mismo árbol CON la exención y SIN ella, que
   * es la única forma de demostrar que la exención hace lo que dice.
   *
   * Ningún guard de producción la pasa, y **hay un guard que lo verifica** (`la puerta a la allowlist es
   * UNA`): dos puertas a una allowlist es una allowlist sin freno, porque la segunda no la mira nadie.
   */
  allow?: ScanCoverageAllow;
}

/**
 * Una exención declarada del chequeo (B). **Exime de UN chequeo, no del escaneo**: el archivo se sigue
 * leyendo, blanqueando y midiendo, y el otro chequeo sigue corriendo sobre él. No existe "eximir un
 * archivo" — eso sería devolverle al guard la ceguera que este módulo vino a cerrar.
 */
export interface ScanCoverageExemption {
  /**
   * `'retention'` → el archivo puede quedar por debajo del piso de retención (el BALANCE sigue corriendo).
   * `'braces'`    → el archivo puede desbalancear llaves (la RETENCIÓN sigue corriendo). Reservado para el
   *                 fuente raro que el escáner no puede leer bien (un literal con una llave suelta).
   */
  check: 'retention' | 'braces';
  /**
   * Por qué la anomalía es LEGÍTIMA — escrito **acá**, no un puntero a un informe. El guard de la
   * allowlist exige que sea sustantivo: una entrada que dice "ver el análisis" es una entrada que nadie
   * va a poder evaluar dentro de seis meses, y una allowlist que no se puede evaluar no se saca nunca.
   */
  why: string;
}

export type ScanCoverageAllow = Readonly<Record<string, ScanCoverageExemption>>;

/**
 * ── LA ALLOWLIST, ÚNICA Y COMPARTIDA ────────────────────────────────────────────────────────────────
 * Clave = el `label` del archivo, que los **diez** guards que corren esta auto-verificación calculan
 * igual (`relative(APP_ROOT, f)` con `/`), así que UNA entrada alcanza para los diez. Eso no es
 * casualidad ni suerte: es el motivo por el que la lista vive acá y no en cada guard. Un archivo raro no
 * tiene nada que ver con el predicado de `keyboard-avoiding` ni con el de `today-iso`, y hacer que cada
 * guard declare su propia exención garantizaría que la novena copia se olvide.
 *
 * **El freno está en `scan-coverage.test.ts`**, y es lo que separa esto de una salida de emergencia para
 * todos: cada entrada tiene que existir, traer su motivo escrito, estar GANADA contra el árbol real (si
 * el archivo dejó de violar el chequeo, la entrada sobra y se pone roja), y la lista tiene un tope.
 */
export const SCAN_COVERAGE_ALLOW: ScanCoverageAllow = {
  'src/services/ble/logging.ts': {
    check: 'retention',
    why:
      'Es el CATÁLOGO de eventos de diagnóstico del transporte BLE, y ahí la prosa ES el artefacto: cada ' +
      'miembro del union `TransportLogEvent` existe para que un síntoma en logcat se distinga de otro ' +
      '("conectado y mudo" con el terminador equivocado vs. el bastón apagado vs. el socket muerto son el ' +
      'MISMO silencio desde afuera), y el comentario de cada uno es lo que dice cuál es cuál y qué hacer. ' +
      'Medido el 2026-08-17: 148 líneas no vacías → 34 de código (retención 0.230), o sea ya por debajo ' +
      'del piso; lo único que lo salvaba era estar DOS líneas abajo del umbral de tamaño, así que agregar ' +
      'dos miembros de una línea al union ponía en rojo a NUEVE guards que no tienen nada que ver con esta ' +
      'unidad, con un mensaje sobre el blanqueo y a nueve guards de distancia del síntoma real (es el ' +
      'incidente del 2026-08-06 que documenta `tap-target-collision-guard.test.ts`). NO es un blanqueo ' +
      'roto: el escáner funciona bien y el balance de llaves de este archivo cierra en 0 — por eso la ' +
      'exención es SOLO de la retención y el balance le sigue corriendo. La alternativa era purgar prosa ' +
      'de otras unidades para satisfacer una heurística de cobertura, que es optimizar la métrica CONTRA ' +
      'su propósito: el guard existe para que no se pierda entrada, y borrar documentación de diagnóstico ' +
      'para bajar un ratio no le devuelve entrada a nadie.',
  },
};

/**
 * Un archivo entra al chequeo de RETENCIÓN a partir de acá (líneas no en blanco). Los archivos chicos
 * quedan afuera a propósito: un util de 25 líneas con 20 de header docblock retiene 0.12 legítimamente
 * (medido: `services/ble/config.ts` = 0.120, `KeyboardAvoidingShell.android.tsx` = 0.092).
 */
export const BIG_FILE_LINES = 150;

/**
 * Piso de retención para los archivos grandes. Medido sobre el árbol real (364 archivos de
 * `app/app`+`app/src`, 170 de ellos "grandes"): el MÍNIMO observado con el escáner correcto es **0.343**
 * (`utils/maneuver-applicability.ts`). El caso que tiene que poner rojo —1270 líneas que quedan en 200—
 * da 0.157. El piso va en el medio, más cerca del caso malo.
 */
export const MIN_RETAINED_RATIO = 0.25;

const nonBlankLines = (src: string) => src.split(/\r?\n/).filter((l) => l.trim() !== '').length;

/** Profundidad final y mínima de `{}` en un texto ya sin comentarios NI strings. */
function braceDepth(code: string): { end: number; min: number } {
  let depth = 0;
  let min = 0;
  for (const ch of code) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < min) min = depth;
    }
  }
  return { end: depth, min };
}

/**
 * Corre la auto-verificación. Tira (falla el test) si el guard se quedó sin entrada o si su blanqueo se
 * está comiendo archivos.
 *
 * Nota sobre el balance: se cuentan **solo las llaves**, no los paréntesis. En JSX una llave suelta es
 * error de sintaxis (`{` siempre abre un contenedor de expresión), así que el balance de `{}` es una
 * invariante real del fuente; los paréntesis, en cambio, aparecen sueltos en el TEXTO de la UI
 * ("Dosis (opcional)", "ver §3)") y darían falsos positivos.
 */
export function assertScanCoverage(opts: ScanCoverageOptions): void {
  const allow = opts.allow ?? SCAN_COVERAGE_ALLOW;

  // (A) ¿Cuántos archivos miré?
  if (opts.files.length < opts.minFiles) {
    throw new Error(
      `[${opts.guard}] escaneó ${opts.files.length} archivos y el piso es ${opts.minFiles}: el glob dejó de ` +
        'matchear (¿se movió/renombró una carpeta, se rompió el listado?). Un guard que mira menos archivos ' +
        'de los que cree NO se pone rojo solo — se pone VERDE. Si el árbol encogió a propósito, bajá el piso ' +
        'en el mismo commit y decí por qué.',
    );
  }

  // (B) ¿Miré los archivos enteros?
  const eaten: string[] = [];
  const unbalanced: string[] = [];
  for (const file of opts.files) {
    const label = opts.label(file);
    // `hasOwnProperty` y no `in`: con `in`, un archivo que se llamara `toString`/`constructor` quedaría
    // exento por herencia de `Object.prototype` — o sea, el guard se saltearía un archivo sin que nadie lo
    // haya declarado. Es improbable con paths, pero es exactamente la clase de omisión silenciosa que este
    // módulo existe para no repetir.
    const exempt = Object.prototype.hasOwnProperty.call(allow, label) ? allow[label] : undefined;
    // ⚠️ El archivo eximido NO se saltea: se lee, se blanquea y se mide igual, y el chequeo que la
    // exención NO nombra sigue corriendo sobre él. Un `continue` acá —que es lo que había— convertía
    // cualquier entrada en "este archivo deja de existir para el guard", que es justo la ceguera que este
    // módulo cierra.
    const raw = opts.read(file);
    const stripped = opts.strip(raw);

    const before = nonBlankLines(raw);
    const after = nonBlankLines(stripped);
    const ratio = before === 0 ? 1 : after / before;
    if (before >= BIG_FILE_LINES && ratio < MIN_RETAINED_RATIO && exempt?.check !== 'retention') {
      eaten.push(`${label}  ${before} líneas → ${after} (retiene ${ratio.toFixed(3)})`);
    }

    const { end, min } = braceDepth(stripSourceCommentsAndStrings(stripped));
    if ((end !== 0 || min < 0) && exempt?.check !== 'braces') {
      unbalanced.push(`${label}  llaves: cierra en ${end}, mínimo ${min}`);
    }
  }

  if (unbalanced.length > 0) {
    throw new Error(
      `[${opts.guard}] el texto que este guard escanea tiene las LLAVES DESBALANCEADAS en ` +
        `${unbalanced.length} archivo(s). Un blanqueo que se come un pedazo del fuente se lleva llaves de ` +
        'apertura y deja cierres huérfanos (profundidad negativa) — es exactamente la firma del bug del ' +
        'blanqueo a dos regexes, que dejaba 556 líneas de código invisibles sin que nada fallara. Arreglá ' +
        'el blanqueo; NO agregues el archivo a `allow` sin haber entendido por qué desbalancea.\n' +
        unbalanced.join('\n'),
    );
  }

  if (eaten.length > 0) {
    throw new Error(
      `[${opts.guard}] el blanqueo se está COMIENDO ${eaten.length} archivo(s): después de blanquear queda ` +
        `menos del ${Math.round(MIN_RETAINED_RATIO * 100)}% de sus líneas. El guard estaría escaneando un ` +
        'archivo que casi no existe y pasando verde por eso.\n' +
        eaten.join('\n'),
    );
  }
}
