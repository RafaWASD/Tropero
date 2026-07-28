// GUARD: ABRIR UN SHEET BAJA EL TECLADO. Todo overlay con SCRIM tiene que descartar el teclado al abrirse.
//
// ── EL BUG 🔴 QUE CIERRA (Raf, device Android, APK a3b8d804 / commit 56beff3) ────────────────────────
// En `maniobra/identificar`, con el input de caravana ENFOCADO y el teclado ABIERTO, tocar la ‹ del header
// —que abre el `ExitJornadaSheet` para terminar o abandonar la jornada— dejaba el teclado arriba y del
// sheet solo asomaba una franja de ~25px: sus dos botones ("Terminar jornada" / "Salir sin terminar")
// quedaban TAPADOS. Un diálogo de decisión inoperable, en un flujo 🔴 de manga.
//
// ── POR QUÉ HACE FALTA UN GUARD Y NO ALCANZA "acordate" ──────────────────────────────────────────────
// Es un invariante de CLASE que se rompe EN SILENCIO por dos caminos, y ninguno de los dos lo puede ver
// ningún test de comportamiento nuestro:
//   1. Un sheet NUEVO que no llame al hook. En este repo no hay UN primitivo de overlay: hay 4 sheets
//      sobre `BottomSheetShell` y **21 hechos a mano** (copiados de un idiom). El default de "copio el
//      sheet de al lado" tiene que ser correcto, o vuelve el bug.
//   2. El síntoma es INVISIBLE EN WEB: react-native-web no monta teclado virtual (`Keyboard` nunca emite),
//      así que la E2E entera pasa en verde con el bug adentro. El veredicto real es DEVICE. Lo único
//      barato y determinista es la FIRMA en el código.
// Mismo espíritu que `keyboard-avoiding-guard`, `safe-bottom-inset-guard`, `worklet-callbacks-guard` y
// `phone-field-guard`.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.
//
// ── EL MODELO ────────────────────────────────────────────────────────────────────────────────────────
//  · SEMILLA   — todo archivo cuyo fuente (con los comentarios blanqueados) use el token **`$scrim`**. Es
//                la firma más difícil de evadir sin querer: se puede renombrar el componente, mover el
//                archivo o cambiar el esqueleto, pero un sheet sin scrim no es un sheet.
//                ⚠️ Lo que esta semilla garantiza es una sola dirección: **todo uso de `$scrim` en el repo
//                es el backdrop de un overlay modal anclado abajo** (por eso enumerarla alcanza para
//                cubrirlos a todos). La RECÍPROCA no es cierta por construcción: un overlay podría pintar
//                su backdrop con otro color y quedar fuera. Eso lo cubre la REGLA SECUNDARIA de abajo
//                (`isFullscreenOverlay`), que enumera los overlays a pantalla completa por su GEOMETRÍA —
//                sin mirar el color— y exige que cada uno sin `$scrim` esté nombrado en
//                `NON_SCRIM_OVERLAYS` con su razón. Hoy hay exactamente UNO.
//                (La DEFINICIÓN del token vive en `app/tamagui.config.ts`, fuera de los dos roots que este
//                guard escanea — por eso no necesita una excepción declarada.)
//  · CUBIERTO  — el archivo llama a `useDismissKeyboardOnOpen(` **o** monta `<BottomSheetShell`, que lo
//                llama por él. El shell es la única indirección aceptada, y está ANCLADA: el propio shell
//                está en la semilla (dibuja el scrim), así que si algún día dejara de llamar al hook, cae
//                como violación en vez de dejar en silencio a sus 4 consumidores sin la conducta.
//  · VIOLACIÓN — cualquier otro archivo de la semilla.
//
// ── LO QUE ESTE GUARD **NO** PUEDE VER (límites declarados, no promesas) ─────────────────────────────
//  (a) Que el ARGUMENTO sea el correcto. El hook dispara en el flanco cerrado→abierto: los sheets que se
//      MONTAN al abrirse van con el default, y los que viven SIEMPRE montados detrás de una prop tienen
//      que pasar esa prop. Se chequea el caso mecánico más probable —un sheet que declara `open: boolean`
//      y llama al hook SIN argumento— pero no el general (`FindOrCreateOverlay` no tiene prop `open`: se
//      abre por estado interno y pasa `state !== null`).
//  (b) Que el `claimsKeyboard` declarado sea NECESARIO. Se exige EVIDENCIA de auto-foco en el archivo
//      (`autoFocus` o un `.focus(` programático), que caza el "lo pongo por las dudas" — pero un
//      `.focus(` puede estar en un `onPress` y no al montar, así que el guard prueba que HAY un mecanismo
//      de foco, no que corra en el montaje. Ese último tramo es lectura del reviewer.
//  (c) Un overlay que no matchee NINGUNA de las dos firmas: ni `$scrim`, ni la geometría de
//      `isFullscreenOverlay` (`StyleSheet.absoluteFill` / `<Modal` de RN / una capa absoluta con los 4
//      insets en 0 y sin `pointerEvents="none"`). P. ej. un sheet de una librería que se portalice solo.
//      Hoy no existe ninguno; si aparece, la firma hay que ampliarla, no exceptuarlo.
//  (d) Que el teclado se baje DE VERDAD en el device. Eso es veredicto de Raf (ADR-029).

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
 * Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Hoy son **366**. El piso está ~18%
 * abajo: tolera que se borre un puñado de archivos, pero se pone ROJO si el listado se rompe o si una
 * carpeta entera deja de matchear. Ver `utils/scan-coverage.ts` para el porqué.
 */
const SCANNED_FILES_FLOOR = 300;

/** El hook que implementa la conducta. */
const HOOK_FILE = 'src/hooks/useDismissKeyboardOnOpen.ts';
const HOOK = 'useDismissKeyboardOnOpen';
/** La decisión PURA del flanco (testeada en `utils/sheet-shell.test.ts`). */
const PREDICATE = 'shouldDismissKeyboardOnOpen';
/** El shell que llama al hook por sus consumidores (la única indirección aceptada). */
const SHELL_FILE = 'src/components/BottomSheetShell.tsx';
const SHELL = 'BottomSheetShell';

/** SEMILLA: el token del backdrop modal. En este repo tiene un solo uso. */
const SCRIM = /\$scrim/;
/** CUBIERTO (directo): una LLAMADA al hook (no un import, no una mención). */
const HOOK_CALL = new RegExp(`\\b${HOOK}\\s*\\(`);
/** CUBIERTO (por el shell): montar el primitivo que ya llama al hook. */
const SHELL_MOUNT = new RegExp(`<${SHELL}\\b`);
/** Declaración de una prop `open: boolean` (sheet que vive SIEMPRE montado detrás de una prop). */
const OPEN_PROP = /^\s*open\??:\s*boolean/m;
/** Llamada al hook SIN argumento (el default `open = true`). */
const HOOK_CALL_BARE = new RegExp(`\\b${HOOK}\\s*\\(\\s*\\)`);
/** Un sheet que AUTO-ENFOCA su propio input: reclama el teclado en vez de soltarlo. */
const AUTO_FOCUS = /\bautoFocus\b/;
/** Foco PROGRAMÁTICO (`inputRef.current?.focus()`): la otra forma de reclamar el teclado. */
const PROGRAMMATIC_FOCUS = /\.focus\(/;
/** La declaración de esa excepción (prop del shell / flag propio del sheet a mano). */
const CLAIMS = /\bclaimsKeyboard\b/;

/** Válvula de escape por línea, con justificación (mismo patrón que los otros guards). */
const DISABLE_NEXT_LINE = /sheet-keyboard-dismiss-disable-next-line\s*--\s*\S/;

// ── REGLA SECUNDARIA: los overlays a pantalla completa que NO pintan `$scrim` ────────────────────────
// La semilla del scrim es de una sola dirección (ver EL MODELO). Esta segunda firma enumera los overlays
// por su GEOMETRÍA —a pantalla completa e INTERACTIVOS— sin mirar el color, y así el conjunto
// "overlay con backdrop" queda cerrado: o tenés `$scrim` (y entrás en la regla principal), o estás
// NOMBRADO acá abajo con tu razón. Un overlay nuevo que se salga de las dos firmas sigue siendo posible,
// pero ya no por el camino barato de "pinté el backdrop de otro color".

/** Las dos formas RN de cubrir la pantalla entera sin la escala de spacing de Tamagui. */
const RN_FULLSCREEN = /StyleSheet\.absoluteFill|<Modal\b/;
/** Un tag JSX abierto con `position="absolute"` (multilínea: `[^>]` incluye saltos). */
const ABSOLUTE_TAG = /<[A-Za-z][A-Za-z0-9_.]*\s[^>]*position="absolute"[^>]*>/g;
/** Una capa decorativa (gradiente de fade, hairline) no es un backdrop: no recibe toques. */
const NON_INTERACTIVE = /pointerEvents="none"/;
/** `lado={0}` / `lado="$0"` / `lado="0"` — el inset pegado al borde. */
const INSET_ZERO = ['top', 'left', 'right', 'bottom'].map(
  (side) => new RegExp(`\\b${side}=(?:"\\$0"|\\{0\\}|"0")`),
);

/**
 * ¿El archivo dibuja una capa que cubre la pantalla entera y RECIBE toques? (= tiene backdrop de overlay).
 * Coarse a propósito: sobre-incluir acá solo obliga a nombrar el archivo, nunca a cambiar conducta.
 */
function isFullscreenOverlay(src: string): boolean {
  if (RN_FULLSCREEN.test(src)) return true;
  return (src.match(ABSOLUTE_TAG) ?? []).some(
    (tag) => !NON_INTERACTIVE.test(tag) && INSET_ZERO.every((re) => re.test(tag)),
  );
}

/**
 * EXCEPCIONES NOMBRADAS: overlay a pantalla completa que NO pinta `$scrim` y que, con razón concreta,
 * queda FUERA del invariante "abrir un overlay baja el teclado". La lista se compara por IGUALDAD, así que
 * también cae si una excepción queda obsoleta (el archivo se migra o desaparece): no hay allowlist muerta.
 */
const NON_SCRIM_OVERLAYS = new Map<string, string>([
  [
    'src/components/EstablishmentSwitcherDropdown.tsx',
    'Popover del switch de campo del header de la home (spec 01 R6.8.1). Pinta su backdrop con ' +
      '`$textPrimary` @0.18 sobre `StyleSheet.absoluteFill` —un tinte de menú, no el scrim de un sheet— ' +
      'y por eso queda fuera de la semilla. Razones para NO exigirle el descarte, en orden de peso: ' +
      '(1) NO está anclado abajo: la card se ancla ARRIBA (`top={anchorTop}`, justo bajo el header), y el ' +
      'teclado se dibuja DESDE ABAJO → no puede taparla, que es el defecto entero que cierra este guard; ' +
      '(2) no tiene ningún campo de texto propio ni auto-foco, así que tampoco hay foco que preservar ni ' +
      'que matar; (3) su único call site es el switch del header de la home (`app/(tabs)/index.tsx`), una ' +
      'pantalla sin inputs, o sea que no hay teclado abierto cuando se abre. Si alguna de las tres deja ' +
      'de ser cierta, este test cae (las chequea abajo) y hay que revisar la excepción, no ampliarla.',
  ],
]);

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
      // Los `.test.*` quedan fuera: este archivo arma las firmas y las usa en casos sintéticos.
      found.push(p);
    }
  }
  return found;
}

const relOf = (file: string) => relative(APP_ROOT, file).split(sep).join('/');

/** El árbol REAL con los comentarios blanqueados (una mención documental no es ni un scrim ni una llamada). */
function readTree(): Map<string, string> {
  const tree = new Map<string, string>();
  for (const file of ROOTS.flatMap(listFiles)) {
    tree.set(relOf(file), stripSourceComments(readFileSync(file, 'utf8')));
  }
  return tree;
}

/** Los overlays con scrim (la semilla) — el motor, reusable contra un árbol sintético. */
function scrimFiles(tree: Map<string, string>): string[] {
  return [...tree].filter(([, src]) => SCRIM.test(src)).map(([rel]) => rel);
}

/** ¿El archivo baja el teclado al abrirse? (directo, o vía el shell que lo hace por él). */
function dismissesKeyboard(src: string): boolean {
  return HOOK_CALL.test(src) || SHELL_MOUNT.test(src);
}

/** La válvula de escape se lee sobre el fuente CRUDO (los comentarios están blanqueados en el tree). */
function hasEscapeHatch(rel: string): boolean {
  const raw = readFileSync(join(APP_ROOT, ...rel.split('/')), 'utf8');
  return raw.split(/\r?\n/).some((line) => DISABLE_NEXT_LINE.test(line));
}

function readFile(rel: string): string {
  const p = join(APP_ROOT, ...rel.split('/'));
  assert.ok(existsSync(p), `falta ${rel}: este guard cuelga de que exista con ese path exacto`);
  return stripSourceComments(readFileSync(p, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LA REGLA
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

test('todo overlay con SCRIM baja el teclado al abrirse', () => {
  const tree = readTree();
  const violations = scrimFiles(tree)
    .filter((rel) => !dismissesKeyboard(tree.get(rel)!) && !hasEscapeHatch(rel))
    .sort();

  assert.deepEqual(
    violations,
    [],
    'Estos archivos dibujan un scrim (= son un overlay modal) y NO bajan el teclado al abrirse. Si se ' +
      'abren mientras el operario tipea, el teclado les tapa el contenido —incluidos los CTAs— y la E2E no ' +
      'lo puede ver: react-native-web no monta teclado virtual (bug 🔴 en device: del `ExitJornadaSheet` ' +
      'solo asomaba una franja de ~25px sobre el teclado). Dos salidas:\n' +
      `  1. llamá al hook en el componente del sheet: \`${HOOK}()\` — o \`${HOOK}(open)\` si el sheet vive ` +
      'SIEMPRE montado detrás de una prop de visibilidad (si no, el flanco sería el del montaje de la ' +
      'pantalla y nunca dispararía al abrirse de verdad);\n' +
      `  2. o montá \`<${SHELL}>\`, que ya lo llama.\n` +
      'Si el caso es legítimo (un scrim que NO es un overlay modal), justificalo con ' +
      '`// sheet-keyboard-dismiss-disable-next-line -- <razón>`.\n' +
      violations.join('\n'),
  );
});

test('un overlay a pantalla completa SIN `$scrim` no se escapa en silencio: está NOMBRADO con su razón', () => {
  // ── QUÉ CIERRA ESTE TEST ─────────────────────────────────────────────────────────────────────────
  // La primera versión de este archivo afirmaba en un comentario que "un overlay modal que no use
  // `$scrim` hoy no existe en el repo". Era FALSO: `EstablishmentSwitcherDropdown` pinta su backdrop con
  // `$textPrimary` @0.18. El riesgo vivo era nulo (está anclado ARRIBA y no tiene inputs), pero una
  // afirmación de completitud que no se verifica es exactamente el mecanismo por el que la PRÓXIMA
  // superficie se escapa. Así que la enumeración deja de ser una promesa escrita y pasa a ser un
  // conjunto CERRADO por igualdad: todo overlay a pantalla completa o pinta `$scrim` (→ regla principal)
  // o está en `NON_SCRIM_OVERLAYS` con su razón. Si aparece uno nuevo, este test lo nombra y obliga a
  // decidir; si una excepción queda obsoleta, también cae.
  const tree = readTree();
  const nonScrimOverlays = [...tree]
    .filter(([, src]) => !SCRIM.test(src) && isFullscreenOverlay(src))
    .map(([rel]) => rel)
    .sort();

  assert.deepEqual(
    nonScrimOverlays,
    [...NON_SCRIM_OVERLAYS.keys()].sort(),
    'Cambió el conjunto de overlays a pantalla completa que NO pintan `$scrim`.\n' +
      '  · Si es uno NUEVO: o le pintás el backdrop con `$scrim` (y entra en la regla principal, que le ' +
      `va a exigir \`${HOOK}\`), o lo agregás a \`NON_SCRIM_OVERLAYS\` con la RAZÓN concreta por la que ` +
      'el teclado no lo tapa (p. ej.: está anclado arriba). "No creo que pase" no es una razón.\n' +
      '  · Si una excepción desapareció o se migró: sacala del mapa.\n' +
      `  visto:     ${nonScrimOverlays.join(', ') || '(ninguno)'}\n` +
      `  declarado: ${[...NON_SCRIM_OVERLAYS.entries()].map(([k, why]) => `${k} — ${why}`).join('\n             ')}`,
  );

  // Una excepción SIN razón escrita es una allowlist con otro nombre (mismo criterio que la válvula de
  // escape, que exige `-- <razón>`). El umbral es deliberadamente alto: "no aplica" no es una razón.
  for (const [rel, why] of NON_SCRIM_OVERLAYS) {
    assert.ok(
      why.trim().length >= 120,
      `la excepción de ${rel} tiene que venir con la RAZÓN concreta por la que el teclado no lo tapa`,
    );
  }

  // ── Y la excepción sigue en pie por sus RAZONES, no por inercia ──────────────────────────────────
  const dropdown = 'src/components/EstablishmentSwitcherDropdown.tsx';
  const src = tree.get(dropdown);
  assert.ok(src, `${dropdown} tiene que existir: la excepción declarada cuelga de este path exacto`);

  // (1) Anclado ARRIBA (bajo el header). El teclado se dibuja desde ABAJO: no puede taparlo.
  assert.match(
    src,
    /top=\{anchorTop\}/,
    `${dropdown} dejó de anclarse arriba (\`top={anchorTop}\`). La razón #1 de su excepción era ` +
      'justamente esa: si ahora se ancla abajo, el teclado SÍ lo tapa → tiene que llamar al hook.',
  );
  assert.doesNotMatch(
    src,
    /justifyContent="flex-end"/,
    `${dropdown} se ancló al fondo de la pantalla (el idiom de los bottom sheets) → el teclado lo tapa: ` +
      `llamá a \`${HOOK}()\` y sacalo de \`NON_SCRIM_OVERLAYS\`.`,
  );
  // (2) Sin campo de texto propio ni auto-foco: no hay teclado que reclamar ni foco que matar.
  assert.doesNotMatch(
    src,
    /<TextInput\b/,
    `${dropdown} ahora tiene un campo de texto → revisá la excepción (y si reclama el teclado, va con la ` +
      'semántica de `claimsKeyboard`).',
  );
  assert.doesNotMatch(src, AUTO_FOCUS, `${dropdown} ahora auto-enfoca: la excepción hay que rehacerla`);

  // (3) Su único call site es una pantalla SIN inputs → no hay teclado abierto cuando se abre.
  const mounts = [...tree]
    .filter(([rel, s]) => rel !== dropdown && /<EstablishmentSwitcherDropdown\b/.test(s))
    .map(([rel]) => rel)
    .sort();
  assert.deepEqual(
    mounts,
    ['app/(tabs)/index.tsx'],
    'Cambiaron los call sites del dropdown. La razón #3 de su excepción es que se abre desde una pantalla ' +
      'SIN campos de texto; con un call site nuevo hay que re-verificarlo.\n' +
      `  visto: ${mounts.join(', ') || '(ninguno)'}`,
  );
  assert.doesNotMatch(
    tree.get('app/(tabs)/index.tsx')!,
    /<TextInput\b/,
    'La home ahora tiene un campo de texto: el switch de campo puede abrirse con el teclado ARRIBA. ' +
      `Revisá la excepción de ${dropdown} (aunque siga anclado arriba, el sheet ya no es el único riesgo).`,
  );
});

test('un sheet con prop `open` NO puede llamar al hook sin argumento (dispararía al montar la pantalla)', () => {
  // El error mecánico más probable: copiar la línea del sheet de al lado. Un sheet que vive SIEMPRE montado
  // detrás de `open` y llama `useDismissKeyboardOnOpen()` mide el flanco del MONTAJE DE LA PANTALLA (teclado
  // abajo, no hace nada) y no vuelve a disparar nunca → el bug queda igual, pero con el hook puesto: la peor
  // clase de falso verde. Hoy los 4 con prop `open` (LotePickerSheet, SugerenciaVaciasSheet, LinkCalfPrompt,
  // MarkDeclaredSheet) pasan `open`.
  const tree = readTree();
  const wrong = scrimFiles(tree)
    .filter((rel) => {
      const src = tree.get(rel)!;
      return OPEN_PROP.test(src) && HOOK_CALL_BARE.test(src);
    })
    .sort();

  assert.deepEqual(
    wrong,
    [],
    `Estos sheets declaran \`open: boolean\` pero llaman \`${HOOK}()\` sin argumento. Pasale la prop: ` +
      `\`${HOOK}(open)\`. Con el default, el flanco que se mide es el del MONTAJE del componente — y estos ` +
      'sheets se montan con la pantalla, no al abrirse.\n' +
      wrong.join('\n'),
  );
});

test('un sheet que AUTO-ENFOCA su input tiene que declarar `claimsKeyboard` (si no, el descarte le mata el foco)', () => {
  // ── EL BUG QUE CIERRA (encontrado EJECUTANDO, no razonando) ──────────────────────────────────────
  // La regla general —abrir un sheet baja el teclado— tiene UNA excepción semántica: el sheet que
  // `autoFocus`ea su propio input no está SALIENDO del contexto de escritura, está ENTRANDO a uno. Con el
  // descarte puesto y sin declararlo, `SavePresetSheet` PERDÍA el foco de su input: en web el `commitMount`
  // de React enfoca al hijo dentro del MISMO commit, o sea antes del efecto del padre, así que el
  // `Keyboard.dismiss()` del shell llegaba después y lo blureaba. Se descubrió en la autorrevisión, con un
  // test que primero pasó en verde y después cayó cuando se le agregó el oráculo del foco.
  // El universo son los SHEETS: los que dibujan scrim + los que montan el primitivo (que no dibujan el suyo).
  const tree = readTree();
  const sheetUniverse = [...tree]
    .filter(([, src]) => SCRIM.test(src) || SHELL_MOUNT.test(src))
    .map(([rel]) => rel);

  const undeclared = sheetUniverse
    .filter((rel) => {
      const src = tree.get(rel)!;
      return AUTO_FOCUS.test(src) && !CLAIMS.test(src);
    })
    .sort();

  assert.deepEqual(
    undeclared,
    [],
    'Estos sheets renderizan `autoFocus` (o sea: quieren el teclado ARRIBA al abrirse) y NO declaran ' +
      '`claimsKeyboard`. El descarte del teclado que hace el shell al abrirse les va a MATAR el foco de su ' +
      'propio input, y en web no se ve como un error: se ve como "hay que tocar el campo". Declaralo:\n' +
      `  · si monta \`<${SHELL}>\` → pasale \`claimsKeyboard\`;\n` +
      `  · si es un sheet a mano → nombrá \`claimsKeyboard\` al flag con el que decidís y pasalo como ` +
      `\`${HOOK}(open && !claimsKeyboard)\`.\n` +
      undeclared.join('\n'),
  );

  // Ancla: el caso REAL tiene que seguir siendo visto por este test (hoy es el único `autoFocus` del repo).
  const savePreset = 'app/maniobra/_components/SavePresetSheet.tsx';
  assert.ok(sheetUniverse.includes(savePreset), `${savePreset} tiene que estar en el universo de sheets`);
  assert.match(tree.get(savePreset)!, AUTO_FOCUS, `${savePreset} sigue siendo el sheet con autoFocus`);
  assert.match(tree.get(savePreset)!, CLAIMS, `${savePreset} tiene que declarar claimsKeyboard`);

  // Y el shell tiene que HONRARLO (no basta con aceptar la prop y tirarla).
  assert.match(
    readFile(SHELL_FILE),
    new RegExp(`${HOOK}\\(\\s*!claimsKeyboard\\s*\\)`),
    `${SHELL_FILE} tiene que pasarle la excepción al hook: \`${HOOK}(!claimsKeyboard)\``,
  );
});

test('`claimsKeyboard` exige EVIDENCIA de auto-foco (la otra dirección: marcarlo de más revive el bug)', () => {
  // ── QUÉ CIERRA ESTE TEST ─────────────────────────────────────────────────────────────────────────
  // El test de arriba cubre UNA sola dirección: el falso NEGATIVO (auto-enfoco y no lo declaro → el
  // descarte me mata el foco). El falso POSITIVO quedaba abierto y es PEOR, porque es silencioso en las
  // dos plataformas donde importa: un sheet que declara `claimsKeyboard` sin auto-enfocar nada NO baja el
  // teclado al abrirse → vuelve exactamente el bug 🔴 del reporte (el sheet dibujado debajo del teclado),
  // pero con el hook puesto y el guard en verde. Verificado por el reviewer: antes de este test, marcar
  // `claimsKeyboard` en un sheet sin `autoFocus` pasaba 9/9.
  //
  // EVIDENCIA aceptada: `autoFocus` (el caso real, `SavePresetSheet`) o un `.focus(` programático (un
  // sheet que enfoque por ref en un efecto de montaje — hoy no existe, pero es legítimo y no hay por qué
  // forzarlo a `autoFocus`). Es evidencia, no prueba: un `.focus(` puede vivir en un `onPress` y no
  // correr al montar. El guard prueba que HAY un mecanismo de foco en el archivo; que corra en el montaje
  // se lee (límite (b) del header).
  //
  // EXCLUIDO: `BottomSheetShell`, que es el sitio de DEFINICIÓN de la prop (la declara, la documenta y la
  // pasa al hook) y no auto-enfoca nada. No es una declaración de uso.
  const tree = readTree();
  const sheetUniverse = [...tree]
    .filter(([, src]) => SCRIM.test(src) || SHELL_MOUNT.test(src))
    .map(([rel]) => rel);

  const unjustified = sheetUniverse
    .filter((rel) => rel !== SHELL_FILE)
    .filter((rel) => {
      const src = tree.get(rel)!;
      return CLAIMS.test(src) && !AUTO_FOCUS.test(src) && !PROGRAMMATIC_FOCUS.test(src);
    })
    .sort();

  assert.deepEqual(
    unjustified,
    [],
    'Estos sheets declaran `claimsKeyboard` pero NO se ve en el archivo ningún mecanismo de auto-foco ' +
      '(`autoFocus` ni `.focus(`). `claimsKeyboard` no es un flag "por las dudas": APAGA el descarte del ' +
      'teclado, o sea que devuelve el sheet al estado del bug 🔴 (dibujado debajo del teclado, CTAs ' +
      'tapados) y en web no se ve. Si el sheet realmente reclama el teclado, que se vea el foco en el ' +
      'archivo; si no, sacá la declaración.\n' +
      unjustified.join('\n'),
  );

  // Ancla del caso REAL en las dos direcciones: el único que la declara, la justifica.
  const savePreset = 'app/maniobra/_components/SavePresetSheet.tsx';
  const declaring = sheetUniverse.filter((rel) => rel !== SHELL_FILE && CLAIMS.test(tree.get(rel)!)).sort();
  assert.deepEqual(
    declaring,
    [savePreset],
    'Cambió el conjunto de sheets que declaran `claimsKeyboard`. Es una excepción a un invariante 🔴: ' +
      'cada alta se justifica (y este test exige que se le vea el auto-foco).\n' +
      `  visto: ${declaring.join(', ') || '(ninguno)'}`,
  );
  assert.match(tree.get(savePreset)!, AUTO_FOCUS, `${savePreset} justifica su \`claimsKeyboard\` con autoFocus`);
});

test('el motor VE el árbol real y encuentra los overlays que este fix tocó', () => {
  // Un motor que mira un árbol vacío da verde por vacuidad. Se ancla contra archivos concretos.
  const tree = readTree();
  const scrims = scrimFiles(tree);

  assert.ok(tree.size > 50, `el guard debería escanear el árbol real (vio ${tree.size} archivos)`);
  assert.ok(scrims.length >= 20, `el repo tiene ~22 overlays con scrim (vio ${scrims.length})`);

  for (const expected of [
    'app/maniobra/_components/ExitJornadaSheet.tsx', // el sheet EXACTO del reporte 🔴
    'app/maniobra/_components/CandidatePicker.tsx', // alcanzable con el teclado arriba (búsqueda manual)
    'app/maniobra/_components/OtherRodeoSheet.tsx', // ídem
    'app/maniobra/_components/CircunferenciaEscrotalStep.tsx', // sheet ANIDADO en un paso del wizard
    'app/_components/FindOrCreateOverlay.tsx', // overlay GLOBAL, lo abre un bastonazo sobre cualquier pantalla
    SHELL_FILE, // el primitivo, que es el ancla de sus 4 consumidores
  ]) {
    assert.ok(scrims.includes(expected), `${expected} tiene que estar en la semilla de overlays con scrim`);
    assert.ok(dismissesKeyboard(tree.get(expected)!), `${expected} tiene que bajar el teclado al abrirse`);
  }
});

test('ANCLA: el primitivo llama al hook (si no, sus 4 consumidores se quedan sin la conducta)', () => {
  // `ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet` y `BreedPickerSheet` NO dibujan scrim
  // propio (se lo pone el shell), así que NO están en la semilla: su cobertura cuelga entera de esta línea.
  const shell = readFile(SHELL_FILE);
  assert.match(shell, HOOK_CALL, `${SHELL_FILE} tiene que LLAMAR a \`${HOOK}()\` (no solo importarlo)`);

  const consumers = [
    'app/maniobra/_components/ManeuverConfigSheet.tsx',
    'app/maniobra/_components/CustomFieldSheet.tsx',
    'app/maniobra/_components/SavePresetSheet.tsx',
    'src/components/sigsa/BreedPickerSheet.tsx',
  ];
  for (const rel of consumers) {
    assert.match(readFile(rel), SHELL_MOUNT, `${rel} tiene que seguir montando <${SHELL}> (de ahí sale su cobertura)`);
  }
});

test('el hook HACE lo que dice (no es un no-op decorativo)', () => {
  // ── EL MODO DE FALLA QUE CIERRA ESTE TEST ────────────────────────────────────────────────────────
  // El hook puede existir, compilar, estar llamado en los 22 archivos y NO HACER NADA (un `useEffect`
  // vacío, un `Keyboard.dismiss` que se borró en un refactor, una dep `[]` que lo deja disparar solo en el
  // montaje). Todo eso pasa el typecheck y la E2E entera, porque en web no hay teclado. Acá se verifica la
  // cadena completa: predicado puro → efecto → `Keyboard.dismiss()` → dep en `open`.
  const hook = readFile(HOOK_FILE);

  assert.match(hook, /from 'react-native'/, 'el hook tiene que importar de react-native');
  assert.match(hook, /\bKeyboard\b/, 'el hook tiene que usar el módulo Keyboard');
  assert.match(hook, /Keyboard\.dismiss\(\)/, 'el hook TIENE que llamar `Keyboard.dismiss()` — es todo el fix');
  assert.match(hook, new RegExp(`\\b${PREDICATE}\\b`), `la decisión sale del predicado puro \`${PREDICATE}\``);
  assert.match(hook, /useEffect\(/, 'el descarte va en un efecto (hilo de JS), no en el render');
  assert.match(
    hook,
    /\}, \[open\]\);/,
    'la dep del efecto tiene que ser `[open]`: con `[]` un sheet siempre-montado nunca dispararía al ' +
      'abrirse, y sin deps dispararía en CADA render (el sheet cerraría su propio teclado en cada tecla)',
  );

  // ⚠️ Y NUNCA desde un worklet: `runOnJS(Keyboard.dismiss)` crasheó la app en device (SIGABRT sin redbox).
  // El guard general vive en `worklet-callbacks-guard.test.ts`; acá se ancla que este archivo no lo intente.
  assert.doesNotMatch(hook, /\bworklet\b/, 'esto es un efecto de JS: no hay ni puede haber worklets acá');
  assert.doesNotMatch(hook, /runOnJS|scheduleOnRN/, 'nada de runOnJS: `Keyboard.dismiss` se llama directo');
});

test('el predicado PURO existe y lo exporta el módulo de la lógica del sheet', () => {
  // Si alguien inlinea la decisión en el hook, deja de estar testeada (el hook no se puede montar en
  // node:test: no hay renderer). El contrato del flanco vive en `utils/sheet-shell.test.ts`.
  const pure = readFile('src/utils/sheet-shell.ts');
  assert.match(pure, new RegExp(`export function ${PREDICATE}\\b`), `\`${PREDICATE}\` tiene que vivir acá`);
});

test('el guard DETECTA (no pasa verde por no estar mirando nada)', () => {
  // El motor se ejercita sobre árboles SINTÉTICOS, sin tocar el repo: si la detección se rompe, esto cae.

  // (a) Sheet nuevo con scrim y sin nada → violación.
  const nuevo = new Map<string, string>([
    ['app/maniobra/_components/NuevoSheet.tsx', 'export function NuevoSheet() { return <View backgroundColor="$scrim" />; }'],
  ]);
  assert.deepEqual(scrimFiles(nuevo), ['app/maniobra/_components/NuevoSheet.tsx']);
  assert.ok(!dismissesKeyboard(nuevo.get('app/maniobra/_components/NuevoSheet.tsx')!), 'sin el hook NO cuenta como cubierto');

  // (b) El mismo sheet llamando al hook → cubierto.
  assert.ok(dismissesKeyboard(`export function S() { ${HOOK}(); return <View backgroundColor="$scrim" />; }`));
  assert.ok(dismissesKeyboard(`export function S() { ${HOOK}(open); return <View backgroundColor="$scrim" />; }`));

  // (c) El mismo sheet montando el primitivo → cubierto (la indirección aceptada).
  assert.ok(dismissesKeyboard(`export function S() { return <${SHELL} title="x">…</${SHELL}>; }`));

  // (d) Un IMPORT no cubre: hay que LLAMAR al hook (el modo de falla clásico de estos guards).
  assert.ok(!dismissesKeyboard(`import { ${HOOK} } from '@/hooks/${HOOK}';\nexport function S() { return null; }`));

  // (e) Una MENCIÓN en un comentario no crea ni un scrim ni una cobertura (se blanquean antes de escanear).
  assert.ok(!SCRIM.test(stripSourceComments('// el backdrop usa $scrim')));
  assert.ok(!HOOK_CALL.test(stripSourceComments(`/* acordate de llamar ${HOOK}() */`)));
  assert.ok(!SHELL_MOUNT.test(stripSourceComments(`// migrar a <${SHELL}>`)));

  // (f) Un componente que arranca igual NO se confunde con el primitivo.
  assert.ok(!dismissesKeyboard('<BottomSheetShellLegacy />'));

  // (g) La sub-regla del argumento: `open: boolean` + llamada pelada = mal; con la prop = bien.
  const conOpenPelado = 'type P = {\n  open: boolean;\n};\nexport function S({ open }: P) { ' + HOOK + '(); }';
  const conOpenPasado = 'type P = {\n  open: boolean;\n};\nexport function S({ open }: P) { ' + HOOK + '(open); }';
  assert.ok(OPEN_PROP.test(conOpenPelado) && HOOK_CALL_BARE.test(conOpenPelado), 'el caso malo tiene que detectarse');
  assert.ok(OPEN_PROP.test(conOpenPasado) && !HOOK_CALL_BARE.test(conOpenPasado), 'el caso bueno NO dispara');
  // …y no se confunde con otras props que terminan en "Open".
  assert.ok(!OPEN_PROP.test('  routeOpen: boolean;'), 'otra prop que contiene "open" no cuenta');

  // (h) La excepción del `autoFocus`: sin declarar es violación; declarada, no.
  const conAutoFocus = `export function S() { return <${SHELL} title="x"><Input autoFocus /></${SHELL}>; }`;
  assert.ok(AUTO_FOCUS.test(conAutoFocus) && !CLAIMS.test(conAutoFocus), 'el caso malo tiene que detectarse');
  const declarado = `export function S() { return <${SHELL} title="x" claimsKeyboard><Input autoFocus /></${SHELL}>; }`;
  assert.ok(AUTO_FOCUS.test(declarado) && CLAIMS.test(declarado), 'el caso declarado NO dispara');
  // Y un sheet SIN autoFocus no necesita declarar nada.
  assert.ok(!AUTO_FOCUS.test(`export function S() { return <${SHELL} title="x"><Input /></${SHELL}>; }`));

  // (h-bis) La OTRA dirección: `claimsKeyboard` sin ningún mecanismo de foco = declaración de más (apaga
  // el descarte y revive el bug). Con `autoFocus` o con un `.focus(` programático, justificada.
  const claimsSinFoco = `export function S() { return <${SHELL} title="x" claimsKeyboard><Text>hola</Text></${SHELL}>; }`;
  assert.ok(
    CLAIMS.test(claimsSinFoco) && !AUTO_FOCUS.test(claimsSinFoco) && !PROGRAMMATIC_FOCUS.test(claimsSinFoco),
    'el caso malo (claimsKeyboard sin evidencia de foco) tiene que detectarse',
  );
  const claimsPorRef =
    `export function S() { useEffect(() => { ref.current?.focus(); }, []); ` +
    `return <${SHELL} title="x" claimsKeyboard><TextInput ref={ref} /></${SHELL}>; }`;
  assert.ok(CLAIMS.test(claimsPorRef) && PROGRAMMATIC_FOCUS.test(claimsPorRef), 'el foco por ref cuenta como evidencia');
  assert.ok(PROGRAMMATIC_FOCUS.test('inputRef.current?.focus()'), 'la firma del foco programático real');
  assert.ok(!PROGRAMMATIC_FOCUS.test('const focused = true;'), 'una palabra parecida no cuenta como foco');

  // (i-bis) La firma GEOMÉTRICA de overlay a pantalla completa (la regla secundaria, la que cierra el
  // agujero de "pinté el backdrop de otro color").
  assert.ok(isFullscreenOverlay('<View style={StyleSheet.absoluteFill}><Pressable onPress={close} /></View>'));
  assert.ok(isFullscreenOverlay('<Modal visible transparent><View /></Modal>'), 'un Modal de RN también cubre todo');
  assert.ok(
    isFullscreenOverlay('<View\n  position="absolute"\n  top="$0"\n  left="$0"\n  right="$0"\n  bottom="$0"\n>'),
    'el idiom Tamagui de los sheets a mano (multilínea) tiene que matchear',
  );
  // …y las capas DECORATIVAS (gradientes de fade, hairlines) NO son overlays: no reciben toques.
  assert.ok(
    !isFullscreenOverlay('<View position="absolute" top="$0" left="$0" right="$0" bottom="$0" pointerEvents="none" />'),
    'una capa pointerEvents="none" es decorativa, no un backdrop',
  );
  // …ni una capa absoluta que no cubre los 4 lados.
  assert.ok(!isFullscreenOverlay('<View position="absolute" top="$0" left="$0" right="$0" height={fadeH} />'));
  assert.ok(!isFullscreenOverlay('<View position="absolute" bottom="$0" left="$0" right="$0" height={1} />'));
  // …ni una pantalla común.
  assert.ok(!isFullscreenOverlay('<YStack flex={1} backgroundColor="$bg" />'));

  // (i) La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// sheet-keyboard-dismiss-disable-next-line -- no es un overlay modal'));
  assert.ok(!DISABLE_NEXT_LINE.test('// sheet-keyboard-dismiss-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// sheet-keyboard-dismiss-disable-next-line --'));
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  // Un verificador roto y un verificador que no encuentra nada se ven igual: verde. Acá el guard audita su
  // propia entrada — cuántos archivos vio y si los vio completos. Detalle en `utils/scan-coverage.ts`.
  assertScanCoverage({
    guard: 'sheet-keyboard-dismiss',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: relOf,
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripSourceComments,
  });
});
