// GUARD DE CLASE: ningún target puede crecer sobre territorio ajeno sin que alguien haya verificado
// contra QUÉ choca.
//
// ── EL BUG QUE CIERRA (🔴 device Android, reporte de Raf, 2026-08-05) ────────────────────────────────
// El `Pressable` del FAB de Maniobra llevaba `hitSlop={{ top: $fabRaise }}`. Eso extendía su target 26 dp
// POR ENCIMA del círculo pintado, dentro de la banda del chrome donde vive el pill del bastón: tocar la
// mitad de abajo del pill abría MODO MANIOBRAS. Medido en device (barrido de `adb shell input tap`): techo
// táctil en y=1276 con el círculo pintado arrancando en y=1324 → 48 px = 25,6 dp = `$fabRaise`.
//
// ── POR QUÉ UN GUARD, Y POR QUÉ SOBRE EL INVARIANTE Y NO SOBRE LA INSTANCIA ─────────────────────────
// Arreglar el pill y declarar victoria sería el error: hoy el pill es la ÚNICA superficie en esa banda,
// así que un test sobre el pill se quedaría verde para siempre mientras el mecanismo —un target que crece
// sobre territorio ajeno sin que nadie mire contra qué choca— sigue disponible para el próximo.
//
// ⚠️ ESTE GUARD SE BURLÓ DOS VECES, Y LAS DOS POR EL MISMO ERROR: ESTABA ESCRITO SOBRE LA FORMA EN QUE
// SE ESCRIBE EL BUG Y NO SOBRE EL INVARIANTE. Las dos rondas, con la medición de cada una:
//
//   · v1 (reviewer, 2026-08-06) — 30/30 PASS con el bug entero:
//         - hitSlop={HIT_SLOP}
//         + hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}
//     Se colaba por los cuatro lados: eximía el ARCHIVO, sólo miraba el cuerpo del `const`, contaba
//     OCURRENCIAS (seguía habiendo una) y el E2E medía un espejo escrito a mano.
//   · v2 (esta ronda, 2026-08-06) — 35/35 PASS con el bug entero, por DOS agujeros distintos:
//         const HIT_SLOP = { bottom: Math.max(…), top: FAB_RAISE };   ← todo en UNA línea
//     el extractor partía el objeto por `\n` y se quedaba con la primera clave de cada línea (idem
//     `{ bottom: X, ...EXTRA }` y `['top']: X`); y
//         const { bottom: pad } = useSafeAreaInsets();  <View bottom={pad + 86} />
//     la firma de la banda era una lista de CUATRO nombres fijos, así que renombrar la reserva al
//     destructurar alcanzaba para anclarse en el pico del FAB (86 = navBar 60 + fabRaise 26).
//
// v3 no cuenta claves ni nombres: **resuelve valores**. El invariante, en cinco pedazos:
//
//   (A) **El VALOR de todo `hitSlop` se puede leer estáticamente de un solo lugar.** Literal numérico
//       chico, o identificador pelado declarado en el mismo archivo y con el archivo en el REGISTRO.
//   (A-fix) **El target del FAB no excede su círculo pintado salvo hacia ABAJO.** Se RESUELVE el valor
//       real que usa el JSX —siguiendo spreads, consts, `COLOR.x`, `Math.max` y `getTokenValue`— y se
//       exige `top = left = right = 0` y un `bottom` igual al que sale de los tokens. La gramática da
//       igual: lo que se compara son números. Lo que el resolvedor no puede leer, TIRA (fail-closed).
//   (B) **Nadie se ancla en la banda del borde inferior sin registrarse.** (B1) un `bottom={…}` que SUMA
//       sobre la reserva inferior —con el vocabulario de reserva DERIVADO por archivo, así que cualquier
//       alias cuenta— y (B2) leer cualquiera de los tokens de geometría del nav.
//   (B-banda) **Registrarse NO alcanza: la banda se verifica con números.** El anclaje real de cada
//       superficie registrada se resuelve del fuente y tiene que despejar el techo del target REAL del
//       FAB por ≥ `MIN_TAP_TARGET_SEPARATION`. Un overlay registrado y anclado al pico del FAB es rojo.
//   (E) **El pill del bastón no puede volver a ser tocable.** Decisión revertida el 2026-08-06 con
//       evidencia medida (ver el bloque ⛔ de `StickStatusIndicator.tsx`): sin `onPress`, con
//       `pointerEvents="none"`.
//
// Más las dos mitades de coherencia que impiden que los tests de geometría midan una app imaginaria:
//   (C) `nav-target-bands.test.ts` COPIA los tokens y esa copia se cruza contra los reales; el E2E ya
//       NO copia nada —deriva el hitSlop del fuente con la misma función que este guard— y se verifica
//       que no vuelva a copiar;
//   (D) el código de producción efectivamente lee esos tokens (no un literal equivalente).
//
// ── LO QUE ESTE GUARD **NO** VE (declarado, no descubierto después) ─────────────────────────────────
// · Un anclaje que NO nombra la reserva ni los tokens del nav y llega a la banda con un número pelado
//   (`bottom={96}`): `bottom` es relativo al PADRE, y estáticamente no se sabe si ese padre es la
//   pantalla o una card. Distinguirlo pide layout, no texto. El complemento es el E2E, que mide cajas.
// · La reserva lavada a través de DOS o más niveles de indirección, o cruzando el borde de un módulo.
//   Se resuelve UN nivel de const local para la FIRMA (y hasta 8 saltos para el VALOR, que se resuelve
//   dentro del archivo). Un guard que pretende cubrir lo que no cubre es peor que uno que declara su
//   límite.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza. Y ningún test de COMPORTAMIENTO en web puede reemplazarlo: `hitSlop` es no-op en
// react-native-web 0.21.2 (`Pressable` no lo implementa) — el bug es invisible ahí por construcción.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokens as tamaguiDefaultTokens } from '@tamagui/themes/v4';

import { stripSourceComments, stripSourceCommentsAndStrings } from './strip-comments';
import { assertScanCoverage } from './scan-coverage';
import {
  MIN_TAP_TARGET_SEPARATION,
  REAL_BOTTOM_RESERVES,
  REAL_TOP_RESERVES,
  TargetResolutionError,
  allJsxProps,
  evaluateDp,
  fabTargetBand,
  insetsWithDefaults,
  jsxPropExpressions,
  navGeometryFromConfig,
  resolveFabHitSlop,
  resolveByReserve,
  resolveInsetSides,
  sizeTokenFromConfig,
  type ResolveEnv,
} from './nav-target-bands';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Ver `utils/scan-coverage.ts`. */
const SCANNED_FILES_FLOOR = 300;

const TAMAGUI_CONFIG = 'tamagui.config.ts';
const FAB_OWNER = 'app/(tabs)/_layout.tsx';
const PILL = 'src/features/ble-stick/components/StickStatusIndicator.tsx';
const INDICATOR_GEOMETRY = 'src/features/ble-stick/indicator-geometry.ts';
/** La pantalla que RESERVA la banda para el indicador (ver (F-reserva)). */
const HOME = 'app/(tabs)/index.tsx';
const PURE_TEST = 'src/utils/nav-target-bands.test.ts';
const E2E_GUARD = 'e2e/fab-target-geometry.spec.ts';
const BOTTOM_INSET_HOOK = 'src/hooks/useSafeBottomInset.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (A) REGISTRO de los `hitSlop` que NO son un escalar chico y uniforme.
//
// Entrar acá no es un permiso: es una OBLIGACIÓN de haber medido. Cada entrada dice contra qué vecino se
// verificó y dónde vive esa verificación. Si agregás uno, agregá también el test que lo cruza con lo que
// tiene alrededor — si no, estás repitiendo exactamente el bug del 2026-08-05.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CHECKED_SLOPS: Record<
  string,
  { crece: string; vecino: string; verificadoEn: string; declarados: number; lados: string[] }
> = {
  [FAB_OWNER]: {
    crece: 'solo hacia ABAJO (`bottom`), derivado de $navBar/$navItemTop/$fab/$fabRaise',
    vecino:
      'hacia abajo solo está su propio label "Maniobra", dentro de la misma celda; el `top` se SACÓ el ' +
      '2026-08-06 porque invadía la banda del pill del bastón (bug 🔴)',
    verificadoEn:
      `${PURE_TEST} (bandas aritméticas desde los tokens) + ${E2E_GUARD} (cajas reales: hit-test ` +
      'muestreado de la franja que el slop agrega FUERA de la pintura del FAB)',
    // CUÁNTOS `hitSlop=` tiene el archivo. La exención del registro es POR ARCHIVO, así que sin este
    // número un `hitSlop` NUEVO acá adentro entraría gratis, escondido detrás del que sí se verificó.
    declarados: 1,
    // Los ÚNICOS lados que el target puede crecer. El invariante de (A-fix): que el target del FAB no
    // exceda su círculo pintado salvo hacia abajo, donde el único vecino es su propio label.
    lados: ['bottom'],
  },
};

/**
 * Escalar máximo que un `hitSlop` uniforme puede valer sin pasar por el registro. Hoy el árbol usa 8 y 12
 * (chevrons de "Volver", X de cierre de sheets, íconos de fila). Crece PAREJO en los 4 lados sobre un
 * control que está EN FLUJO —o sea, con separación de layout respecto de sus vecinos—, que es justo lo que
 * el FAB no tenía: el FAB se dibuja fuera de su celda y su vecino de arriba flota a 10 dp.
 */
const MAX_UNCHECKED_SCALAR_SLOP = 12;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (B) REGISTRO de las superficies ANCLADAS EN LA BANDA del borde inferior (por encima del nav).
//
// "Anclada en la banda" = su `bottom` se calcula SUMANDO algo a la reserva inferior, o lee los tokens de
// geometría del nav. Da igual con qué tokens llegue: lo que importa es dónde termina.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
const BOTTOM_BAND_SURFACES: Record<string, string> = {
  [FAB_OWNER]: 'es el dueño del nav y del FAB: define la banda, no se ancla a ella',
  [BOTTOM_INSET_HOOK]:
    'define la reserva inferior compartida (`$navBottomMin` es su piso): no se ancla en la banda, la ' +
    'establece. Como el FAB_OWNER, entra al registro por ser dueño de la geometría, no vecino de ella',
};

/**
 * **CUÁNTOS INQUILINOS REALES TIENE LA BANDA HOY. HOY: CERO — Y ESTÁ DECLARADO A PROPÓSITO.**
 *
 * El pill del bastón, el único que hubo, **se mudó arriba a la derecha el 2026-08-06** (ver la cabecera de
 * `StickStatusIndicator.tsx`). Un guard que se queda sin población y sigue en verde es un **falso verde**
 * —justamente la clase que este archivo vino a cerrar—, así que la cuenta no puede quedar implícita:
 *   · si aparece un inquilino nuevo y NO se registra → (B1) rojo;
 *   · si se registra pero nadie actualiza este número → (B-banda) rojo;
 *   · y con población CERO, (B-banda) igual ejercita el resolvedor contra un inquilino SINTÉTICO, así que
 *     "no encontré a nadie" y "el resolvedor se rompió" dejan de verse igual.
 * El invariante *nada anclado al borde inferior invade la banda del FAB* no depende de que haya alguien:
 * describe qué le va a pasar al próximo.
 */
const BOTTOM_BAND_TENANTS_EXPECTED = 0;

// ─── Firmas ──────────────────────────────────────────────────────────────────────────────────────────
const HIT_SLOP_ANY = /\bhitSlop\b/;
/**
 * Tokens de GEOMETRÍA del borde inferior: leerlos es declararse vecino de la barra o del FAB.
 *
 * Están los CUATRO que definen la geometría, no sólo los dos con los que se escribió el bug: `$fab` (el
 * diámetro) y `$navItemTop` (el padding que baja el círculo) llegan a la misma banda por otro camino, y
 * `$navBottomMin` es el piso de la reserva. La firma es la BANDA, no la grafía de ayer.
 */
const NAV_GEOMETRY_TOKEN = /\$(?:fab|fabRaise|navBar|navItemTop|navBottomMin)\b/;

/** Válvula de escape por línea, con justificación (mismo patrón que los otros guards del repo). */
const DISABLE_NEXT_LINE = /tap-target-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /tap-target-disable-line\s*--\s*\S/;

function listFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      found.push(...listFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      // Los `.test.*` quedan fuera: este archivo lleva las firmas en sus regexes y en sus casos
      // sintéticos, así que se auto-reportaría.
      found.push(p);
    }
  }
  return found;
}

const rel = (file: string) => relative(APP_ROOT, file).split(sep).join('/');

interface Hit {
  file: string;
  line: number;
  text: string;
}

/**
 * Recorre el árbol aplicando `predicate` sobre el código SIN comentarios (una mención no es un uso).
 * El tercer argumento es el fuente ENTERO del archivo: hay firmas que sólo se pueden decidir con él
 * (p. ej. con qué nombre local guarda ESTE archivo la reserva inferior).
 */
function scan(predicate: (line: string, file: string, src: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const source = readFileSync(file, 'utf8');
      const rawLines = source.split(/\r?\n/);
      const stripped = stripSourceComments(source);
      const lines = stripped.split(/\r?\n/);
      const label = rel(file);
      lines.forEach((line, i) => {
        if (!predicate(line, label, stripped)) return;
        const here = rawLines[i] ?? '';
        const previous = rawLines[i - 1] ?? '';
        if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) return;
        hits.push({ file: label, line: i + 1, text: line.trim() });
      });
    }
  }
  return hits;
}

const show = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`);

/** Código (sin comentarios) de un archivo relativo a `app/`. */
function code(relPath: string): string {
  return stripSourceComments(readFileSync(join(APP_ROOT, relPath), 'utf8'));
}

/** Código CRUDO (con comentarios) — lo que reciben los resolvedores, que blanquean por su cuenta. */
function raw(relPath: string): string {
  return readFileSync(join(APP_ROOT, relPath), 'utf8');
}

// ─── Lectura REAL de los tokens ──────────────────────────────────────────────────────────────────────
//
// `sizeTokenFromConfig`, `braceBody`, `jsxPropExpressions`, `evaluateDp` y `resolveFabHitSlop` viven en
// `nav-target-bands.ts` y NO se duplican acá a propósito: el E2E geométrico usa exactamente las mismas
// funciones. Dos traducciones distintas del mismo fuente es cómo un oráculo termina midiendo un espejo.

/** Valor de un token del grupo `space` (viene del default de tamagui, no de nuestro config). */
function spaceToken(name: string): number {
  const value = (tamaguiDefaultTokens.space as unknown as Record<string, number>)[name];
  assert.ok(
    typeof value === 'number' && Number.isFinite(value),
    `el token de space \`${name}\` no resuelve en @tamagui/themes/v4`,
  );
  return value;
}

/** Declaración `const NOMBRE = <número>;` en un test/spec que COPIA un token. */
function declaredNumber(src: string, name: string, file: string): number {
  const decl = new RegExp(`const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`).exec(src);
  assert.ok(decl, `${file} tiene que declarar \`const ${name} = <número>;\``);
  return Number(decl[1]);
}

// ─── Extracción de EXPRESIONES de props (`prop={…}`), aunque crucen líneas ───────────────────────────
//
// Escanear por LÍNEA no alcanza para esto: el `bottom={…}` del pill ocupa 6 líneas y el override que burló
// la versión anterior del guard (`hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}`) es una expresión, no una
// firma textual. Se extrae el `{…}` BALANCEADO y se analiza entero.

/** La extracción balanceada vive en `nav-target-bands.ts` (la comparte con el E2E). */
const propExpressions = jsxPropExpressions;
type PropExpr = ReturnType<typeof jsxPropExpressions>[number];

/** ¿La expresión es un literal numérico pelado? */
const NUMERIC_LITERAL = /^\d+(?:\.\d+)?$/;
/** ¿La expresión es un identificador pelado (`HIT_SLOP`)? Sin spreads, llamadas, ternarios ni miembros. */
const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Los nombres con los que ESTE archivo tiene la reserva inferior en la mano.
 *
 * ── EL MUTANTE QUE ESTO CIERRA (medido el 2026-08-06: 35/35 PASS con el overlay puesto) ─────────────
 *     const { bottom: pad } = useSafeAreaInsets();
 *     <View position="absolute" bottom={pad + 86} />      // 86 = navBar(60) + fabRaise(26) = el pico
 * La firma vieja era una lista de CUATRO nombres fijos (`safeBottom`, `bottomInset`, `insets.bottom`,
 * `useSafeBottomInset()`), o sea vigilaba el VOCABULARIO y no el destino: renombrar la variable al
 * destructurar alcanzaba para anclarse en la banda del FAB sin que nada se pusiera rojo. Acá el
 * vocabulario se DERIVA por archivo: si el nombre sale de una fuente de reserva inferior, cuenta, se
 * llame como se llame.
 */
function bottomReserveNames(src: string): string[] {
  // Base: los nombres convencionales del repo. Se conservan aunque el archivo no declare la variable
  // (una pantalla puede recibir la reserva por prop y llamarla igual).
  const names = new Set<string>(['safeBottom', 'bottomInset', 'insets.bottom']);
  const add = (n: string | undefined) => {
    if (n) names.add(n);
  };
  // `const X = useSafeBottomInset();` · `const X = useSafeAreaInsets().bottom;`
  for (const [, name] of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSafeBottomInset\s*\(\)/g)) add(name);
  for (const [, name] of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSafeAreaInsets\s*\(\)\s*\.bottom/g)) {
    add(name);
  }
  // `const insets = useSafeAreaInsets();` → `insets.bottom`
  for (const [, name] of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSafeAreaInsets\s*\(\)\s*;/g)) {
    add(`${name}.bottom`);
  }
  // `const { bottom } = …` y `const { bottom: pad } = …` sobre cualquiera de los dos hooks.
  for (const [, alias] of src.matchAll(
    /\bconst\s*\{[^}]*\bbottom\b\s*(?::\s*([A-Za-z_$][\w$]*))?[^}]*\}\s*=\s*useSafe(?:AreaInsets|BottomInset)\s*\(\)/g,
  )) {
    add(alias ?? 'bottom');
  }
  return [...names];
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
/** La firma de reserva de ESTE archivo: los alias detectados + las llamadas directas. */
function bottomReserveRegex(src: string): RegExp {
  const alternatives = [
    ...bottomReserveNames(src).map((n) => `${/^[\w$]/.test(n) ? '\\b' : ''}${n.replace(ESCAPE_RE, '\\$&')}\\b`),
    'useSafeBottomInset\\s*\\(\\)',
    'useSafeAreaInsets\\s*\\(\\)\\s*\\.bottom',
  ];
  return new RegExp(`(?:${alternatives.join('|')})`);
}

/**
 * ¿El VALOR de esta expresión sale de la reserva inferior? Resuelve UN nivel de const local
 * (`const anchor = safeBottom + X; … bottom={anchor}`), porque lavar la reserva en una variable era la
 * forma obvia de esquivar la firma directa.
 *
 * ⚠️ Acá NO se decide si el elemento invade la banda: eso se RESUELVE después, calculando la coordenada.
 * Esto es sólo el filtro barato de "esta expresión habla del borde inferior de la pantalla". La versión
 * anterior mezclaba las dos cosas en un `expr.includes('+')` y por eso `Math.max(insets.bottom, 86)`
 * —mismo destino, sin un solo `+`— pasaba en verde.
 */
function mentionsBottomReserve(src: string, expr: string): boolean {
  const reserve = bottomReserveRegex(src);
  if (reserve.test(expr)) return true;
  if (!BARE_IDENTIFIER.test(expr)) return false;
  const decl = new RegExp(`\\bconst\\s+${expr}\\s*(?::[^=]+)?=\\s*([^;]+);`).exec(src);
  return decl !== null && reserve.test(decl[1].replace(/\s+/g, ' '));
}

/**
 * Props cuyo valor puede depender de la reserva inferior **sin colocar nada**: el padding RESERVA
 * espacio, empuja el contenido hacia adentro, y no puede poner un elemento en la banda del FAB. Es la
 * ÚNICA lista blanca del mecanismo, y está escrita al revés a propósito: lo que no está acá nace en
 * ROJO. Enumerar las props PELIGROSAS (`marginBottom`, `translateY`, …) es lo que hizo que este guard se
 * dejara burlar tres veces — la lista siguiente siempre tiene un nombre más.
 */
const SPACE_RESERVING_PROP = /^padding([A-Z]|$)/;

/** Prop que COLOCA el borde de abajo de un elemento en una coordenada. La única que el guard sabe medir. */
const BOTTOM_ANCHOR_PROP = /^bottom$/;

/**
 * HAND-OFFS: props que sólo **pasan** la reserva a un hijo (`bottomPad={bottomPad}`), sin aritmética.
 *
 * Pasar el valor no coloca nada: coloca el que lo recibe, en otro archivo, donde la reserva ya viaja con
 * nombre de prop y el guard no la reconoce (es el límite de "cruzar el borde de un módulo", declarado en
 * la cabecera). Como no lo puedo seguir, lo hago **explícito**: cada hand-off se registra diciendo qué
 * hace el receptor, y uno NUEVO nace en rojo. Vale la pena la diferencia entre "no lo veo" y "no lo veo
 * y nadie se enteró".
 */
const RESERVE_HANDOFFS: Record<string, string> = {
  bottomPad:
    'lo reciben `app/maniobra/_components/CircunferenciaEscrotalStep.tsx` (y su hijo, con el mismo ' +
    'nombre) y lo usan como `paddingBottom`: reserva espacio, no coloca. Verificado el 2026-08-06.',
};

/** Cada aparición de `<prop>={…}` o `<clave>: …` del archivo, con su expresión. */
interface PropUse {
  prop: string;
  expr: string;
  line: number;
}

/**
 * TODAS las props del archivo, en las dos grafías. La forma JSX se extrae balanceada (puede cruzar
 * líneas); las claves de objeto de estilo (`bottom: x`, `translateY: x`) se leen por línea, y si el valor
 * cruza líneas el resolvedor no va a poder con él y el guard se pondrá rojo — que es el lado seguro.
 */
function propUsesOfFile(src: string, rawLines: string[] = []): PropUse[] {
  const uses: PropUse[] = allJsxProps(src)
    // Una prop que CONTIENE un objeto/array (`style={{…}}`, `contentContainerStyle={{…}}`,
    // `transform={[{…}]}`) no coloca nada por sí misma: lo que coloca es alguna de sus claves, y esas se
    // escanean una por una abajo. Sin esto, un `contentContainerStyle` con un `paddingBottom` adentro se
    // reportaría como "mecanismo desconocido" — falso positivo, y un guard con falsos positivos se apaga.
    .filter((u) => !u.expr.startsWith('{') && !u.expr.startsWith('['))
    .map((u) => ({ prop: u.prop, expr: u.expr, line: u.line }));
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\b([A-Za-z][\w]*):\s*([^,;\n]+)/g)) {
      uses.push({ prop: m[1], expr: m[2].trim(), line: i + 1 });
    }
  });
  // La válvula de escape, con razón escrita, vale para las dos grafías.
  return uses.filter((u) => {
    const here = rawLines[u.line - 1] ?? '';
    const previous = rawLines[u.line - 2] ?? '';
    return !DISABLE_LINE.test(here) && !DISABLE_NEXT_LINE.test(previous);
  });
}

/** El árbol escaneado, archivo por archivo, con el fuente sin comentarios y las líneas crudas. */
function scannedSources(): Array<{ file: string; src: string; rawLines: string[] }> {
  const out: Array<{ file: string; src: string; rawLines: string[] }> = [];
  for (const root of ROOTS) {
    for (const path of listFiles(root)) {
      const source = readFileSync(path, 'utf8');
      out.push({ file: rel(path), src: stripSourceComments(source), rawLines: source.split(/\r?\n/) });
    }
  }
  return out;
}

/** Recorre el árbol devolviendo `(archivo, expresión)` de cada `<prop>={…}`, sin comentarios. */
function scanPropExpressions(prop: string): Array<{ file: string; src: string } & PropExpr> {
  const out: Array<{ file: string; src: string } & PropExpr> = [];
  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split(/\r?\n/);
      const src = stripSourceComments(raw);
      const label = rel(file);
      for (const found of propExpressions(src, prop)) {
        const here = rawLines[found.line - 1] ?? '';
        const previous = rawLines[found.line - 2] ?? '';
        if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) continue;
        out.push({ file: label, src, ...found });
      }
    }
  }
  return out;
}

// ═══ (A) Inventario de `hitSlop` ═════════════════════════════════════════════════════════════════════

test('(A) el VALOR de todo `hitSlop` se puede leer de UN solo lugar (nada de spreads ni inline)', () => {
  // ── EL MUTANTE QUE ESTE TEST CIERRA (reviewer, 2026-08-06) ────────────────────────────────────────
  //     hitSlop={HIT_SLOP}  →  hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}   →  antes: 30/30 PASS.
  // La versión anterior eximía el ARCHIVO y sólo miraba el cuerpo del `const`, así que un override en el
  // sitio de uso reabría el bug 🔴 entero sin poner nada en rojo. El invariante no es "no escribas
  // `top:`": es que el valor del target sea LEGIBLE ESTÁTICAMENTE DE UN SOLO LUGAR — si no, nadie puede
  // verificar contra qué choca, que es todo el punto de esta unidad.
  const offenders: string[] = [];
  for (const use of scanPropExpressions('hitSlop')) {
    const { expr, file, line, src } = use;
    if (NUMERIC_LITERAL.test(expr)) {
      if (Number(expr) > MAX_UNCHECKED_SCALAR_SLOP) {
        offenders.push(`${file}:${line}  hitSlop={${expr}} — escalar > ${MAX_UNCHECKED_SCALAR_SLOP}`);
      }
      continue;
    }
    if (!BARE_IDENTIFIER.test(expr)) {
      offenders.push(`${file}:${line}  hitSlop={${expr}} — no es ni un número ni un identificador pelado`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(CHECKED_SLOPS, file)) {
      offenders.push(`${file}:${line}  hitSlop={${expr}} — identificador sin entrada en CHECKED_SLOPS`);
      continue;
    }
    if (!new RegExp(`\\bconst\\s+${expr}\\s*(?::[^=]+)?=\\s*\\{`).test(src)) {
      offenders.push(`${file}:${line}  hitSlop={${expr}} — \`const ${expr} = { … }\` no está en este archivo`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'El VALOR de un `hitSlop` tiene que poder leerse de un solo lugar: o es un literal numérico ≤' +
      MAX_UNCHECKED_SCALAR_SLOP +
      ' (la convención uniforme de la app, ~38 sitios), o es un identificador PELADO cuyo objeto se ' +
      'declara en el mismo archivo y ese archivo está en `CHECKED_SLOPS` con el análisis de sus vecinos. ' +
      'Un spread, un ternario, una llamada o un objeto inline hacen el target ilegible para cualquier ' +
      'verificación estática — y en web no hay verificación dinámica posible: `hitSlop` es no-op en RNW. ' +
      '⚠️ Ojo con el reflejo de "le pongo hitSlop para que sea más fácil de tocar": si el target tiene que ' +
      'ser más grande, casi siempre lo correcto es que la PINTURA sea más grande (`minHeight`), porque así ' +
      'el target es lo que se ve.',
  );
});

test('(A-inverso) el REGISTRO no tiene entradas MUERTAS ni tapa hitSlops NUEVOS del mismo archivo', () => {
  for (const [file, entry] of Object.entries(CHECKED_SLOPS)) {
    const uses = scanPropExpressions('hitSlop').filter((u) => u.file === file);
    assert.ok(
      uses.length > 0,
      `\`${file}\` está en CHECKED_SLOPS pero ya no declara ningún hitSlop. Sacalo del registro: si el ` +
        'archivo se renombra y la entrada queda, el guard deja de mirar un archivo que sí existe con otro ' +
        'nombre y nadie se entera.',
    );
    assert.equal(
      uses.length,
      entry.declarados,
      `\`${file}\` usa ${uses.length} hitSlop y el registro dice ${entry.declarados}. La exención es POR ` +
        'ARCHIVO: un hitSlop NUEVO acá adentro se colaría escondido detrás del que sí se verificó. Verificá ' +
        `el nuevo contra sus vecinos, sumalo a la entrada y actualizá \`declarados\`.\n` +
        uses.map((u) => `${u.file}:${u.line}  hitSlop={${u.expr}}`).join('\n'),
    );
  }
});

/** El `hitSlop` REAL del FAB, resuelto del JSX de producción con los tokens reales. */
function realFabHitSlop(): { top: number; right: number; bottom: number; left: number } {
  return insetsWithDefaults(
    resolveFabHitSlop(raw(FAB_OWNER), code(TAMAGUI_CONFIG), { spaceToken: (n) => spaceToken(`$${n}`) }).sides,
  );
}

test('(A-fix) el TARGET del FAB no excede su círculo pintado salvo hacia ABAJO', () => {
  // ── EL MUTANTE QUE ESTE TEST CIERRA (medido el 2026-08-06: 35/35 PASS con el bug 🔴 puesto) ────────
  //     const HIT_SLOP = { bottom: Math.max(…), top: FAB_RAISE };     ← todo en UNA línea
  // La versión anterior contaba CLAVES partiendo el objeto por `\n`, así que se quedaba con la primera de
  // cada línea y el `top` desaparecía. Lo mismo con `{ bottom: X, ...EXTRA }` y con `['top']: X`.
  //
  // Ahora no se cuentan claves: se RESUELVE el valor (siguiendo el JSX, el spread, la const y los tokens)
  // y se compara contra el número que el modelo espera. Da igual la gramática: lo que se mide es cuánto
  // crece el target y hacia dónde.
  const configCode = code(TAMAGUI_CONFIG);
  const slop = realFabHitSlop();
  const geometry = navGeometryFromConfig(configCode);

  assert.deepEqual(
    { top: slop.top, left: slop.left, right: slop.right },
    { top: 0, left: 0, right: 0 },
    'El target del FAB solo puede crecer hacia ABAJO, dentro de su propia celda (ahí el único vecino es su ' +
      'label "Maniobra"). Hacia ARRIBA está la banda del chrome: con `top: $fabRaise` el target se comía el ' +
      '48 % inferior del pill del bastón y un toque ahí abría MODO MANIOBRAS — medido en device el ' +
      '2026-08-05 (techo táctil y=1276 vs. círculo pintado y=1324) y en web. Hacia los COSTADOS, a 360px la ' +
      'celda deja 4px por lado que el anillo del halo ya ocupa enteros: cualquier slop lateral le roba ' +
      'toques a Animales/Reportes. Y NO hay zona muerta que compensar: el mismo barrido probó que el target ' +
      'dispara 86 px por encima del techo de la barra, o sea que el tabBar NO recorta los toques.',
  );
  // El `bottom` no es libre: es EXACTAMENTE lo que queda de la celda debajo del círculo. Más que eso
  // invade la reserva del sistema; menos, deja muerto el label "Maniobra".
  assert.equal(
    slop.bottom,
    Math.max(0, geometry.navBar - geometry.navItemTop - (geometry.fab - geometry.fabRaise)),
    'el `bottom` del hitSlop tiene que salir de los tokens del nav, no de un número elegido a mano',
  );
  // Y los lados que el registro declara son los que el valor resuelto realmente tiene.
  assert.deepEqual(
    Object.keys(resolveFabHitSlop(raw(FAB_OWNER), configCode, { spaceToken: (n) => spaceToken(`$${n}`) }).sides).sort(),
    [...CHECKED_SLOPS[FAB_OWNER].lados].sort(),
    'el registro dice que el FAB crece por unos lados y el valor resuelto dice otra cosa',
  );
});

test('(A-fix bis) el resolvedor del slop es FAIL-CLOSED: una gramática que no puede leer TIRA', () => {
  // Sin esto, (A-fix) podría estar pasando porque el resolvedor devuelve `{}` ante lo que no entiende —
  // que es exactamente el modo de falla del extractor anterior. Se le dan las formas del mutante sobre un
  // fuente sintético y se exige que las lea (las dos primeras) o que se niegue (la tercera).
  const configCode = code(TAMAGUI_CONFIG);
  const layout = code(FAB_OWNER);
  const conOverride = layout.replace('hitSlop={HIT_SLOP}', 'hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}');
  assert.notEqual(conOverride, layout, 'el fuente del FAB cambió de forma: revisá este test');
  const resolved = resolveFabHitSlop(conOverride, configCode, { spaceToken: (n) => spaceToken(`$${n}`) }).sides;
  assert.equal(resolved.top, sizeTokenFromConfig(configCode, 'fabRaise'), 'el override tiene que resolver a 26');
  assert.throws(
    () => resolveFabHitSlop(layout.replace('hitSlop={HIT_SLOP}', 'hitSlop={withTop(HIT_SLOP, 26)}'), configCode),
    TargetResolutionError,
    'un helper que devuelve el slop tiene que poner el guard en rojo, no pasar de largo',
  );
});

// ═══ (B) Inventario de la BANDA del borde inferior ═══════════════════════════════════════════════════

test('(B1) nadie ancla nada POR ENCIMA de la reserva inferior sin estar en el registro', () => {
  // ── EL MUTANTE QUE ESTE TEST CIERRA (reviewer, 2026-08-06) ────────────────────────────────────────
  // Un overlay nuevo con `bottom={safeBottom + $navBar + $6}` (= 92 dp: adentro de la banda, con el pico
  // del FAB en 84 y el borde de abajo del pill en 104) pasaba 30/30, porque la versión anterior vigilaba
  // el TOKEN `$fabRaise` y no la BANDA. Nadie ancla un toast al pico del FAB nombrando `$fabRaise`: lo
  // ancla al nav. La firma tiene que ser el DESTINO, no el camino.
  //
  // ⚠️ Esto es el trámite de REGISTRO. Que además la banda CIERRE con números lo verifica (B-banda):
  // registrarse dejó de ser una forma de pasar.
  const offenders: string[] = [];
  for (const { file, src, rawLines } of scannedSources()) {
    if (Object.prototype.hasOwnProperty.call(BOTTOM_BAND_SURFACES, file)) continue;
    for (const use of propUsesOfFile(src, rawLines)) {
      if (!BOTTOM_ANCHOR_PROP.test(use.prop)) continue;
      if (!mentionsBottomReserve(src, use.expr)) continue;
      offenders.push(`${file}:${use.line}  ${use.prop}={${use.expr.slice(0, 90)}}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Un `bottom` cuyo valor sale de la reserva inferior ancla el elemento en la banda que está por encima ' +
      'del bottom-nav — la misma donde flota el pill del bastón y por donde asoma el pico del FAB de ' +
      'Maniobra, que es el target más grande e importante del chrome. Ojo: la firma ya NO es "suma sobre la ' +
      'reserva" (eso dejaba pasar `Math.max(insets.bottom, 86)`, mismo destino sin un solo `+`): es MENCIONAR ' +
      'la reserva, y la coordenada se calcula después. Antes de agregar un toast/banner/snackbar ahí: ' +
      'registrá la superficie en `BOTTOM_BAND_SURFACES` — (B-banda) va a calcular su coordenada y exigir que ' +
      'despeje el FAB. Y si además va a ser TOCABLE, leé antes el bloque ⛔ de `StickStatusIndicator.tsx`: ' +
      'ya se intentó y se revirtió con evidencia.',
  );
});

test('(B1-bis) si el valor sale de la reserva, la prop tiene que ser una que el guard sepa medir', () => {
  // ── EL 🔴 DEL RE-REVIEW (2026-08-06): (B1) miraba SÓLO la prop `bottom` ────────────────────────────
  // Seis overlays interactivos anclados al pico del FAB pasaban 47/47 porque se colocaban con otra prop:
  // `marginBottom`, `transform: translateY`, `top`, `inset`… El reflejo equivocado es agregar esos
  // nombres a una lista; la lista siguiente siempre tiene uno más (`insetBlockEnd`, un
  // `useAnimatedStyle`…). Acá la lista está al REVÉS: se enumeran las props que RESERVAN espacio y por lo
  // tanto no pueden colocar nada (la familia `padding`), y **todo lo demás que dependa de la reserva nace
  // en rojo**. Para colocar contra el borde inferior hay exactamente una prop que el guard sabe convertir
  // en coordenada —`bottom`— y por ahí pasa la verificación de banda.
  //
  // Medido antes de escribir la regla: en TODO el árbol hay 23 props reserva-dependientes de la familia
  // `padding`, 1 `bottom` (el pill) y 2 claves internas del hook de la reserva. El costo de la regla es
  // cero y su cobertura es el mecanismo entero.
  const offenders: string[] = [];
  for (const { file, src, rawLines } of scannedSources()) {
    if (Object.prototype.hasOwnProperty.call(BOTTOM_BAND_SURFACES, file)) continue;
    for (const use of propUsesOfFile(src, rawLines)) {
      if (BOTTOM_ANCHOR_PROP.test(use.prop) || SPACE_RESERVING_PROP.test(use.prop)) continue;
      if (!mentionsBottomReserve(src, use.expr)) continue;
      // Hand-off puro (`bottomPad={bottomPad}`): la reserva viaja tal cual, sin aritmética. No coloca
      // nada acá — pero tiene que estar declarado, porque del otro lado el guard ya no la ve.
      const isPureHandoff = BARE_IDENTIFIER.test(use.expr) && bottomReserveNames(src).includes(use.expr);
      if (isPureHandoff && Object.prototype.hasOwnProperty.call(RESERVE_HANDOFFS, use.prop)) continue;
      offenders.push(
        `${file}:${use.line}  ${use.prop}: ${use.expr.slice(0, 70)}${isPureHandoff ? '  — hand-off sin registrar' : ''}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Esta prop mueve o dimensiona algo con la reserva inferior y NO es `bottom` (la única que el guard sabe ' +
      'convertir en una coordenada) ni de la familia `padding` (que reserva espacio y no coloca). O sea: el ' +
      'guard no puede calcular dónde termina este elemento, y ahí abajo está el target más importante de la ' +
      'app. Un `marginBottom`, un `translateY`, un `top` o un `inset` derivados de la reserva colocan igual ' +
      'de fuerte que un `bottom`. Si lo necesitás: anclá con `bottom` (y registrate), o enseñale al guard a ' +
      'calcular tu mecanismo. Lo que NO vale es que el guard no sepa y pase igual.',
  );
});

test('(B-banda) el anclaje REAL de cada superficie registrada DESPEJA la banda del target REAL del FAB', () => {
  // ── POR QUÉ ESTE TEST EXISTE (el agujero que quedaba en (B)) ───────────────────────────────────────
  // (B1) y (B2) son un trámite de REGISTRO: exigen que quien se ancle ahí se anote. Lo que el registro
  // guardaba era PROSA ("se ancla `$fabRaise + $4` → 20 dp de aire") y nadie comprobaba que el anclaje
  // real produjera esa banda. O sea: registrarse alcanzaba. Un overlay registrado anclado al PICO del FAB
  // pasaba, y el pill podía derivar de vuelta hacia el círculo sin que la aritmética lo viera.
  //
  // Acá se cierra con números y sobre el fuente real: se resuelve el anclaje de cada superficie
  // registrada (sus tokens, su aritmética, su alias de la reserva) y se exige que despeje el techo del
  // target del FAB —calculado con el hitSlop REAL, no con el que suponemos— por ≥ el piso de la app.
  //
  // Y se calcula **para las cuatro reservas reales**, no para una. Suponer que "el inset se cancela" vale
  // sólo si el anclaje es lineal en la reserva; `Math.max(insets.bottom, 86)` no lo es, y ahí la
  // separación depende de la plataforma (en Android 3 botones el elemento se queda quieto mientras el FAB
  // sube 52 dp). El invariante tiene que valer en las cuatro.
  const configCode = code(TAMAGUI_CONFIG);
  const geometry = navGeometryFromConfig(configCode);
  const slop = realFabHitSlop();
  const fabTopAt = (safeBottomInset: number) =>
    fabTargetBand({
      safeBottomInset,
      ...geometry,
      fabHitSlopTop: slop.top,
      fabHitSlopBottom: slop.bottom,
      tenantGap: 0,
      tenantHeight: 0,
    }).top;

  let checked = 0;
  for (const file of Object.keys(BOTTOM_BAND_SURFACES)) {
    if (file === FAB_OWNER) continue; // es el dueño de la banda: la define, no se ancla a ella
    const src = code(file);
    const mkEnv = (reserve: number): ResolveEnv => ({
      src,
      token: (name, group) => (group === 'size' ? sizeTokenFromConfig(configCode, name) : spaceToken(`$${name}`)),
      // Todos los nombres con los que ESTE archivo tiene la reserva, con el valor de la plataforma.
      scope: Object.fromEntries(bottomReserveNames(src).map((n) => [n, reserve])),
    });
    // Sin `rawLines`: en una superficie REGISTRADA la válvula `tap-target-disable-*` no aplica. Estar en
    // el registro es la obligación de estar medido; silenciar la medición sería el permiso perfecto.
    for (const use of propUsesOfFile(src)) {
      if (!BOTTOM_ANCHOR_PROP.test(use.prop)) continue;
      if (!mentionsBottomReserve(src, use.expr)) continue;
      // Si no se puede resolver, `resolveByReserve` TIRA y el test se pone rojo: una superficie
      // registrada cuya coordenada el guard no puede calcular es una superficie sin verificar.
      const { values } = resolveByReserve(use.expr, mkEnv);
      checked++;
      REAL_BOTTOM_RESERVES.forEach((reserve, i) => {
        const anchor = values[i];
        const fabTop = fabTopAt(reserve);
        assert.ok(
          anchor - fabTop >= MIN_TAP_TARGET_SEPARATION,
          `${file}:${use.line} — con reserva inferior ${reserve} dp el borde de abajo queda en ${anchor} dp y ` +
            `el techo del target del FAB en ${fabTop} dp: ${anchor - fabTop} dp de aire, menos que el piso de ` +
            `${MIN_TAP_TARGET_SEPARATION} dp. Da igual con qué tokens, aritmética o grafía se llegue: lo que ` +
            'importa es dónde termina. Si el diseño cambió a propósito, cambiá también el número as-built de ' +
            '`nav-target-bands.test.ts` y decí por qué.',
        );
      });
    }
  }
  // ── LA POBLACIÓN, CONTRA EL NÚMERO DECLARADO ──────────────────────────────────────────────────────
  // Antes acá decía `checked > 0` ("si no medí nada, algo se rompió"). Con el pill mudado arriba eso
  // dejaba dos salidas malas: borrar el test (y con él la vigilancia del mecanismo) o relajarlo (y no
  // enterarse nunca de que dejó de medir). La forma correcta es DECLARAR la cuenta: cero es una respuesta
  // válida, pero tiene que estar escrita.
  assert.equal(
    checked,
    BOTTOM_BAND_TENANTS_EXPECTED,
    `la banda inferior tiene ${checked} inquilino(s) verificado(s) y el registro declara ` +
      `${BOTTOM_BAND_TENANTS_EXPECTED}. Si agregaste una superficie anclada abajo: verificá su separación, ` +
      'registrala y actualizá el número. Si la sacaste: bajá el número en el mismo commit. Lo que NO vale ' +
      'es que el guard mida una cantidad distinta de la que alguien declaró — así es como un test se queda ' +
      'verde mirando a nadie.',
  );

  // ── Y CON POBLACIÓN CERO, EL MEDIDOR SE EJERCITA IGUAL (contra un inquilino SINTÉTICO) ─────────────
  // Sin esto, el día que la población quedó vacía el test pasó a no ejecutar una sola línea del
  // resolvedor: "no hay inquilinos" y "el resolvedor está roto" se verían igual (verde). Acá se le da el
  // anclaje que tenía el pill (el único que existió) y se exige que (a) el que despeja, despeje, y (b) el
  // que se mete en la banda del FAB, se detecte. Es la falsificación in-place del medidor.
  const syntheticEnv = (reserve: number): ResolveEnv => ({
    src: '',
    token: (name, group) => (group === 'size' ? sizeTokenFromConfig(configCode, name) : spaceToken(`$${name}`)),
    scope: { safeBottom: reserve },
  });
  const despeja = "safeBottom + getTokenValue('$navBar','size') + getTokenValue('$fabRaise','size') + getTokenValue('$4','space')";
  const invade = "safeBottom + getTokenValue('$navBar','size') + getTokenValue('$fabRaise','size')"; // el PICO del FAB
  REAL_BOTTOM_RESERVES.forEach((reserve, i) => {
    const fabTop = fabTopAt(reserve);
    assert.ok(
      resolveByReserve(despeja, syntheticEnv).values[i] - fabTop >= MIN_TAP_TARGET_SEPARATION,
      'el medidor dejó de reconocer como VÁLIDO el anclaje que sí despejaba el FAB',
    );
    assert.ok(
      resolveByReserve(invade, syntheticEnv).values[i] - fabTop < MIN_TAP_TARGET_SEPARATION,
      'el medidor dejó de detectar una superficie anclada JUSTO en el pico del FAB: con la población ' +
        'vacía, este contrafáctico es lo ÚNICO que prueba que (B-banda) sigue sabiendo medir',
    );
  });
});

test('(A-bis) `hitSlop` solo aparece como PROP — nunca en otra posición sintáctica', () => {
  // Un `<Pressable {...{ hitSlop: { top: 26 } }} />` o un `hitSlop` metido dentro de un objeto de props
  // no matchea `hitSlop={…}`, así que (A) no lo vería y el guard entero sería esquivable escribiendo el
  // slop de cualquier otra forma. Acá se exige la correspondencia 1:1 entre las MENCIONES del
  // identificador y las props extraídas: si aparece en otro lado, el guard se pone rojo aunque no sepa
  // interpretarlo — que es la respuesta correcta ante algo que no puede verificar.
  const mentions = scan((line) => HIT_SLOP_ANY.test(line));
  const props = scanPropExpressions('hitSlop');
  const mentionsPerFile = new Map<string, number>();
  for (const m of mentions) mentionsPerFile.set(m.file, (mentionsPerFile.get(m.file) ?? 0) + 1);
  const propsPerFile = new Map<string, number>();
  for (const p of props) propsPerFile.set(p.file, (propsPerFile.get(p.file) ?? 0) + 1);
  const mismatched: string[] = [];
  for (const [file, count] of mentionsPerFile) {
    // Una línea puede llevar más de un `hitSlop=`; se compara por archivo y se exige ≥, no =.
    if ((propsPerFile.get(file) ?? 0) < count) {
      mismatched.push(`${file}: ${count} mención(es) de \`hitSlop\`, ${propsPerFile.get(file) ?? 0} como prop`);
    }
  }
  assert.deepEqual(
    mismatched,
    [],
    '`hitSlop` tiene que aparecer SIEMPRE como prop JSX (`hitSlop={…}`). En cualquier otra posición ' +
      '—dentro de un objeto de props, un spread, un helper que lo devuelve— el valor del target deja de ' +
      'ser legible estáticamente y (A) no lo puede clasificar. Si necesitás esa forma, primero hacé que ' +
      'el guard la entienda.',
  );
});

test('(B2) nadie lee los tokens de GEOMETRÍA del nav sin estar en el registro', () => {
  const unregistered = scan(
    (line, file) =>
      NAV_GEOMETRY_TOKEN.test(line) && !Object.prototype.hasOwnProperty.call(BOTTOM_BAND_SURFACES, file),
  );
  assert.deepEqual(
    show(unregistered),
    [],
    'Leer `$navBar` / `$fabRaise` para posicionarse es declararse VECINO de la barra o del FAB. Es la ' +
      'segunda firma de (B): cubre al que se ancla con los tokens del nav aunque su `bottom` no nombre la ' +
      'reserva inferior. Registralo en `BOTTOM_BAND_SURFACES` con su separación verificada.',
  );
});

test('(B-inverso) el registro de la banda no tiene entradas MUERTAS', () => {
  for (const file of Object.keys(BOTTOM_BAND_SURFACES)) {
    const byToken = scan((line, f) => f === file && NAV_GEOMETRY_TOKEN.test(line));
    const byAnchor = scanPropExpressions('bottom').filter(
      (u) => u.file === file && mentionsBottomReserve(u.src, u.expr),
    );
    assert.ok(
      byToken.length > 0 || byAnchor.length > 0,
      `\`${file}\` está en BOTTOM_BAND_SURFACES pero ya no se ancla en la banda ni lee los tokens del nav: ` +
        'sacalo del registro (una entrada muerta es un permiso sin dueño).',
    );
  }
});

// ═══ (E) El pill del bastón NO puede volver a ser tocable ════════════════════════════════════════════

test('(E) el pill del bastón sigue siendo INFORMATIVO (sin onPress, con pointerEvents="none")', () => {
  // ── LA DECISIÓN QUE ESTE TEST CONGELA ────────────────────────────────────────────────────────────
  // El 2026-08-06 se hizo tocable el pill (abría `/baston`) y se revirtió el mismo día con evidencia:
  //   · A07: el CTA 'Arrancar jornada' ocupa [34,1242]-[686,1362] y el pill [220,1244]-[500,1306] — el
  //     pill queda ENTERO ADENTRO del botón. Con el pill tocable, el tap del operario sobre el CTA más
  //     importante del flujo de manga se lo lleva `/baston`.
  //   · web @412×915: el pill era el elemento topmost sobre "Ir a Animales" (Inicio), "Eliminar campo"
  //     (Más) y tres maniobras tocables de `/maniobra/jornada` etapa 2 (🔴 manga).
  // La banda de abajo está disputada POR DISEÑO (todo CTA a ancho completo la cruza) → no hay ninguna
  // posición en x donde un pill flotante y tocable sea seguro. Gatear por ruta ya se descartó aparte.
  const src = code(PILL);
  assert.doesNotMatch(
    src,
    /\bonPress\b/,
    'El pill del bastón NO puede tener `onPress`: se superpone a CTAs de manga y les roba el toque (ver ' +
      'arriba, medido en el A07 y en web). El acceso a `/baston` ya está resuelto por la fila de la ' +
      'sección "Dispositivos" del tab "Más" y por el `ConnectHero` de cada pantalla relevante.',
  );
  assert.doesNotMatch(src, /\bpressStyle\b/, 'sin `onPress` un `pressStyle` es una afordancia que miente');
  assert.doesNotMatch(src, /\bbuttonA11y\b/, 'el pill no es un botón: su nombre accesible va por `labelA11y`');
  assert.match(
    src,
    /pointerEvents="none"/,
    'El pill necesita `pointerEvents="none"` EXPLÍCITO. No alcanza con heredar: su contenedor es ' +
      '`box-none`, y Tamagui emite en web `._pe-boxnone > * { pointer-events: auto }` — o sea el hijo ' +
      'directo VOLVERÍA a capturar. Ese `none` es lo que sostiene RMV3.6.',
  );
  assert.match(
    src,
    /pointerEvents="box-none"/,
    'y el CONTENEDOR sigue `box-none`: mide todo el ancho, si capturara rompería el borde inferior de ' +
      'todas las pantallas',
  );
});

// ═══ (F) LA BANDA DE ARRIBA A LA DERECHA (donde vive el indicador desde el 2026-08-06) ══════════════
//
// El indicador del bastón se mudó del borde inferior a **debajo de la fila del header, a la derecha**. La
// banda que dejó libre sigue vigilada por (B); esta es la banda NUEVA, y nace con la misma disciplina: el
// que se ancle acá se registra, y el anclaje se verifica con NÚMEROS, no con prosa.
//
// ⚠️ LÍMITE DECLARADO: la firma es *"el valor menciona la reserva SUPERIOR"* (`insets.top` y sus alias).
// Un overlay que se ancle arriba con un valor MEDIDO en runtime (el caso real: el dropdown del switch de
// campo, que recibe `anchorTop={headerBottom}` de un `onLayout`) es invisible para cualquier análisis
// estático — por eso está enumerado abajo a mano, con su motivo, en vez de fingir que el guard lo ve.

/** Superficies registradas en la banda superior derecha. */
const TOP_BAND_SURFACES: Record<string, string> = {
  [PILL]:
    'el indicador global del bastón (RMV3.5): se ancla `insets.top + $3*2 + $avatar` → JUSTO debajo de la ' +
    'fila del header, y `right: $4`. Es el dueño de la banda. Verificado con números en (F-banda). NO es ' +
    'tocable (ver (E))',
  'app/(tabs)/index.tsx':
    'el dropdown del switch de campo baja DESDE la fila del header con `anchorTop={headerBottom}`, un valor ' +
    'MEDIDO por `onLayout` — no menciona la reserva, así que la firma de (F1) no lo ve. Se enumera acá a ' +
    'mano porque existe y comparte banda. No hay defecto: el dropdown solo existe mientras está abierto (un ' +
    'gesto deliberado) y el indicador es `pointerEvents="none"`, así que en el peor caso se superponen unos ' +
    'segundos sin robar un solo toque. Queda ANOTADO para que el próximo que toque cualquiera de los dos ' +
    'sepa que comparten esquina.',
};

/** Prop que COLOCA el borde de arriba de un elemento en una coordenada. */
const TOP_ANCHOR_PROP = /^top$/;

/** Los nombres con los que un archivo tiene la reserva SUPERIOR en la mano. */
function topReserveNames(src: string): string[] {
  const names = new Set<string>(['insets.top', 'safeTop', 'topInset']);
  for (const [, name] of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSafeAreaInsets\s*\(\)\s*\.top/g)) {
    names.add(name);
  }
  for (const [, name] of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSafeAreaInsets\s*\(\)\s*;/g)) {
    names.add(`${name}.top`);
  }
  for (const [, alias] of src.matchAll(
    /\bconst\s*\{[^}]*\btop\b\s*(?::\s*([A-Za-z_$][\w$]*))?[^}]*\}\s*=\s*useSafeAreaInsets\s*\(\)/g,
  )) {
    names.add(alias ?? 'top');
  }
  return [...names];
}

/** ¿El VALOR de esta expresión sale de la reserva superior? (mismo criterio que `mentionsBottomReserve`) */
function mentionsTopReserve(src: string, expr: string): boolean {
  const alternatives = [
    ...topReserveNames(src).map((n) => `${/^[\w$]/.test(n) ? '\\b' : ''}${n.replace(ESCAPE_RE, '\\$&')}\\b`),
    // ── EL MUTANTE QUE ESTO CIERRA (medido: sobrevivía a la primera versión de la firma) ──────────────
    // `<View top={useSafeAreaInsets().top + 70} />` — la reserva LEÍDA EN LÍNEA, sin pasar por un `const`.
    // La firma derivaba nombres SOLO de declaraciones, así que un anclaje escrito así se metía en la banda
    // del indicador sin registrarse y el guard daba VERDE. Es la misma alternativa que `bottomReserveRegex`
    // ya tenía para el borde de abajo; faltaba de este lado.
    'useSafeAreaInsets\\s*\\(\\)\\s*\\.top',
  ];
  const reserve = new RegExp(`(?:${alternatives.join('|')})`);
  if (reserve.test(expr)) return true;
  if (!BARE_IDENTIFIER.test(expr)) return false;
  const decl = new RegExp(`\\bconst\\s+${expr}\\s*(?::[^=]+)?=\\s*([^;]+);`).exec(src);
  if (decl === null) return false;
  const rhs = decl[1].replace(/\s+/g, ' ');
  // ── EL FALSO POSITIVO QUE ESTO CIERRA (medido: 2 archivos) ─────────────────────────────────
  // `agregar-evento.tsx` y `crear-animal.tsx` arman su header en un `const headerNode = <YStack
  // paddingTop={insets.top} …>` y después lo pasan como `header={headerNode}`. Seguir un nivel de const
  // hacía que el guard viera la reserva ADENTRO del JSX y reportara la prop `header` como "coloca algo con
  // la reserva". No coloca nada: pasa un NODO, y ahí adentro la reserva se usa como `paddingTop` (que
  // reserva espacio, la única forma permitida). Un guard con falsos positivos se termina apagando, así que
  // la indirección solo se sigue cuando el valor es una EXPRESIÓN, no un árbol de JSX.
  if (rhs.includes('<')) return false;
  return reserve.test(rhs);
}

test('(F1) nadie ancla nada en la banda SUPERIOR sin estar en el registro', () => {
  const offenders: string[] = [];
  for (const { file, src, rawLines } of scannedSources()) {
    if (Object.prototype.hasOwnProperty.call(TOP_BAND_SURFACES, file)) continue;
    for (const use of propUsesOfFile(src, rawLines)) {
      if (!TOP_ANCHOR_PROP.test(use.prop)) continue;
      if (!mentionsTopReserve(src, use.expr)) continue;
      offenders.push(`${file}:${use.line}  ${use.prop}={${use.expr.slice(0, 90)}}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Un `top` cuyo valor sale de la reserva SUPERIOR ancla el elemento en la banda del chrome de arriba — la ' +
      'misma donde vive el indicador del bastón desde el 2026-08-06, y la misma donde cada pantalla pone su ' +
      'acción secundaria (el avatar de la home, la ✕ de MODO MANIOBRAS, "+ Crear campo"…). Registralo en ' +
      '`TOP_BAND_SURFACES` con su motivo; (F-banda) va a exigirle que despeje la fila del header. Y si va a ' +
      'ser TOCABLE, leé antes el bloque ⛔ de `StickStatusIndicator.tsx`.',
  );
});

test('(F1-bis) si el valor sale de la reserva superior, la prop tiene que ser una que el guard sepa medir', () => {
  // Espejo exacto de (B1-bis) para el borde de arriba: la familia `padding` RESERVA espacio (no coloca) y
  // `top` COLOCA (y se puede convertir en coordenada). Todo lo demás que dependa de la reserva superior
  // —`marginTop`, `translateY`, `inset`, un `style={fn(insets.top)}`— nace en ROJO, porque coloca igual de
  // fuerte y el guard no lo sabe medir. La lista está al revés a propósito: enumerar lo PELIGROSO es lo
  // que hizo que el guard de abajo se dejara burlar tres veces.
  const offenders: string[] = [];
  for (const { file, src, rawLines } of scannedSources()) {
    if (Object.prototype.hasOwnProperty.call(TOP_BAND_SURFACES, file)) continue;
    for (const use of propUsesOfFile(src, rawLines)) {
      if (TOP_ANCHOR_PROP.test(use.prop) || SPACE_RESERVING_PROP.test(use.prop)) continue;
      if (!mentionsTopReserve(src, use.expr)) continue;
      offenders.push(`${file}:${use.line}  ${use.prop}: ${use.expr.slice(0, 70)}`);
    }
  }
  assert.deepEqual(offenders, [], 'ver el mensaje de (B1-bis): mismo invariante, borde de arriba');
});

test('(F-banda) el indicador DESPEJA la fila del header, en las cuatro reservas superiores reales', () => {
  // El número que importa: el borde de ARRIBA del indicador tiene que quedar en `reserva + alto de la fila`.
  // Más arriba, se le montaría a la fila — que es donde viven el avatar de la home, la ✕ de MODO MANIOBRAS,
  // el "+ Crear campo" y el "⋮" de saltar animal (todos MEDIDOS, ver `progress/impl_pill-arriba-derecha.md`).
  // Se calcula para las CUATRO reservas porque un anclaje que no dependa de la reserva (un número pelado,
  // un `Math.max`) se rompe justo en el teléfono con notch.
  const configCode = code(TAMAGUI_CONFIG);
  const src = code(PILL);
  const headerRow = spaceToken('$3') * 2 + sizeTokenFromConfig(configCode, 'avatar');
  const anchors = propUsesOfFile(src).filter(
    (u) => TOP_ANCHOR_PROP.test(u.prop) && mentionsTopReserve(src, u.expr),
  );
  assert.equal(
    anchors.length,
    1,
    `el indicador tiene que declarar UN solo anclaje superior legible; encontré ${anchors.length}`,
  );
  const mkEnv = (reserve: number): ResolveEnv => ({
    src,
    token: (name, group) => (group === 'size' ? sizeTokenFromConfig(configCode, name) : spaceToken(`$${name}`)),
    scope: Object.fromEntries(topReserveNames(src).map((n) => [n, reserve])),
  });
  const { values, dependsOnReserve } = resolveByReserve(anchors[0].expr, mkEnv, REAL_TOP_RESERVES);
  assert.ok(
    dependsOnReserve,
    'el anclaje no se mueve con la reserva superior: en un teléfono con notch quedaría metido debajo del ' +
      'status bar (o flotando de más). Tiene que sumar sobre `insets.top`.',
  );
  REAL_TOP_RESERVES.forEach((reserve, i) => {
    assert.equal(
      values[i],
      reserve + headerRow,
      `con reserva superior ${reserve} dp el indicador arranca en ${values[i]} dp y la fila del header ` +
        `termina en ${reserve + headerRow} (= reserva + $3*2 + $avatar). Si lo moviste a propósito, cambiá ` +
        'este cálculo Y volvé a medir las pantallas: la fila está OCUPADA en la home, en mis-campos, en ' +
        '/maniobra, en lote/[id] en selección y en todo el flujo de manga.',
    );
  });
});

test('(F-reserva) la home RESERVA la banda, y con el MISMO número del que sale el círculo', () => {
  // ── EL DEFECTO DE MÉTODO QUE ESTE TEST CIERRA (2026-08-07) ─────────────────────────────────────────
  // El sondeo E2E dio la banda LIBRE en la home… con un fixture cuyo usuario se llama "E2E". El saludo
  // (`¡Hola {nombre}! 👋`, `$9` = 30 px, **sin `numberOfLines`**) crece con el nombre, y el producto acepta
  // hasta `NAME_MAX_LENGTH`. Medido con nombres reales @412: con 14 caracteres el primer renglón llegaba a
  // **x=355** y el círculo arranca en **x=354** → el saludo pasaba POR DEBAJO del indicador. Se había
  // medido la instancia, no el rango.
  //
  // El arreglo (reservar, en vez de truncar un nombre propio) vive en el JSX y es exactamente la clase de
  // cosa que alguien saca "porque no se ve para qué está": tres tokens de padding en un texto. Por eso el
  // guard exige (a) que la reserva ESTÉ y (b) que salga de `stickIndicatorBandReserve()` — o sea del mismo
  // token del que sale el círculo. Una copia (`paddingRight={47}`) se desincronizaría el día que el
  // indicador cambie de tamaño, y nadie se enteraría hasta ver un nombre tapado en producción.
  const home = code(HOME);
  assert.match(
    home,
    /import \{ stickIndicatorBandReserve \} from '@\/features\/ble-stick\/indicator-geometry'/,
    'la home tiene que pedirle la reserva al dueño de la geometría, no calcularla',
  );
  assert.match(
    home,
    /paddingRight=\{stickIndicatorBandReserve\(\)\}/,
    'el saludo de la home tiene que reservar la banda del indicador: sin eso, un nombre de ~14 caracteres ' +
      'queda por debajo del círculo (medido x=355 vs banda x=354). Si el saludo pasa a truncar o la home ' +
      'reclama la banda, cambiá ESTE test y decí por qué — no lo borres.',
  );
  // Y la reserva cubre el círculo COMPLETO más aire (no la mitad).
  const reserve = /return indicatorGeometry\(\)\.circle \+ getTokenValue\('\$(\w+)', 'space'\);/.exec(
    code(INDICATOR_GEOMETRY),
  );
  assert.ok(reserve, '`stickIndicatorBandReserve()` tiene que ser `círculo + un token de aire`');
  assert.ok(
    spaceToken(`$${reserve[1]}`) > 0,
    'el aire de la reserva tiene que ser un token real del DS',
  );
});

test('(F-inverso) el registro de la banda superior no tiene entradas MUERTAS', () => {
  for (const file of Object.keys(TOP_BAND_SURFACES)) {
    const src = code(file);
    const anchored = propUsesOfFile(src).some(
      (u) => TOP_ANCHOR_PROP.test(u.prop) && mentionsTopReserve(src, u.expr),
    );
    const measured = /\banchorTop\b/.test(src);
    assert.ok(
      anchored || measured,
      `\`${file}\` está en TOP_BAND_SURFACES pero ya no se ancla arriba: sacalo del registro (una entrada ` +
        'muerta es un permiso sin dueño).',
    );
  }
});

// ═══ (C) Los tests de geometría no están midiendo una app imaginaria ════════════════════════════════

test('(C) los tokens que copia `nav-target-bands.test.ts` coinciden con los REALES', () => {
  // ── EL MODO DE FALLA QUE CIERRA ESTE TEST ──────────────────────────────────────────────────────────
  // Los tests puros no pueden importar `tamagui.config.ts` (arrastra react-native), así que copian los
  // números. Si alguien cambia `FAB_RAISE_RATIO` de 0.40 a 0.55, la geometría entera se mueve, el pill
  // pasa a solaparse otra vez… y la suite pura sigue verde, porque sigue calculando con 26.
  const configCode = code(TAMAGUI_CONFIG);
  const pureSrc = code(PURE_TEST);
  const expected: Array<[string, number]> = [
    ['NAV_BAR', sizeTokenFromConfig(configCode, 'navBar')],
    ['NAV_ITEM_TOP', sizeTokenFromConfig(configCode, 'navItemTop')],
    ['FAB', sizeTokenFromConfig(configCode, 'fab')],
    ['FAB_RAISE', sizeTokenFromConfig(configCode, 'fabRaise')],
    ['PILL_GAP', spaceToken('$4')],
  ];
  for (const [name, real] of expected) {
    assert.equal(
      declaredNumber(pureSrc, name, PURE_TEST),
      real,
      `${PURE_TEST} hardcodea ${name} distinto del token real (${real})`,
    );
  }
});

test('(C) el E2E geométrico NO tiene espejo: deriva el hitSlop del código de producción', () => {
  // ── EL AGUJERO QUE ESTE TEST CIERRA ────────────────────────────────────────────────────────────────
  // El E2E es el único oráculo que ve el layout REAL, pero medía con un `const FAB_HIT_SLOP = { top: 0,
  // … }` escrito a mano. Un espejo no puede desmentir al código: con cualquier mutante que cambiara el
  // slop de verdad, el E2E seguía muestreando la franja de un slop que ya no existía y daba verde. Ahora
  // llama a `resolveFabHitSlop()` —la misma función que usa este guard— sobre el fuente de
  // `_layout.tsx`, así que el valor que muestrea ES el valor del componente.
  //
  // Se verifica por AUSENCIA de las copias además de por presencia de la llamada: el modo de falla que
  // importa es que alguien "arregle" un E2E rojo volviendo a poner el número a mano.
  const e2eSrc = code(E2E_GUARD);
  assert.match(
    e2eSrc,
    /resolveFabHitSlop\s*\(/,
    `${E2E_GUARD} tiene que resolver el hitSlop del fuente de producción con \`resolveFabHitSlop()\``,
  );
  assert.match(e2eSrc, /from '\.\.\/src\/utils\/nav-target-bands'/, 'y tomarlo del módulo compartido');
  for (const mirror of ['FAB_HIT_SLOP', 'HISTORIC_TOP_SLOP', 'MIN_TAP_TARGET_SEPARATION', 'AS_BUILT_SEPARATION']) {
    assert.doesNotMatch(
      e2eSrc,
      new RegExp(`const\\s+${mirror}\\s*=\\s*(?:-?\\d|\\{)`),
      `${E2E_GUARD} volvió a COPIAR \`${mirror}\` a mano. Ese es el espejo que hacía que el E2E midiera una ` +
        'app imaginaria: derivalo del módulo o del fuente, no lo escribas.',
    );
  }
  // Y el contrafáctico con el que el E2E se auto-falsifica sigue siendo el slop histórico ($fabRaise),
  // leído del token: si el token se mueve y el contrafáctico no, el E2E deja de reproducir el bug.
  assert.match(
    e2eSrc,
    /sizeTokenFromConfig\([\s\S]{0,40}'fabRaise'\)/,
    'el contrafáctico del E2E tiene que salir del token `$fabRaise`, no de un 26 escrito a mano',
  );

  // La ÚNICA copia que le queda al E2E: la tablita de tokens de `space` (vienen del default de tamagui,
  // que un spec de Playwright no puede importar sin arrastrar el runtime). Es chica y fail-closed —si el
  // código usara un `$N` que no está, el resolvedor tira— pero una copia sin comparar es exactamente el
  // problema que este bloque cierra, así que se compara acá contra los tokens reales.
  const table = /const SPACE_TOKENS: Record<string, number> = \{([^}]*)\}/.exec(e2eSrc);
  assert.ok(table, `${E2E_GUARD} tiene que declarar \`const SPACE_TOKENS: Record<string, number> = { … }\``);
  const entries = [...table[1].matchAll(/'(\d+)':\s*(\d+(?:\.\d+)?)/g)];
  assert.ok(entries.length >= 3, 'la tabla de space del E2E quedó vacía o cambió de forma');
  for (const [, name, value] of entries) {
    assert.equal(Number(value), spaceToken(`$${name}`), `${E2E_GUARD}: \`$${name}\` no vale lo que dice tamagui`);
  }
});

test('(C) la separación AS-BUILT que fija el test puro ES la que sale de los tokens', () => {
  // El último eslabón: que el número que el test puro llama "as-built" se derive de verdad de
  // `space.$4 + $navItemTop` y no sea una constante que alguien ajustó para que el test pasara.
  const configCode = code(TAMAGUI_CONFIG);
  assert.equal(
    declaredNumber(code(PURE_TEST), 'AS_BUILT_SEPARATION', PURE_TEST),
    spaceToken('$4') + sizeTokenFromConfig(configCode, 'navItemTop'),
  );
});

// ═══ (D) El código de producción lee los tokens (no un literal equivalente) ══════════════════════════

test('(D) el indicador se ancla con TOKENS (no con literales equivalentes)', () => {
  // ⚠️ ANCLAJE NUEVO (2026-08-06): el indicador dejó el borde inferior y vive DEBAJO DE LA FILA DEL HEADER,
  // a la derecha. Los tokens que tiene que leer cambiaron con él: ya no `$navBar`/`$fabRaise` (era vecino
  // del FAB) sino los que describen la fila del header que tiene que despejar.
  const src = code(PILL);
  assert.match(
    src,
    /getTokenValue\('\$3',\s*'space'\)/,
    'el alto de la fila del header se deriva de SU paddingVertical (`$3`), no de un 66 escrito a mano',
  );
  assert.match(
    src,
    /getTokenValue\('\$avatar',\s*'size'\)/,
    'y del elemento más ALTO que vive en esa fila (`$avatar`): si el avatar del header cambia de tamaño, el ' +
      'indicador lo sigue solo en vez de quedarse encima de él',
  );
  assert.match(src, /getTokenValue\('\$4',\s*'space'\)/, 'y el margen derecho es el `$4` de la app');
  assert.match(
    code(INDICATOR_GEOMETRY),
    /getTokenValue\('\$navIcon',\s*'size'\)/,
    'el círculo se DIMENSIONA desde el ícono (`$navIcon` + padding + borde), no desde un `$chipMin`: no es ' +
      'un target, así que su tamaño sale de su contenido',
  );
  assert.doesNotMatch(
    src,
    /minHeight="\$chipMin"/,
    '`$chipMin` (40) es el bar de un TARGET compacto, y el indicador NO es un target (ver (E)): su tamaño ' +
      'sale de su contenido. Se le puso en el intento del 2026-08-06 de hacerlo tocable y salió con él.',
  );
  assert.doesNotMatch(src, /\bhitSlop\b/, 'el indicador NO usa hitSlop; si algún día lo lleva, va al registro de (A)');
});

test('(D-color) el ESTADO no viaja solo por color: lo lleva el ÍCONO', () => {
  // ── LA REGLA, Y POR QUÉ ES UN GUARD ────────────────────────────────────────────────────────────────
  // La forma nueva del indicador (círculo permanente) se pidió con verde/rojo. Con el color como ÚNICO
  // canal, el ~8 % de los varones con daltonismo rojo-verde no puede leer el estado — y este producto es
  // de usuarios mayoritariamente varones en el campo (WCAG 1.4.1). El proyecto ya cometió y corrigió este
  // error en el nav: *"la pill suma 2 canales (forma + fondo) además del color"* (`app/(tabs)/_layout.tsx`).
  // Acá el canal que manda es el ÍCONO —y el color refuerza—, así que el guard exige que la función que
  // elige el ícono siga discriminando estados en vez de devolver siempre el mismo glifo.
  const src = code(PILL);
  const iconFn = /function iconFor\(status: ConnectionStatus\)[\s\S]*?\n\}/.exec(src);
  assert.ok(iconFn, 'el indicador tiene que resolver su ícono a partir del `ConnectionStatus`');
  for (const icon of ['BluetoothConnected', 'BluetoothSearching', 'TriangleAlert', 'Bluetooth']) {
    assert.ok(
      iconFn[0].includes(icon),
      `el ícono \`${icon}\` desapareció del mapeo de estado: si el glifo deja de cambiar con el estado, el ` +
        'color queda como único canal — que es exactamente lo que no puede pasar.',
    );
  }
  assert.match(src, /<Icon size=\{geometry\.icon\}/, 'y ese ícono es el que se pinta (no uno fijo)');
});

test('(D) el `bottom` del hitSlop del FAB se DERIVA de los mismos tokens que el modelo', () => {
  const src = code(FAB_OWNER);
  const decl = /const HIT_SLOP = \{([\s\S]*?)\};/.exec(src);
  assert.ok(decl);
  // `navHeight` es el alias local de `$navBar` en `navColors()`; el resto son los tokens directos.
  assert.match(decl[1], /navHeight/);
  assert.match(decl[1], /navItemTop/);
  assert.match(decl[1], /FAB_SIZE/);
  assert.match(decl[1], /FAB_RAISE/);
});

// ═══ Falsificación + auto-verificación ══════════════════════════════════════════════════════════════

test('el guard DETECTA las FORMAS de burlarlo (no solo la forma en que hoy se escribe el bug)', () => {
  // Un guard que no puede fallar es un guard muerto — y uno que solo caza la grafía de ayer es peor,
  // porque parece vivo. Los tres primeros casos son los que BURLARON la primera versión de este guard.
  const clasificar = (src: string) => {
    const [use] = propExpressions(src, 'hitSlop');
    assert.ok(use, `no se pudo extraer el hitSlop de: ${src}`);
    if (NUMERIC_LITERAL.test(use.expr)) return Number(use.expr) <= MAX_UNCHECKED_SCALAR_SLOP ? 'ok' : 'escalar-grande';
    if (!BARE_IDENTIFIER.test(use.expr)) return 'ilegible';
    return 'identificador';
  };

  // (1) EL MUTANTE DEL REVIEWER — el override con spread en el sitio de uso.
  assert.equal(clasificar('hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}'), 'ilegible');
  // (2) El ternario: mismo agujero, otra grafía.
  assert.equal(clasificar('hitSlop={big ? HIT_SLOP : { top: 26, bottom: 20 }}'), 'ilegible');
  // (3) La llamada / el helper: idem.
  assert.equal(clasificar('hitSlop={Object.assign({}, HIT_SLOP, { top: 26 })}'), 'ilegible');
  assert.equal(clasificar('hitSlop={withTop(HIT_SLOP, FAB_RAISE)}'), 'ilegible');
  // (4) El objeto inline de siempre.
  assert.equal(clasificar('hitSlop={{ top: FAB_RAISE, bottom: 20 }}'), 'ilegible');
  // (5) Un escalar grande.
  assert.equal(clasificar('hitSlop={40}'), 'escalar-grande');
  // (6) Lo CONVENCIONAL no dispara (si esto se pusiera rojo, el guard se desactiva y no sirve de nada).
  assert.equal(clasificar('<Pressable hitSlop={8} onPress={goBack}>'), 'ok');
  assert.equal(clasificar('hitSlop={12}'), 'ok');
  // (7) La forma correcta del FAB.
  assert.equal(clasificar('hitSlop={HIT_SLOP}'), 'identificador');

  // La extracción balanceada funciona aunque la expresión cruce LÍNEAS (el `bottom` del pill son 6).
  const multilinea = 'bottom={\n  safeBottom +\n  getTokenValue("$navBar", "size")\n}';
  assert.equal(propExpressions(multilinea, 'bottom')[0].expr, 'safeBottom + getTokenValue("$navBar", "size")');

  // ── La BANDA: las dos firmas de (B) ────────────────────────────────────────────────────────────────
  // Directa: suma sobre la reserva. Es el mutante del overlay anclado al nav con `$navBar + $6`.
  const conNav = "bottom={safeBottom + getTokenValue('$navBar','size') + getTokenValue('$6','space')}";
  assert.ok(mentionsBottomReserve('', propExpressions(conNav, 'bottom')[0].expr));
  // Sin NINGÚN token del nav: sigue cayendo, porque lo que importa es el destino y no el camino.
  const sinNav = "bottom={useSafeBottomInset() + getTokenValue('$12','space')}";
  assert.ok(mentionsBottomReserve('', propExpressions(sinNav, 'bottom')[0].expr));
  // LAVADA en un const local: un nivel de indirección tampoco alcanza.
  const lavada = "const anchor = safeBottom + getTokenValue('$12','space');\n<View bottom={anchor} />";
  assert.ok(mentionsBottomReserve(lavada, propExpressions(lavada, 'bottom')[0].expr));
  // Lo que NO es anclarse en la banda: un offset decorativo dentro de un hero (el caso real de
  // `maniobra/identificar.tsx` y `TagScanSheet.tsx`) — sin la reserva, no dispara.
  assert.ok(!mentionsBottomReserve('', propExpressions('bottom={heroScan * 0.16}', 'bottom')[0].expr));
  // Y el `bottom` NEGATIVO de un inset decorativo (el halo del FAB) tampoco: no suma sobre la reserva.
  assert.ok(!mentionsBottomReserve('', propExpressions('bottom={-COLOR.fabHaloInset}', 'bottom')[0].expr));
  // ── EL MUTANTE (2b) QUE ESTA PARTE CIERRA (medido: 35/35 PASS con el overlay puesto) ───────────────
  // El alias de la reserva al destructurar. La firma vieja era una lista de nombres fijos, así que
  // renombrar la variable alcanzaba para anclarse en la banda del FAB en silencio.
  const alias = 'const { bottom: pad } = useSafeAreaInsets();\n<View position="absolute" bottom={pad + 86} />';
  assert.ok(
    mentionsBottomReserve(alias, propExpressions(alias, 'bottom')[0].expr),
    'el alias destructurado de la reserva tiene que contar igual que `safeBottom`',
  );
  const objeto = 'const ins = useSafeAreaInsets();\n<View bottom={ins.bottom + 86} />';
  assert.ok(mentionsBottomReserve(objeto, propExpressions(objeto, 'bottom')[0].expr));
  const hook = 'const reserva = useSafeBottomInset();\n<View bottom={reserva + 86} />';
  assert.ok(mentionsBottomReserve(hook, propExpressions(hook, 'bottom')[0].expr));
  // Y un nombre que NO sale de una fuente de reserva sigue sin disparar (si no, el guard se apaga solo).
  const ajeno = 'const pad = props.spacing;\n<View bottom={pad + 86} />';
  assert.ok(!mentionsBottomReserve(ajeno, propExpressions(ajeno, 'bottom')[0].expr));

  // El token de geometría del nav, por su lado: los CUATRO, no sólo los dos con los que se escribió el
  // bug — se llega a la misma banda por `$fab` o por `$navItemTop`.
  assert.ok(NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$fabRaise', 'size') + 8}"));
  assert.ok(NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$navBar', 'size')}"));
  assert.ok(NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$fab', 'size')}"));
  assert.ok(NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$navItemTop', 'size')}"));
  assert.ok(NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$navBottomMin', 'size')}"));
  // Un token que NO es del nav no dispara.
  assert.ok(!NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$fabuloso', 'size')}"));
  assert.ok(!NAV_GEOMETRY_TOKEN.test("  bottom={inset + getTokenValue('$chipMin', 'size')}"));

  // Una MENCIÓN en un comentario no es un uso (se blanquea antes de escanear).
  assert.ok(!HIT_SLOP_ANY.test(stripSourceComments('// antes: hitSlop={{ top: 26 }}')));
  assert.ok(!NAV_GEOMETRY_TOKEN.test(stripSourceComments('/* el pico del FAB sube $fabRaise */')));

  // La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// tap-target-disable-next-line -- overlay sin vecinos en esa banda'));
  assert.ok(!DISABLE_NEXT_LINE.test('// tap-target-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// tap-target-disable-next-line --'));
});

test('el MOTOR de (A-fix) lee el valor real de un objeto de insets, escrito como esté escrito', () => {
  // Es el motor del test que sostiene el fix: si el resolvedor devolviera de menos, (A-fix) se vuelve
  // decorativo — que es exactamente lo que pasaba con el extractor por líneas. Los casos de gramática
  // completos están en `nav-target-bands.test.ts`; acá quedan los tres que fueron mutantes REALES.
  const env = (src: string): ResolveEnv => ({ src, token: () => undefined, scope: { FAB_RAISE: 26 } });
  assert.deepEqual(resolveInsetSidesLocal('const S = {\n  bottom: 20,\n};', 'S'), { bottom: 20 });
  // MUTANTE 3 (2026-08-06): todo en una línea. El extractor viejo devolvía sólo `['bottom']`.
  assert.deepEqual(resolveInsetSidesLocal('const S = { bottom: 20, top: 26 };', 'S'), { bottom: 20, top: 26 });
  // MUTANTE 1: el spread con override.
  assert.deepEqual(
    resolveInsetSides('{ ...S, top: FAB_RAISE }', env('const S = { bottom: 20 };')),
    { bottom: 20, top: 26 },
  );
  // Una clave ANIDADA no es un lado del target… pero tampoco se puede resolver el valor, así que TIRA
  // (fail-closed) en vez de reportar un objeto incompleto.
  assert.throws(() => resolveInsetSidesLocal('const S = {\n  bottom: fn({\n    top: 9,\n  }),\n};', 'S'), TargetResolutionError);
  assert.throws(() => resolveInsetSidesLocal('const OTRO = { bottom: 1 };', 'S'), TargetResolutionError);
});

/** Azúcar: resolver `const <name> = {…}` de un fuente sintético, sin tokens. */
function resolveInsetSidesLocal(src: string, name: string): Record<string, number> {
  return resolveInsetSides(name, { src, token: () => undefined });
}

test('los tokens del nav RESUELVEN de verdad (nombre + grupo + valor), no solo se nombran', () => {
  const configCode = code(TAMAGUI_CONFIG);
  assert.equal(sizeTokenFromConfig(configCode, 'navBar'), 60);
  assert.equal(sizeTokenFromConfig(configCode, 'navItemTop'), 2);
  assert.equal(sizeTokenFromConfig(configCode, 'fab'), 64);
  // DERIVADO: `Math.round(FAB_SIZE * FAB_RAISE_RATIO)`. Que se evalúe es el punto — cambiar el ratio
  // mueve la geometría entera del borde inferior sin tocar una sola pantalla.
  assert.equal(sizeTokenFromConfig(configCode, 'fabRaise'), 26);
  assert.equal(sizeTokenFromConfig(configCode, 'chipMin'), 40);
  assert.equal(spaceToken('$4'), 18);
  assert.equal(spaceToken('$2'), 7); // el gap viejo del pill, el que daba 9 dp de separación
});

test('AUTO-VERIFICACIÓN: ningún archivo desbalancea el blanqueo COMPARTIDO (con la línea culpable)', () => {
  // ── EL INCIDENTE QUE ESTE TEST CIERRA (2026-08-06, lo midió la unidad hermana) ─────────────────────
  // `nav-target-bands.ts` —este mismo módulo— quedaba con las llaves desbalanceadas al pasar por
  // `stripSourceComments…`, y eso rompe `assertScanCoverage`, que es COMPARTIDO: se cayeron 5 guards que
  // no tienen nada que ver con esta unidad y `check.mjs` dio 10 rojos. Costo real del diagnóstico: la
  // causa estaba a cinco guards de distancia del síntoma.
  //
  // La causa es siempre la misma y es sutil: el blanqueador **no distingue un literal de regex** (límite
  // declarado en `strip-comments.ts`). Una comilla adentro de un regex (`['"]`) abre un string falso que
  // se come el resto de la línea —incluida la llave de apertura de la arrow function que sigue— y una
  // llave adentro de un regex (`/return\s*\{/`) suma una apertura que nadie cierra.
  //
  // `assertScanCoverage` ya lo detecta, pero informa el ARCHIVO. Acá se informa la LÍNEA y el arreglo,
  // que es la diferencia entre cinco minutos y una tarde. Cubre el árbol entero, no sólo este módulo:
  // el próximo archivo que caiga en la trampa nace con el diagnóstico puesto.
  const offenders: string[] = [];
  for (const path of ROOTS.flatMap(listFiles)) {
    const source = readFileSync(path, 'utf8');
    const stripped = stripSourceCommentsAndStrings(source);
    const rawLines = source.split(/\r?\n/);
    let depth = 0;
    let line = 1;
    const open: number[] = [];
    let firstNegative = 0;
    for (const ch of stripped) {
      if (ch === '\n') line++;
      else if (ch === '{') {
        depth++;
        open.push(line);
      } else if (ch === '}') {
        depth--;
        open.pop();
        if (depth < 0 && !firstNegative) firstNegative = line;
      }
    }
    if (depth === 0 && !firstNegative) continue;
    const culprit = firstNegative || open[open.length - 1] || 0;
    offenders.push(
      `${rel(path)}:${culprit}  (cierra en ${depth}) → ${(rawLines[culprit - 1] ?? '').trim().slice(0, 80)}`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    'Este archivo deja las llaves desbalanceadas DESPUÉS del blanqueo compartido, y eso no lo rompe sólo ' +
      'acá: `assertScanCoverage` lo usan varios guards del repo, así que un archivo nuevo puede voltear ' +
      'media suite con el síntoma a cinco guards de distancia (pasó el 2026-08-06: 10 rojos en check.mjs). ' +
      'Causa habitual: un literal de REGEX con comillas o llaves adentro — el blanqueador no distingue un ' +
      'regex de una división. Arreglo: escribí esos caracteres como escapes hexa dentro del regex ' +
      '(`\\x27` = comilla simple, `\\x22` = comilla doble, `\\x7b` = llave de apertura). La línea de arriba ' +
      'es la culpable.',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  assertScanCoverage({
    guard: 'tap-target-collision',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: rel,
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripSourceComments,
  });
});

test('el guard recorre el árbol real y ve los archivos que importan', () => {
  const scanned = ROOTS.flatMap(listFiles).map(rel);
  for (const expected of [FAB_OWNER, PILL, 'app/(tabs)/mas.tsx']) {
    assert.ok(scanned.includes(expected), `${expected} debería estar dentro del árbol escaneado`);
  }
  // Y ve los ~38 `hitSlop` convencionales: si el escaneo se rompiera, (A) pasaría vacío.
  const all = scan((line) => HIT_SLOP_ANY.test(line));
  assert.ok(all.length >= 20, `el guard solo encontró ${all.length} hitSlop en el árbol (esperaba ≥20)`);
});
