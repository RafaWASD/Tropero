// GUARD DEL TECLADO — dos preguntas, no una.
//
//   REGLA A (la vieja): ¿alguien usa MAL el componente de React Native? → prohibido fuera del primitivo.
//   REGLA B (la nueva): ¿hay algún CAMPO DE TEXTO que no esté adentro del primitivo?
//
// ── POR QUÉ HUBO QUE DARLO VUELTA ────────────────────────────────────────────────────────────────────
// La primera versión de este guard solo hacía la pregunta A. Cerró la población de los 4 archivos que
// montaban un `KeyboardAvoiding` + `View` MAL CONFIGURADO (behavior sin definir → `<View>` pelado en
// Android). Raf lo verificó en device: el sheet de Vacunación sube. Y **enseguida encontró el mismo bug**
// en `app/maniobra/identificar.tsx`, que no montaba NINGÚN mecanismo.
// O sea: había una SEGUNDA población —superficies con AUSENCIA total de mecanismo— que la pregunta A no
// puede ver por construcción: busca el uso incorrecto de un componente, no la FALTA de él. Eran 23
// superficies, incluidas 7 🔴 de la manga. El default de una pantalla nueva con un input era, en silencio,
// "rota en Android y en iOS".
//
// La pregunta B es la correcta, y es la que sí ve una pantalla que alguien escriba dentro de 6 meses:
// enumerar estáticamente TODO lo que renderiza una entrada de texto y exigir que cada archivo esté
// CLASIFICADO. Sin clasificar = ROJO.
//
// ── EL MODELO (todo computado; lo único declarado a mano son las excepciones y las PARTES) ───────────
//  · SEMILLA        — archivos con JSX de entrada de texto directo (`<TextInput>`, `<Input>`,
//                     `<TextArea>`; en RN toda entrada de texto termina en `TextInput`, y los `Input`/
//                     `TextArea` de Tamagui son `styled(TextInput)`) **o** con el handler `onChangeText`
//                     (la prop que solo existe en esa familia). La segunda señal NO es redundante: tapa
//                     el import ALIASEADO (`import { TextInput as Campo }` → `<Campo/>`), que el tag no
//                     ve. ⚠️ La semilla NO es "completa por construcción" —eso se afirmó de más en la
//                     primera versión y se falsificó con ese mismo caso—; ver el bloque de "Detección de
//                     ENTRADA DE TEXTO" más abajo para lo que sí garantiza y lo que queda como límite.
//  · CIERRE         — si un archivo monta un componente exportado por un archivo con obligación NO
//                     resuelta, hereda la obligación. Así entran los consumidores de `FormField`,
//                     `GroupSearchBar`, `CustomFieldInput`, etc.
//  · PROVEEDOR      — COMPUTADO por punto fijo desde el primitivo: un archivo que ABRE Y CIERRA
//                     `<KeyboardAvoidingShell>`, o que abre y cierra un componente exportado por otro
//                     proveedor (así `FooterActionShell`/`BottomSheetShell`/`AuthScreenShell` son
//                     proveedores, y las pantallas que los envuelven también). **Nada de listas de
//                     "lo cubre X" escritas a mano**: si un shell intermedio deja de montar el primitivo,
//                     deja de ser proveedor y TODO lo que colgaba de él cae en rojo, que es justamente la
//                     falsificación (c) de abajo.
//  · PARTE          — declarado: un componente de entrada REUSABLE que no es una superficie y no puede
//                     cubrirse a sí mismo (un `FormField` no puede envolver la pantalla). No es
//                     violación, y PROPAGA la obligación a quien lo monte.
//  · EXCEPCIÓN      — declarado con motivo escrito Y con un marcador que tiene que estar en la cabecera
//                     del propio archivo (para que la excepción no pueda vivir solo en este test).
//  · VIOLACIÓN      — cualquier otro archivo del cierre.
//
// ── LÍMITE DECLARADO (granularidad de ARCHIVO) ───────────────────────────────────────────────────────
// El guard verifica que un archivo monte UN contenedor con keyboard-avoidance, no que CADA input esté
// adentro de ese contenedor. El caso real que lo motiva: `crear-animal.tsx` monta `<FooterActionShell>`
// y además monta `<LinkCalfPrompt>` FUERA de su cierre — para este guard el archivo estaba cubierto, y
// el prompt igual quedaba tapado por el teclado. Se cerró dándole al prompt su propio shell (es un sheet:
// corresponde). Un parser de JSX que ubique cada input en el árbol sería la versión fuerte; el costo no se
// paga hoy y el modo de falla queda escrito acá.
//
// ── POR QUÉ UN GUARD ESTÁTICO Y NO UN TEST QUE REPRODUZCA EL SÍNTOMA ─────────────────────────────────
// Porque el síntoma es INVISIBLE EN WEB: react-native-web no monta teclado virtual (`Keyboard` nunca
// emite y el componente de RN es un `<View>` inerte), así que la E2E entera pasa en verde con el bug
// adentro. El veredicto real es DEVICE. La única verificación barata y determinista es la FIRMA en el
// código. Mismo espíritu que `safe-bottom-inset-guard.test.ts` y `worklet-callbacks-guard.test.ts`.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../utils/strip-comments';
import { assertScanCoverage } from '../utils/scan-coverage';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/**
 * Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Hoy son **364**. El piso está ~17%
 * abajo: tolera que se borre un puñado de archivos, pero se pone ROJO si el listado se rompe o si una
 * carpeta entera deja de matchear. Ver `utils/scan-coverage.ts` para el porqué.
 */
const SCANNED_FILES_FLOOR = 300;

/** El primitivo: base (iOS + web) y la implementación de Android que el bundler elige por extensión. */
const SHELL_BASE = 'src/components/KeyboardAvoidingShell.tsx';
const SHELL_ANDROID = 'src/components/KeyboardAvoidingShell.android.tsx';
/** El nombre del componente del primitivo (la raíz del punto fijo de proveedores). */
const SHELL = 'KeyboardAvoidingShell';

/**
 * Los shells DERIVADOS: no tienen nada de especial para el motor (los descubre solo), pero se listan para
 * que el mensaje de error nombre al culpable correcto cuando uno deja de montar el primitivo — son los que
 * sostienen la cobertura de decenas de pantallas de una sola vez.
 */
const DERIVED_SHELLS = [
  'src/components/FooterActionShell.tsx',
  'src/components/BottomSheetShell.tsx',
  'src/components/AuthScreenShell.tsx',
];

/**
 * PARTES: componentes de entrada reusables que NO son superficies. No pueden montar el primitivo (no son
 * dueños de la pantalla), así que su obligación PASA a cada archivo que los monta — y el motor exige que
 * ESE archivo esté cubierto. Cada entrada lleva su motivo.
 */
const INPUT_PARTS: Record<string, string> = {
  'src/components/FormField.tsx':
    'campo de formulario reusable (label + input + error inline). Lo cubre la pantalla/sheet que lo monta.',
  'src/components/PhoneField.tsx': 'campo de teléfono (compone FormField). Misma razón.',
  'src/components/GroupSearchBar.tsx':
    'buscador + chips de la vista de grupo. Es una banda dentro de la pantalla; lo cubre `GroupViewScreen`.',
  'src/components/IdentifierAssignRow.tsx':
    'fila de carga manual de la caravana. Vive dentro de la ficha del animal.',
  'app/lote/_components/BatchSaleAnimalRow.tsx':
    'fila (precio/peso) de la lista de venta por lote. La cubre `lote/venta.tsx`.',
  'app/maniobra/_components/CustomFieldInput.tsx':
    'input de un dato personalizado, según su tipo. Lo cubren `maniobra/carga` y la ficha (vía CustomPropertiesSection).',
  'app/maniobra/_components/CustomPropertiesSection.tsx':
    'sección "Datos personalizados" (form y ficha). La cubren `crear-animal` y `animal/[id]`.',
  'app/maniobra/_components/CircunferenciaEscrotalStep.tsx': 'paso del wizard de maniobra. Lo cubre `maniobra/carga`.',
  'app/maniobra/_components/CustomManeuverStep.tsx': 'paso del wizard de maniobra. Lo cubre `maniobra/carga`.',
  'app/maniobra/_components/LabDoubleStep.tsx': 'paso del wizard de maniobra. Lo cubre `maniobra/carga`.',
  'app/maniobra/_components/LabSampleStep.tsx': 'paso del wizard de maniobra. Lo cubre `maniobra/carga`.',
  'app/maniobra/_components/SilentSanitaryStep.tsx': 'paso del wizard de maniobra. Lo cubre `maniobra/carga`.',
  'app/maniobra/_components/InseminacionStep.tsx': 'paso del wizard de maniobra (compone SilentSanitaryStep).',
};

/**
 * EXCEPCIONES: archivos con input que NO necesitan cobertura, con el motivo escrito. El `marker` tiene que
 * aparecer en el propio archivo: así la excepción está declarada TAMBIÉN donde la va a leer el que abra el
 * archivo, y no se puede sostener una excepción falsa desde este test.
 */
const EXEMPT: Record<string, { reason: string; marker: string }> = {
  'app/baston-test.tsx': {
    reason: 'harness de DEV/TEST del bastón (no es producción; se usa en web con notebook, sin teclado virtual)',
    marker: 'HARNESS DE DEV/TEST',
  },
  'app/maniobra/rueda-ce.tsx': {
    reason: 'design spike 100% mock para el veto visual del leader (no navegable en producción)',
    marker: 'DESIGN SPIKE',
  },
};

// ── Detección de ENTRADA DE TEXTO ───────────────────────────────────────────────────────────────────
// Dos señales, en OR:
//   (a) el TAG JSX: `<TextInput>` (React Native) + `<Input>`/`<TextArea>` (Tamagui, que son
//       `styled(TextInput)`). Es la señal directa y la que nombra el componente real.
//   (b) el HANDLER `onChangeText`: la prop que SOLO existe en la familia `TextInput` de RN. Cubre el
//       agujero del tag: `import { TextInput as Campo } from 'react-native'` renderiza `<Campo/>`, que
//       (a) no ve. Un componente que recibe/pasa `onChangeText` está en la cadena de una entrada de
//       texto, y eso alcanza para exigirle clasificación.
//
// ⚠️ ALCANCE REAL DE LA SEMILLA (afirmación corregida en el 2º fix-loop) — NO es "completa por
// construcción". Lo que sí es verdad: en RN toda entrada de texto termina en un `TextInput`, así que
// existe SIEMPRE un archivo raíz que lo importa; y el CIERRE por montaje propaga la obligación desde ese
// archivo a todos sus consumidores. Lo que la semilla puede no ver es el NOMBRE con el que ese archivo
// raíz lo escribe: un alias de import (`as Campo`), un `React.createElement(TextInput, …)`, un
// `styled(TextInput)` re-exportado desde una lib de terceros. La señal (b) tapa el caso del alias —que es
// el único que apareció al falsificar— y el resto queda declarado acá como límite conocido, no como
// garantía. Contra-chequeo del árbol real: con el oráculo independiente
// `onChangeText|keyboardType=|secureTextEntry|multiline=|autoCapitalize=` no queda NINGÚN archivo sin
// clasificar (ver el test "la semilla no se queda corta contra un oráculo independiente").
const TEXT_ENTRY_TAGS = ['TextInput', 'Input', 'TextArea'] as const;
const TEXT_ENTRY_HANDLER = 'onChangeText';
const TEXT_ENTRY = new RegExp(`<(?:${TEXT_ENTRY_TAGS.join('|')})\\b|\\b${TEXT_ENTRY_HANDLER}\\b`);

// ⚠️ Las firmas prohibidas de la REGLA A se ARMAN POR CONCATENACIÓN a propósito (mismo truco que el guard
// de la reserva inferior): así este archivo NO contiene la cadena literal del componente de RN y un grep de
// aceptación sobre `app/src` + `app/app` sigue devolviendo exactamente UN archivo (el primitivo) en vez de
// reportar al propio guard. El costo es leerlo una vez; el beneficio es que el grep no miente.
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

const relOf = (file: string) => relative(APP_ROOT, file).split(sep).join('/');

/**
 * El árbol REAL, con los comentarios blanqueados (una mención documental no es ni un input ni un shell).
 * El blanqueo usa el escáner con estado de `utils/strip-comments` y NO el par de regexes que tenían los
 * guards viejos: ese par abría un bloque FALSO ante un `/*` escrito dentro de un comentario de línea y se
 * comía las líneas 91–229 de `FindOrCreateOverlay.tsx` (84 de ellas código) —justo una de las pantallas
 * 🔴 de esta unidad— sin que nada lo delatara. Ver el header de `strip-comments.ts` para la medición
 * completa (556 líneas de código invisibles en 6 archivos, con la métrica declarada).
 */
function readTree(): Map<string, string> {
  const tree = new Map<string, string>();
  for (const file of ROOTS.flatMap(listFiles)) {
    tree.set(relOf(file), stripSourceComments(readFileSync(file, 'utf8')));
  }
  return tree;
}

/** Nombres PascalCase exportados por cada archivo (los únicos que otro archivo puede montar). */
const EXPORTED_DECL = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z]\w*)/g;
function exportOwners(tree: Map<string, string>): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const [rel, src] of tree) {
    for (const m of src.matchAll(EXPORTED_DECL)) {
      if (!owners.has(m[1])) owners.set(m[1], new Set());
      owners.get(m[1])!.add(rel);
    }
  }
  return owners;
}

/** Tags JSX PascalCase que un archivo ABRE Y CIERRA (envolver, no solo mencionar ni auto-cerrar). */
function wrappingTags(src: string): Set<string> {
  const wrapping = new Set<string>();
  for (const m of src.matchAll(/<([A-Z]\w*)\b/g)) {
    if (new RegExp(`</${m[1]}>`).test(src)) wrapping.add(m[1]);
  }
  return wrapping;
}

/** Tags JSX PascalCase que un archivo MONTA (abra y cierre o no). */
function mountedTags(src: string): Set<string> {
  return new Set([...src.matchAll(/<([A-Z]\w*)\b/g)].map((m) => m[1]));
}

/**
 * PROVEEDORES de keyboard-avoidance, por PUNTO FIJO desde el primitivo: el que abre y cierra
 * `<KeyboardAvoidingShell>`, y el que abre y cierra un componente exportado por un proveedor.
 * Es lo que hace que la cadena no se pudra: la cobertura de `sign-in.tsx` no es una declaración, es la
 * consecuencia de que `AuthScreenShell` siga montando el primitivo.
 */
function computeProviders(tree: Map<string, string>, owners: Map<string, Set<string>>): Set<string> {
  const providers = new Set<string>();
  const wrapping = new Map<string, Set<string>>();
  for (const [rel, src] of tree) wrapping.set(rel, wrappingTags(src));

  let changed = true;
  while (changed) {
    changed = false;
    // Nombres que, si los envolvés, te vuelven proveedor: el primitivo + lo que exporta un proveedor.
    const providerNames = new Set<string>([SHELL]);
    for (const p of providers) {
      for (const [name, files] of owners) if (files.has(p)) providerNames.add(name);
    }
    for (const [rel, tags] of wrapping) {
      if (providers.has(rel)) continue;
      for (const name of providerNames) {
        if (tags.has(name)) {
          providers.add(rel);
          changed = true;
          break;
        }
      }
    }
  }
  return providers;
}

/** El universo de archivos con obligación de keyboard-avoidance (semilla + cierre por montaje). */
function computeInputFiles(
  tree: Map<string, string>,
  owners: Map<string, Set<string>>,
  providers: Set<string>,
): { files: Set<string>; via: Map<string, string> } {
  const files = new Set<string>();
  const via = new Map<string, string>();
  for (const [rel, src] of tree) if (TEXT_ENTRY.test(src)) files.add(rel);

  /** Un archivo RESUELVE su obligación (y deja de propagarla) si está cubierto o exento. */
  const resolved = (rel: string) => providers.has(rel) || rel in EXEMPT;

  let changed = true;
  while (changed) {
    changed = false;
    const propagating = new Map<string, string>(); // nombre exportado -> archivo dueño (no resuelto)
    for (const rel of files) {
      if (resolved(rel)) continue;
      for (const [name, ownerFiles] of owners) if (ownerFiles.has(rel)) propagating.set(name, rel);
    }
    for (const [rel, src] of tree) {
      if (files.has(rel)) continue;
      const tags = mountedTags(src);
      for (const [name, owner] of propagating) {
        if (tags.has(name)) {
          files.add(rel);
          via.set(rel, `${name} (${owner})`);
          changed = true;
          break;
        }
      }
    }
  }
  return { files, via };
}

function scan(tree: Map<string, string>, predicate: (line: string, rel: string) => boolean): string[] {
  const violations: string[] = [];
  for (const [rel, stripped] of tree) {
    const raw = readFileSync(join(APP_ROOT, ...rel.split('/')), 'utf8');
    const rawLines = raw.split(/\r?\n/);
    stripped.split(/\r?\n/).forEach((line, i) => {
      if (!predicate(line, rel)) return;
      const here = rawLines[i] ?? '';
      const previous = rawLines[i - 1] ?? '';
      if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) return;
      violations.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
  return violations;
}

function readShell(rel: string): string {
  const p = join(APP_ROOT, ...rel.split('/'));
  assert.ok(existsSync(p), `falta ${rel}: el primitivo del teclado tiene que existir con ese path exacto`);
  return stripSourceComments(readFileSync(p, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGLA B — LA NUEVA: ningún campo de texto queda afuera del primitivo
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

test('REGLA B: TODO archivo con un campo de texto está clasificado (cubierto / parte / excepción)', () => {
  const tree = readTree();
  const owners = exportOwners(tree);
  const providers = computeProviders(tree, owners);
  const { files, via } = computeInputFiles(tree, owners, providers);

  const violations = [...files]
    .filter((rel) => !providers.has(rel) && !(rel in INPUT_PARTS) && !(rel in EXEMPT))
    .sort()
    .map((rel) => `${rel}${via.has(rel) ? `  (hereda el input de ${via.get(rel)})` : '  (input directo)'}`);

  assert.deepEqual(
    violations,
    [],
    'Estos archivos renderizan un campo de texto y NO están adentro de ningún contenedor con ' +
      'keyboard-avoidance. En Android (edge-to-edge: la ventana NO se encoge) y en iOS (el teclado se ' +
      'dibuja encima sin empujar nada) el teclado les TAPA el contenido, y ninguna E2E lo puede ver: ' +
      'react-native-web no monta teclado virtual. Tres salidas, en este orden:\n' +
      `  1. es una SUPERFICIE (pantalla o sheet) → envolvela: \`<${SHELL} style={fillStyle}> … </${SHELL}>\`` +
      ' (o usá `FooterActionShell` / `BottomSheetShell`, que ya lo montan);\n' +
      '  2. es una PARTE reusable que no puede cubrirse sola (un campo, una fila, un paso) → agregala a ' +
      '`INPUT_PARTS` con su motivo; el guard va a exigir cobertura en CADA archivo que la monte;\n' +
      '  3. no es producción (harness/spike) → agregala a `EXEMPT` con motivo Y con el marcador escrito ' +
      'en la cabecera del propio archivo.\n' +
      '⚠️ No se anidan dos shells: un sheet que se monta como overlay va HERMANO del shell de la pantalla, ' +
      'no adentro (si no, se descuenta el teclado dos veces).',
  );
});

test('REGLA B: el motor VE el árbol real y encuentra las superficies que esta unidad arregló', () => {
  // Un motor que mira un árbol vacío da verde por vacuidad. Se ancla contra archivos concretos.
  const tree = readTree();
  const owners = exportOwners(tree);
  const providers = computeProviders(tree, owners);
  const { files } = computeInputFiles(tree, owners, providers);

  assert.ok(tree.size > 50, `el guard debería escanear el árbol real (vio ${tree.size} archivos)`);
  assert.ok(files.size > 20, `el cierre debería tener decenas de archivos con input (vio ${files.size})`);

  // La semilla tiene que incluir la pantalla del reporte de Raf y el sheet global del paso siguiente…
  for (const expected of [
    'app/maniobra/identificar.tsx', // el reporte 🔴 que abrió esta unidad
    'app/_components/FindOrCreateOverlay.tsx',
    'app/(tabs)/animales.tsx',
    'src/components/FormField.tsx',
  ]) {
    assert.ok(files.has(expected), `${expected} tiene que estar en el cierre de archivos con input`);
  }
  // …y esas superficies tienen que estar CUBIERTAS (no solo clasificadas).
  for (const expected of [
    'app/maniobra/identificar.tsx',
    'app/_components/FindOrCreateOverlay.tsx',
    'app/(tabs)/animales.tsx',
    'app/maniobra/_components/SugerenciaVaciasSheet.tsx',
    'src/components/TagScanSheet.tsx',
    'app/asignar-caravanas.tsx',
    'app/vacunacion-masiva.tsx',
  ]) {
    assert.ok(providers.has(expected), `${expected} tiene que montar el primitivo (o un shell que lo monte)`);
  }

  // El CIERRE tiene que atravesar los wrappers: `FormField` no se cubre solo, y sus consumidores heredan.
  assert.ok(files.has('app/lotes.tsx'), 'el consumidor de FormField hereda la obligación');
  assert.ok(files.has('src/components/GroupViewScreen.tsx'), 'GroupSearchBar propaga a la pantalla que la monta');
});

test('REGLA B: los shells DERIVADOS siguen montando el primitivo (si no, arrastran a media app)', () => {
  // Es la cadena de la que cuelga la cobertura de decenas de pantallas: `sign-in.tsx` está cubierto porque
  // `AuthScreenShell` monta el primitivo, no porque alguien lo haya declarado en una lista.
  const tree = readTree();
  const owners = exportOwners(tree);
  const providers = computeProviders(tree, owners);
  const missing = DERIVED_SHELLS.filter((rel) => !providers.has(rel));
  assert.deepEqual(
    missing,
    [],
    `Estos shells son la cobertura de decenas de pantallas: cada uno tiene que ABRIR Y CERRAR ` +
      `\`<${SHELL}>\` alrededor de su contenido. Dejar solo el import (o un self-closing) no levanta nada, ` +
      'y todo lo que cuelga de ellos se queda tapado por el teclado sin que caiga ninguna E2E.',
  );
  // Y el punto fijo tiene que estar ANCLADO en el primitivo: si el archivo del primitivo desaparece o se
  // renombra, no hay proveedores y todo cae (fail-closed, no verde por vacuidad).
  assert.ok(providers.size > DERIVED_SHELLS.length, 'el punto fijo tiene que alcanzar a las pantallas');
});

test('REGLA B: las clasificaciones declaradas son honestas (partes que existen, excepciones marcadas)', () => {
  const tree = readTree();

  // Una PARTE que ya no tiene input (o que se borró) es una entrada muerta que solo sirve para tapar.
  for (const [rel, reason] of Object.entries(INPUT_PARTS)) {
    assert.ok(tree.has(rel), `INPUT_PARTS declara \`${rel}\`, que no existe: sacá la entrada`);
    assert.ok(reason.trim().length > 20, `la parte \`${rel}\` necesita un motivo escrito, no una etiqueta`);
  }

  // Una EXCEPCIÓN tiene que estar declarada TAMBIÉN en el archivo: el que lo abre tiene que enterarse ahí
  // de que esa pantalla no está cubierta a propósito, sin venir a leer este test.
  for (const [rel, { reason, marker }] of Object.entries(EXEMPT)) {
    assert.ok(tree.has(rel), `EXEMPT declara \`${rel}\`, que no existe: sacá la entrada`);
    assert.ok(reason.trim().length > 20, `la excepción \`${rel}\` necesita un motivo escrito`);
    const raw = readFileSync(join(APP_ROOT, ...rel.split('/')), 'utf8');
    assert.ok(
      raw.includes(marker),
      `la excepción de \`${rel}\` dice "${marker}" pero el archivo no lo declara en su cabecera: ` +
        'una excepción que solo vive en el test es una excepción que nadie ve al editar el archivo',
    );
  }
});

test('REGLA B: el motor DETECTA (no pasa verde por no estar mirando nada)', () => {
  // El motor se ejercita sobre un árbol SINTÉTICO, sin tocar el repo: si la detección se rompe, esto cae.
  const owners = (tree: Map<string, string>) => exportOwners(tree);

  // (a) Pantalla nueva con un TextInput y sin nada más → violación.
  const nueva = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['app/nueva.tsx', 'export function Nueva() { return <TextInput />; }'],
  ]);
  {
    const o = owners(nueva);
    const p = computeProviders(nueva, o);
    const { files } = computeInputFiles(nueva, o, p);
    assert.ok(files.has('app/nueva.tsx'));
    assert.ok(!p.has('app/nueva.tsx'), 'sin el shell, la pantalla nueva NO puede contar como cubierta');
  }

  // (b) La misma pantalla envolviendo el primitivo → cubierta.
  const cubierta = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['app/nueva.tsx', `export function Nueva() { return <${SHELL}><TextInput /></${SHELL}>; }`],
  ]);
  {
    const o = owners(cubierta);
    const p = computeProviders(cubierta, o);
    assert.ok(p.has('app/nueva.tsx'));
  }

  // (c) Cadena de 3: el primitivo → un shell derivado → una pantalla. Si el shell derivado deja de montar
  //     el primitivo, la PANTALLA (que no cambió una línea) deja de estar cubierta. Es el modo de falla
  //     que ninguna lista escrita a mano puede ver.
  const cadenaOk = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['src/components/MiShell.tsx', `export function MiShell() { return <${SHELL}><View /></${SHELL}>; }`],
    ['app/pantalla.tsx', 'export function Pantalla() { return <MiShell><TextInput /></MiShell>; }'],
  ]);
  {
    const o = owners(cadenaOk);
    const p = computeProviders(cadenaOk, o);
    assert.ok(p.has('app/pantalla.tsx'), 'la pantalla hereda la cobertura del shell derivado');
  }
  const cadenaRota = new Map(cadenaOk);
  cadenaRota.set('src/components/MiShell.tsx', 'export function MiShell() { return <View />; }');
  {
    const o = owners(cadenaRota);
    const p = computeProviders(cadenaRota, o);
    const { files } = computeInputFiles(cadenaRota, o, p);
    assert.ok(!p.has('app/pantalla.tsx'), 'shell derivado sin el primitivo → la pantalla NO está cubierta');
    assert.ok(files.has('app/pantalla.tsx'), 'y sigue teniendo la obligación → sería violación');
  }

  // (d) Una PARTE propaga la obligación a quien la monta.
  const conParte = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['src/components/MiCampo.tsx', 'export function MiCampo() { return <TextInput />; }'],
    ['app/consumidor.tsx', 'export function Consumidor() { return <MiCampo />; }'],
  ]);
  {
    const o = owners(conParte);
    const p = computeProviders(conParte, o);
    const { files } = computeInputFiles(conParte, o, p);
    assert.ok(files.has('app/consumidor.tsx'), 'el consumidor de una parte hereda la obligación');
  }
  // …y NO propaga a través de un consumidor que SÍ está cubierto (la cadena se corta donde se resuelve).
  const conParteCubierta = new Map(conParte);
  conParteCubierta.set(
    'app/consumidor.tsx',
    `export function Consumidor() { return <${SHELL}><MiCampo /></${SHELL}>; }`,
  );
  conParteCubierta.set('app/abuelo.tsx', 'export function Abuelo() { return <Consumidor />; }');
  {
    const o = owners(conParteCubierta);
    const p = computeProviders(conParteCubierta, o);
    const { files } = computeInputFiles(conParteCubierta, o, p);
    assert.ok(!files.has('app/abuelo.tsx'), 'un consumidor cubierto no le pasa la obligación a su padre');
  }

  // (e) Un self-closing NO cubre: el primitivo sirve ENVOLVIENDO contenido.
  const selfClosing = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['app/nueva.tsx', `export function Nueva() { return <><${SHELL} /><TextInput /></>; }`],
  ]);
  {
    const o = owners(selfClosing);
    assert.ok(!computeProviders(selfClosing, o).has('app/nueva.tsx'));
  }

  // (f) Un import NO cubre (el modo de falla que dejaba pasar la versión anterior del guard).
  const soloImport = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['app/nueva.tsx', `import { ${SHELL} } from './x';\nexport function Nueva() { return <TextInput />; }`],
  ]);
  {
    const o = owners(soloImport);
    assert.ok(!computeProviders(soloImport, o).has('app/nueva.tsx'));
  }

  // (g) Una mención en un comentario no crea ni un input ni una cobertura (los comentarios van blanqueados).
  assert.ok(!TEXT_ENTRY.test(stripSourceComments('// antes acá había un <TextInput />')));
  assert.ok(!wrappingTags(stripSourceComments(`/* <${SHELL}> … </${SHELL}> */`)).has(SHELL));

  // (h) La detección del JSX de entrada de texto cubre las 3 formas y no se dispara de más.
  assert.ok(TEXT_ENTRY.test('  <TextInput value={v} />'));
  assert.ok(TEXT_ENTRY.test('  <Input size="$4" />'));
  assert.ok(TEXT_ENTRY.test('  <TextArea rows={3} />'));
  assert.ok(!TEXT_ENTRY.test("import { TextInput } from 'react-native';"), 'un import no renderiza nada');
  assert.ok(!TEXT_ENTRY.test('  <InputRow />'), 'otro componente que arranca igual no cuenta');

  // (i) EL AGUJERO DEL TAG, cerrado: un import ALIASEADO renderiza una entrada de texto con OTRO nombre,
  //     así que la señal del tag no lo ve. Es el caso con el que se falsificó la afirmación "la semilla es
  //     completa por construcción" (que era falsa). Lo caza el handler `onChangeText`.
  const aliasado = [
    "import { TextInput as Campo } from 'react-native';",
    'export function Falsificacion() {',
    '  return <Campo value={v} onChangeText={setV} />;',
    '}',
  ].join('\n');
  assert.ok(!new RegExp(`<(?:${TEXT_ENTRY_TAGS.join('|')})\\b`).test(aliasado), 'el TAG solo NO lo ve');
  assert.ok(TEXT_ENTRY.test(aliasado), 'el handler `onChangeText` SÍ tiene que verlo');
  // Y sobre el motor entero, no solo sobre el regex: una pantalla así, sin clasificar, es violación.
  const conAlias = new Map<string, string>([
    [SHELL_BASE, `export function ${SHELL}() { return null; }`],
    ['app/aliaseada.tsx', aliasado],
  ]);
  {
    const o = owners(conAlias);
    const p = computeProviders(conAlias, o);
    const { files } = computeInputFiles(conAlias, o, p);
    assert.ok(files.has('app/aliaseada.tsx'), 'la pantalla con el import aliaseado entra en el cierre');
    assert.ok(!p.has('app/aliaseada.tsx'), 'y no está cubierta → violación');
  }
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  // Un verificador roto y un verificador que no encuentra nada se ven igual: verde. Acá el guard audita
  // su propia entrada — cuántos archivos vio y si los vio completos. Detalle en `utils/scan-coverage.ts`.
  assertScanCoverage({
    guard: 'keyboard-avoiding',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: relOf,
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripSourceComments,
  });
});

test('REGLA B: la semilla no se queda corta contra un ORÁCULO INDEPENDIENTE', () => {
  // ── QUÉ CIERRA ───────────────────────────────────────────────────────────────────────────────────
  // La semilla mira dos señales elegidas por nosotros. Si las dos fueran ciegas al mismo caso, el guard
  // daría verde por no estar mirando —el modo de falla que esta unidad vino a cerrar—. Este test compara
  // el cierre contra un oráculo ARMADO CON OTRAS FIRMAS: props que solo tienen sentido sobre una entrada
  // de texto (teclado, password, multilínea, autocapitalización). Si aparece un archivo que el oráculo ve
  // y la semilla no, es que la semilla se quedó corta y hay que agregarle esa señal.
  const ORACLE = /\bonChangeText\b|keyboardType=|secureTextEntry|multiline=|autoCapitalize=/;

  const tree = readTree();
  const owners = exportOwners(tree);
  const providers = computeProviders(tree, owners);
  const { files } = computeInputFiles(tree, owners, providers);

  const oracleHits = [...tree].filter(([, src]) => ORACLE.test(src)).map(([rel]) => rel);
  assert.ok(oracleHits.length > 20, `el oráculo tiene que ver el árbol real (vio ${oracleHits.length})`);

  const invisibles = oracleHits.filter((rel) => !files.has(rel)).sort();
  assert.deepEqual(
    invisibles,
    [],
    'Estos archivos tienen firmas inequívocas de entrada de texto pero NO entran en el cierre del guard: ' +
      'la SEMILLA se está quedando corta (probablemente un tag con otro nombre — un import aliaseado, un ' +
      'componente de terceros). Agregá la señal que falta a `TEXT_ENTRY`, no una excepción.',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGLA A — LA VIEJA: nadie monta el componente de RN fuera del primitivo
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

test('REGLA A: el componente de RN solo se monta dentro del primitivo (afuera es un no-op en Android)', () => {
  assert.deepEqual(
    scan(readTree(), (line, rel) => rel !== SHELL_BASE && RN_KAV.test(line)),
    [],
    `El \`${KAV}\` de React Native no se usa directo en ninguna pantalla ni componente: con ` +
      '`behavior` sin definir es un `<View>` pelado en Android, y el `adjustResize` que lo cubría dejó de ' +
      'existir cuando el build pasó a edge-to-edge (el teclado tapa el sheet ENTERO, bug 🔴 en device). ' +
      `Usá el primitivo: \`<${SHELL} style={…}>\` (${SHELL_BASE} + ${SHELL_ANDROID}).`,
  );
});

test('REGLA A: la altura real del teclado se lee en UN solo archivo (la de RN en Android está mal)', () => {
  assert.deepEqual(
    scan(readTree(), (line, rel) => rel !== SHELL_ANDROID && ANIMATED_KEYBOARD.test(line)),
    [],
    '`useAnimatedKeyboard` vive solo en la implementación Android del primitivo. Dos consumidores del ' +
      'alto del teclado = dos lifts que se suman (el contenido salta el doble de lo que mide el teclado).',
  );
});

test('REGLA A: la base (iOS + web) conserva el `behavior=padding` de iOS — que es lo verificado en device', () => {
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

test('REGLA A: la implementación de Android aplica de verdad el alto del teclado (no es un no-op decorativo)', () => {
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

test('REGLA A: el guard DETECTA las firmas (no pasa verde por no estar mirando nada)', () => {
  // Un guard que no puede fallar es un guard muerto. Se verifica sobre las líneas EXACTAS que tenía el
  // repo antes de la unidad anterior, sin tocar el árbol real.
  assert.ok(RN_KAV.test(`import { ${KAV}, Platform } from 'react-native';`));
  assert.ok(RN_KAV.test(`      <${KAV} style={avoidStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>`));
  assert.ok(RN_KAV.test(`      </${KAV}>`));
  assert.ok(ANIMATED_KEYBOARD.test('  const keyboard = useAnimatedKeyboard();'));

  // Lo CORRECTO no dispara.
  assert.ok(!RN_KAV.test(`      <${SHELL} style={fillStyle}>`));
  assert.ok(!RN_KAV.test(`import { ${SHELL} } from './${SHELL}';`));
  assert.ok(!ANIMATED_KEYBOARD.test('  const keyboardVisible = useKeyboardVisible();'));

  // Una mención en un comentario tampoco (se blanquea antes de escanear).
  assert.ok(!RN_KAV.test(stripSourceComments(`// antes: <${KAV} behavior='padding'>`)));
  assert.ok(!RN_KAV.test(stripSourceComments(`/* el ${KAV} de RN es un no-op en Android */`)));

  // La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// keyboard-avoiding-disable-next-line -- caso con offset propio'));
  assert.ok(!DISABLE_NEXT_LINE.test('// keyboard-avoiding-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// keyboard-avoiding-disable-next-line --'));
});
