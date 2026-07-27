// GUARD: nadie monta un `KeyboardAvoiding` + `View` de React Native fuera del primitivo del repo
// (`src/components/KeyboardAvoidingShell.tsx` + su `.android.tsx`).
//
// ── EL BUG QUE CIERRA (🔴 device Android, Raf, APK release 7402575a) ─────────────────────────────────
// Al enfocar el input del sheet de Vacunación, **el teclado tapaba el sheet ENTERO**; en iOS el mismo
// sheet subía bien. Los 4 call sites del repo tenían COPIADA la misma línea:
// `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`. En Android, `behavior` sin definir cae en la
// rama `default` del componente de RN, que renderiza un `<View>` pelado: literalmente "no hagas nada". El
// comentario que acompañaba a las 4 copias decía que en Android lo resolvía el `adjustResize` de la
// ventana — cierto cuando se escribió y **falso hoy**: el build fuerza edge-to-edge
// (`setDecorFitsSystemWindows(false)`) y con eso el sistema deja de encoger la ventana; en todo
// `ReactAndroid` nadie compensa el layout ante el inset del IME.
//
// ── POR QUÉ UN GUARD Y NO "acordate" ────────────────────────────────────────────────────────────────
// Porque el bug era de CLASE, no de instancia: UNA línea correcta-en-su-momento, copiada CUATRO veces, que
// dejó de ser correcta por un cambio de plataforma que ningún test nuestro puede ver. En web no hay
// teclado virtual (`Keyboard` de react-native-web nunca emite y el KAV es un `<View>` inerte), así que la
// E2E entera pasa en verde con el bug adentro — igual que pasó con la reserva de safe-area. La defensa
// durable no es reproducir el síntoma: es **prohibir el patrón** y dejar UN lugar donde arreglarlo.
// Mismo espíritu (y mismo molde) que `worklet-callbacks-guard.test.ts` y `safe-bottom-inset-guard.test.ts`.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** El primitivo: base (iOS + web) y la implementación de Android que el bundler elige por extensión. */
const SHELL_BASE = 'src/components/KeyboardAvoidingShell.tsx';
const SHELL_ANDROID = 'src/components/KeyboardAvoidingShell.android.tsx';

/** Los 4 call sites que tenían la copia. Si alguno deja de usar el shell, el teclado vuelve a taparlo. */
const CALL_SITES = [
  'src/components/BottomSheetShell.tsx',
  'src/components/FooterActionShell.tsx',
  'src/components/AuthScreenShell.tsx',
  'app/maniobra/carga.tsx',
];

// El USO del primitivo en JSX — apertura y cierre. NO alcanza con buscar el identificador pelado
// (`\bKeyboardAvoidingShell\b`): eso matchea el IMPORT, y el import sobrevive intacto a que alguien saque el
// JSX y vuelva a poner el componente crudo. Comprobado en review: revirtiendo el JSX de `app/maniobra/carga.tsx`
// (import incluido intacto) el chequeo del identificador seguía en VERDE; el rojo lo daba otro test del guard.
// Se exige también el cierre porque el primitivo sirve ENVOLVIENDO contenido: un `<KeyboardAvoidingShell />`
// self-closing compila, importa y no levanta nada.
const SHELL_OPEN = /<KeyboardAvoidingShell\b/;
const SHELL_CLOSE = /<\/KeyboardAvoidingShell>/;

// ⚠️ Las firmas prohibidas se ARMAN POR CONCATENACIÓN a propósito (mismo truco que el guard de la reserva
// inferior): así este archivo NO contiene la cadena literal del componente de RN y un grep de aceptación
// sobre `app/src` + `app/app` sigue devolviendo exactamente UN archivo (el primitivo) en vez de reportar al
// propio guard. El costo es leerlo una vez; el beneficio es que el grep no miente.
const KAV = ['Keyboard', 'Avoiding', 'View'].join('');
/** El componente de RN, en cualquier forma: import, JSX de apertura/cierre, o mención en código. */
const RN_KAV = new RegExp(`\\b${KAV}\\b`);
/** El hook de Reanimated que lee la altura real del teclado: es la fuente única del alto. */
const ANIMATED_KEYBOARD = /\buseAnimatedKeyboard\b/;

/** Válvula de escape por línea, con justificación (mismo patrón que check-hardcode.mjs / los otros guards). */
const DISABLE_NEXT_LINE = /keyboard-avoiding-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /keyboard-avoiding-disable-line\s*--\s*\S/;

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
      // Los .test.* quedan fuera: este archivo arma las firmas y las usa en casos sintéticos.
      found.push(p);
    }
  }
  return found;
}

/** Blanquea comentarios preservando saltos de línea: una MENCIÓN documental no es una violación. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function scan(predicate: (line: string, rel: string) => boolean): string[] {
  const violations: string[] = [];
  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split(/\r?\n/);
      const lines = stripComments(raw).split(/\r?\n/);
      const rel = relative(APP_ROOT, file).split(sep).join('/');
      lines.forEach((line, i) => {
        if (!predicate(line, rel)) return;
        const here = rawLines[i] ?? '';
        const previous = rawLines[i - 1] ?? '';
        if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) return;
        violations.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
  }
  return violations;
}

function readShell(rel: string): string {
  const p = join(APP_ROOT, ...rel.split('/'));
  assert.ok(existsSync(p), `falta ${rel}: el primitivo del teclado tiene que existir con ese path exacto`);
  return stripComments(readFileSync(p, 'utf8'));
}

test('el componente de RN solo se monta dentro del primitivo (afuera es un no-op en Android)', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== SHELL_BASE && RN_KAV.test(line)),
    [],
    `El \`${KAV}\` de React Native no se usa directo en ninguna pantalla ni componente: con ` +
      '`behavior` sin definir es un `<View>` pelado en Android, y el `adjustResize` que lo cubría dejó de ' +
      'existir cuando el build pasó a edge-to-edge (el teclado tapa el sheet ENTERO, bug 🔴 en device). ' +
      `Usá el primitivo: \`<KeyboardAvoidingShell style={…}>\` (${SHELL_BASE} + ${SHELL_ANDROID}).`,
  );
});

test('la altura real del teclado se lee en UN solo archivo (la de RN en Android está mal)', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== SHELL_ANDROID && ANIMATED_KEYBOARD.test(line)),
    [],
    '`useAnimatedKeyboard` vive solo en la implementación Android del primitivo. Dos consumidores del ' +
      'alto del teclado = dos lifts que se suman (el contenido salta el doble de lo que mide el teclado).',
  );
});

test('la base (iOS + web) conserva el `behavior=padding` de iOS — que es lo verificado en device', () => {
  // iOS anda HOY y no se puede re-testear hasta el 1/8: esta implementación tiene que quedarse quieta.
  // Si alguien "simplifica" el ternario a un behavior fijo (o lo borra), iOS se rompe en silencio: en web
  // no cambia nada (RNW ignora `behavior`) y ninguna E2E lo ve.
  const base = readShell(SHELL_BASE);
  assert.match(base, new RegExp(`<${KAV}\\b`), 'la base tiene que montar el componente de RN');
  assert.match(
    base,
    /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/,
    "la base tiene que conservar EXACTAMENTE `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`",
  );
});

test('la implementación de Android aplica de verdad el alto del teclado (no es un no-op decorativo)', () => {
  // ── EL MODO DE FALLA QUE CIERRA ESTE TEST ────────────────────────────────────────────────────────
  // El archivo `.android.tsx` puede existir, compilar, pasar el typecheck y NO HACER NADA (un
  // `<Animated.View>` sin el estilo animado, o un `paddingBottom` que no sale del teclado). En web no se
  // carga siquiera —el bundler elige la base—, así que la suite entera queda verde describiendo un fix
  // que no existe. El bug volvería a ser observable SOLO en un device Android. Por eso acá se verifica la
  // cadena completa: hook → shared value → paddingBottom → vista animada.
  const android = readShell(SHELL_ANDROID);
  assert.match(android, ANIMATED_KEYBOARD, 'tiene que leer el alto con useAnimatedKeyboard');
  assert.match(
    android,
    /useAnimatedKeyboard\(\s*\)/,
    'sin argumentos: la detección de edge-to-edge se OR-ea sola y pasar un valor definido dispara un ' +
      'console.warn en DEV (controlEdgeToEdgeValues)',
  );
  assert.match(android, /useAnimatedStyle\(/, 'el padding se aplica por estilo animado (sigue al IME)');
  assert.match(
    android,
    /paddingBottom:\s*height\.value/,
    'el padding TIENE que salir del alto del teclado (`paddingBottom: height.value`)',
  );
  assert.match(android, /<Animated\.View\b/, 'el estilo animado necesita una vista de Reanimated');
  // Y el archivo tiene que llamarse `.android.tsx`: ESA extensión es todo el mecanismo de selección. Con
  // otro nombre, Android caería en la base (el no-op) sin que falle nada más.
  assert.ok(SHELL_ANDROID.endsWith('.android.tsx'));
});

test('los 4 call sites del bug ENVUELVEN su contenido con el primitivo (el import no cuenta)', () => {
  // El nombre del test es la promesa: verifica el USO, no la mención. Ver `SHELL_OPEN`/`SHELL_CLOSE` arriba
  // para el modo de falla concreto que dejaba pasar la versión anterior (identificador pelado = import).
  // Los comentarios se blanquean antes (readShell → stripComments): documentar el primitivo no es usarlo.
  const missing = CALL_SITES.filter((rel) => {
    const src = readShell(rel);
    return !SHELL_OPEN.test(src) || !SHELL_CLOSE.test(src);
  });
  assert.deepEqual(
    missing,
    [],
    'Estos archivos son los 4 que tenían la copia del patrón roto (los dos shells, el de auth y el paso ' +
      'de maniobra). Cada uno tiene que ABRIR y CERRAR `<KeyboardAvoidingShell …> … </KeyboardAvoidingShell>` ' +
      'alrededor de su contenido: dejar solo el import (o un self-closing) no levanta nada. Si uno deja de ' +
      'envolver, en Android el teclado vuelve a taparle el CTA y no lo caza ninguna E2E (web no monta ' +
      'teclado virtual).',
  );
});

test('el guard DETECTA las firmas (no pasa verde por no estar mirando nada)', () => {
  // Un guard que no puede fallar es un guard muerto. Se verifica sobre las líneas EXACTAS que tenía el
  // repo antes de esta unidad, sin tocar el árbol real.
  assert.ok(RN_KAV.test(`import { ${KAV}, Platform } from 'react-native';`));
  assert.ok(RN_KAV.test(`      <${KAV} style={avoidStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>`));
  assert.ok(RN_KAV.test(`      </${KAV}>`));
  assert.ok(ANIMATED_KEYBOARD.test('  const keyboard = useAnimatedKeyboard();'));

  // Lo CORRECTO no dispara.
  assert.ok(!RN_KAV.test('      <KeyboardAvoidingShell style={fillStyle}>'));
  assert.ok(!RN_KAV.test("import { KeyboardAvoidingShell } from './KeyboardAvoidingShell';"));
  assert.ok(!ANIMATED_KEYBOARD.test('  const keyboardVisible = useKeyboardVisible();'));

  // Y el chequeo de USO del primitivo distingue el JSX del import (si no, el test miente sobre lo que mira).
  assert.ok(SHELL_OPEN.test('      <KeyboardAvoidingShell style={fillStyle}>'));
  assert.ok(SHELL_CLOSE.test('      </KeyboardAvoidingShell>'));
  assert.ok(!SHELL_OPEN.test("import { KeyboardAvoidingShell } from './KeyboardAvoidingShell';"));
  assert.ok(!SHELL_CLOSE.test("import { KeyboardAvoidingShell } from './KeyboardAvoidingShell';"));
  assert.ok(!SHELL_OPEN.test('  const Shell = KeyboardAvoidingShell;'));
  assert.ok(!SHELL_CLOSE.test('      <KeyboardAvoidingShell style={fillStyle}>'));

  // Una mención en un comentario tampoco (se blanquea antes de escanear).
  assert.ok(!RN_KAV.test(stripComments(`// antes: <${KAV} behavior='padding'>`)));
  assert.ok(!RN_KAV.test(stripComments(`/* el ${KAV} de RN es un no-op en Android */`)));

  // La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// keyboard-avoiding-disable-next-line -- caso con offset propio'));
  assert.ok(!DISABLE_NEXT_LINE.test('// keyboard-avoiding-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// keyboard-avoiding-disable-next-line --'));
});

test('el guard recorre el árbol real (y ve los archivos que tenían la copia)', () => {
  const scanned = ROOTS.flatMap(listFiles);
  assert.ok(scanned.length > 50, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  const rels = new Set(scanned.map((f) => relative(APP_ROOT, f).split(sep).join('/')));
  for (const expected of [...CALL_SITES, SHELL_BASE, SHELL_ANDROID]) {
    assert.ok(rels.has(expected), `${expected} tiene que existir con ese path exacto y estar dentro del escaneo`);
  }
});
