// GUARD: nunca se le pasa a `runOnJS`/`scheduleOnRN` un MÉTODO de un objeto/módulo (`X.y`).
//
// ── EL BUG QUE CIERRA (crash 🔴 en device, Raf, iOS build 76f0837c, 2026-07-25) ──────────────────────
// `BottomSheetShell` hacía `runOnJS(Keyboard.dismiss)()` en el `onStart` del arrastre. Arrastrar el
// grabber CON EL TECLADO ABIERTO **crasheaba la app entera** (crash nativo, no error de JS). Mecanismo,
// verificado sobre la salida REAL de babel + el serializador de `react-native-worklets` 0.8.3:
//   1. El plugin de worklets captura en el `__closure` el IDENTIFICADOR RAÍZ de la expresión → capturaba
//      el objeto `Keyboard` ENTERO (instancia de la clase `KeyboardImpl` de RN), no la función.
//   2. `createSerializable` (`memory/serializable.native.js`) solo clona objetos con prototipo
//      `Object.prototype`, host objects y TurboModules. Una instancia de clase cae en
//      `inaccessibleObject()`: en el runtime de UI queda un **Proxy que tira ante CUALQUIER acceso**.
//   3. Por eso no explotaba al montar (el proxy se crea callado) sino al LEER `Keyboard.dismiss`, o sea
//      solo en la rama del teclado abierto; y un throw dentro de un callback de gesto en el hilo de UI,
//      en release, no burbujea como error de JS: revienta nativo.
// El fix es siempre el mismo: envolver en un callback JS propio y estable
// (`const dismissKeyboard = useCallback(() => { Keyboard.dismiss(); }, [])`) y pasar ESE.
//
// ── POR QUÉ UN GUARD Y NO "acordate" ────────────────────────────────────────────────────────────────
// Es una clase de bug que NINGÚN test nuestro puede cazar: en react-native-web `runOnJS` es casi un
// no-op, así que las 51 E2E pasaron con el crash adentro, y el unit no monta worklets. Lo único
// verificable de forma barata y determinista es la FIRMA en el código. Vive como test (no como script
// nuevo) porque `scripts/check.mjs` ya corre la suite unitaria — mismo patrón que
// `phone-field-guard.test.ts`. ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`:
// un guard que no corre da falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/**
 * Primer argumento de `runOnJS`/`scheduleOnRN` que es un ACCESO A PROPIEDAD (`X.y`, `X?.y`): eso captura
 * `X` entero en el closure del worklet. Un identificador pelado (`runOnJS(onClose)`) es lo correcto.
 */
const CALLBACK_SIGNATURE = /\b(?:runOnJS|scheduleOnRN)\s*\(\s*[A-Za-z_$][\w$]*\s*\??\.\s*[A-Za-z_$][\w$]*/;

/** Válvula de escape por línea, con justificación (mismo patrón que check-hardcode.mjs / phone-field). */
const DISABLE_NEXT_LINE = /worklet-callback-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /worklet-callback-disable-line\s*--\s*\S/;

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
      // Los .test.* quedan fuera: este mismo archivo contiene la firma en sus regexes y en sus casos
      // sintéticos (se auto-reportaría).
      found.push(p);
    }
  }
  return found;
}

/**
 * Blanquea comentarios (de línea y de bloque) preservando los saltos de línea, para que una MENCIÓN en
 * un comentario —como la del propio `BottomSheetShell`, que documenta el crash citando la línea mala—
 * no dispare un falso positivo.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

test('ningún worklet le pasa a runOnJS/scheduleOnRN un método de módulo (crashea nativo en device)', () => {
  const violations: string[] = [];

  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split(/\r?\n/);
      const lines = stripComments(raw).split(/\r?\n/);
      const rel = relative(APP_ROOT, file).split(sep).join('/');

      lines.forEach((line, i) => {
        if (!CALLBACK_SIGNATURE.test(line)) return;
        const here = rawLines[i] ?? '';
        const previous = rawLines[i - 1] ?? '';
        if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) return;
        violations.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
  }

  assert.deepEqual(
    violations,
    [],
    'Se le está pasando un MÉTODO (`X.y`) a runOnJS/scheduleOnRN. Eso captura `X` ENTERO en el closure ' +
      'del worklet; si `X` no es un objeto plano (un módulo de RN, una instancia de clase), en el runtime ' +
      'de UI queda un proxy que TIRA al primer acceso → crash NATIVO, no error de JS (pasó con ' +
      '`runOnJS(Keyboard.dismiss)` en BottomSheetShell). Envolvelo en un callback JS estable: ' +
      '`const f = useCallback(() => X.y(), [])` y pasá `runOnJS(f)`. Si el caso es legítimo, justificalo ' +
      'con `// worklet-callback-disable-next-line -- <razón>`.\n' +
      violations.join('\n'),
  );
});

test('el guard DETECTA la firma (no pasa verde por no estar mirando nada)', () => {
  // Un guard que no puede fallar es un guard muerto. Lo verificamos sobre contenido sintético — incluida
  // la línea EXACTA que crasheó en device — sin tocar el árbol real.
  assert.ok(CALLBACK_SIGNATURE.test('runOnJS(Keyboard.dismiss)();'), 'la línea del crash debe detectarse');
  assert.ok(CALLBACK_SIGNATURE.test('  runOnJS( Clipboard.setString )(x);'));
  assert.ok(CALLBACK_SIGNATURE.test('scheduleOnRN(router.back);'));
  assert.ok(CALLBACK_SIGNATURE.test('runOnJS(nav?.goBack)();'));

  // Lo correcto NO dispara: identificador pelado (callback JS propio o prop del componente).
  assert.ok(!CALLBACK_SIGNATURE.test('runOnJS(dismissKeyboard)();'));
  assert.ok(!CALLBACK_SIGNATURE.test('if (dismiss) runOnJS(onClose)();'));
  assert.ok(!CALLBACK_SIGNATURE.test('runOnJS(commit)(index, myPos.value);'));

  // Una mención en un comentario tampoco (se blanquea antes de escanear).
  assert.ok(!CALLBACK_SIGNATURE.test(stripComments('// NUNCA hagas runOnJS(Keyboard.dismiss)')));
  assert.ok(!CALLBACK_SIGNATURE.test(stripComments('/* runOnJS(Keyboard.dismiss) */')));

  // La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// worklet-callback-disable-next-line -- objeto plano, serializable'));
  assert.ok(!DISABLE_NEXT_LINE.test('// worklet-callback-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// worklet-callback-disable-next-line --'));
});

test('el guard recorre el árbol real (y ve los archivos que tienen worklets)', () => {
  const scanned = ROOTS.flatMap(listFiles);
  assert.ok(scanned.length > 50, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  assert.ok(
    scanned.some((f) => f.endsWith(join('src', 'components', 'BottomSheetShell.tsx'))),
    'BottomSheetShell.tsx (el del crash) debería estar dentro del árbol escaneado',
  );
  assert.ok(
    scanned.some((f) => f.endsWith(join('_components', 'ManeuverReorderList.tsx'))),
    'ManeuverReorderList.tsx (el otro archivo con worklets + runOnJS) debería estar dentro del árbol',
  );
});
