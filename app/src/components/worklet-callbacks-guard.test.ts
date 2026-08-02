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

import { stripSourceComments, stripSourceCommentsAndStrings } from '../utils/strip-comments';
import { assertScanCoverage } from '../utils/scan-coverage';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/**
 * Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Hoy son **366**. Ver
 * `utils/scan-coverage.ts`: si el glob deja de matchear, este guard se pone ROJO en vez de pasar vacío.
 */
const SCANNED_FILES_FLOOR = 300;

/**
 * Primer argumento de `runOnJS`/`scheduleOnRN` que es un ACCESO A PROPIEDAD (`X.y`, `X?.y`): eso captura
 * `X` entero en el closure del worklet. Un identificador pelado (`runOnJS(onClose)`) es lo correcto.
 */
const CALLBACK_SIGNATURE = /\b(?:runOnJS|scheduleOnRN)\s*\(\s*[A-Za-z_$][\w$]*\s*\??\.\s*[A-Za-z_$][\w$]*/;

/** Válvula de escape por línea, con justificación (mismo patrón que check-hardcode.mjs / phone-field). */
const DISABLE_NEXT_LINE = /worklet-callback-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /worklet-callback-disable-line\s*--\s*\S/;

// ── REGLA 2: BLINDAJE de TODO worklet de gesto / animated-scroll-handler ─────────────────────────────
//
// ── EL BUG QUE CIERRA (crash 🔴 nativo en device, Raf, iPhone 15 Pro, build release, 2026-08-01) ──────
// `EXC_CRASH / SIGABRT` armando una maniobra. Stack del main thread:
//   UIGestureRecognizer → -[REANodesManager dispatchEvent:] → ReanimatedModuleProxy::handleEvent →
//   UIEventHandlerRegistry::processEvent → reanimated::UIEventHandler::process → WorkletRuntime::runSync →
//   HermesRuntimeImpl::throwPendingError → __cxa_throw  (→ std::terminate → abort).
// Un worklet atado a un ANIMATED-EVENT HANDLER (callback de un `Gesture.*` de RNGH o un
// `useAnimatedScrollHandler`) tiró una excepción de JS SIN CATCH en el UI runtime → `std::terminate` →
// la app entera muere, sin redbox y sin log de JS. `UIEventHandler::process` es EXCLUSIVO de esos
// handlers: NO pasa por él `useAnimatedStyle`/`useDerivedValue`/`useFrameCallback` (registries distintos).
//
// ── POR QUÉ UN GUARD DE COBERTURA (no una lista a mano) ──────────────────────────────────────────────
// El `callGuard` de worklets SOLO existe en builds de DEBUG; en release nadie atrapa. La única defensa es
// que CADA callback de evento envuelva su cuerpo en `try/catch` y en el `catch` haga `if (__DEV__) throw`
// (re-lanza en dev para no tapar el bug; en release degrada a gesto inerte). `BottomSheetShell` ya lo hace
// (ver ahí el porqué largo). Esto NO se puede verificar en E2E: el crash es del UI runtime NATIVO y en
// react-native-web estos handlers no ejercitan ese path. Lo barato y determinista es la FIRMA en el código.
// Igual que la REGLA B del guard de KeyboardAvoiding, se CALCULA la cobertura (no se enumera a mano): se
// enumeran estáticamente TODOS los callbacks de gesto/scroll del árbol y se exige el blindaje en cada uno,
// de modo que un gesto/scroll worklet NUEVO sin `try/catch` deje este test en ROJO (barrer la AUSENCIA).

/** Métodos de callback de un `Gesture.*` de RNGH que corren un worklet en el UI runtime al procesar un
 *  evento. Se detectan SOLO dentro de una cadena `Gesture.…` (ver `gestureChainRegions`) → `db.onChange`
 *  (PowerSync), `onChange`/`onEnd` de props JSX, etc. NO colisionan. */
const GESTURE_CALLBACK_METHODS = [
  'onBegin',
  'onStart',
  'onUpdate',
  'onChange',
  'onEnd',
  'onFinalize',
  'onTouchesDown',
  'onTouchesMove',
  'onTouchesUp',
  'onTouchesCancelled',
];

/** Keys de handler de un `useAnimatedScrollHandler({...})`: cada uno es un worklet de evento de scroll
 *  (mismo `UIEventHandler::process`). */
const SCROLL_HANDLER_KEYS = ['onScroll', 'onBeginDrag', 'onEndDrag', 'onMomentumBegin', 'onMomentumEnd'];

/** El BLINDAJE exigido en el cuerpo del callback: `try` + `catch` + `if (__DEV__) throw`. */
const HAS_TRY = /\btry\b/;
const HAS_CATCH = /\bcatch\b/;
const HAS_DEV_THROW = /if\s*\(\s*__DEV__\s*\)\s*throw\b/;

/** Válvula de escape del blindaje, con justificación (un callback legítimamente NO-worklet, p. ej.). */
const BLINDAJE_DISABLE_NEXT_LINE = /worklet-blindaje-disable-next-line\s*--\s*\S/;
const BLINDAJE_DISABLE_LINE = /worklet-blindaje-disable-line\s*--\s*\S/;

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/** Índice del delimitador que cierra el que abre en `openIdx` (sobre código sin comentarios NI strings, así
 *  ningún `(`/`{` dentro de un literal desbalancea). Devuelve `code.length` si no cierra (fuente roto). */
function matchDelim(code: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/** Consume la EXPRESIÓN DE CADENA que arranca en un `Gesture.…` (índice `startIdx`, sobre código
 *  estructural) y devuelve el índice donde termina. Recorre `.ident` y `(...)` balanceados mientras la
 *  cadena siga; corta al primer token que no sea `.` ni `(` (un `;`, `,`, `)`, salto a otra sentencia). Así
 *  el scan de callbacks queda ACOTADO a lo que es un gesto de verdad. */
function consumeGestureChain(code: string, startIdx: number): number {
  let i = startIdx;
  const skipSpace = () => {
    while (i < code.length && /\s/.test(code[i])) i++;
  };
  while (i < code.length && IDENT_CHAR.test(code[i])) i++; // 'Gesture'
  for (;;) {
    skipSpace();
    if (code[i] === '.') {
      i++;
      skipSpace();
      while (i < code.length && IDENT_CHAR.test(code[i])) i++; // .Type / .method
      continue;
    }
    if (code[i] === '(') {
      i = matchDelim(code, i, '(', ')') + 1;
      continue;
    }
    break;
  }
  return i;
}

/** Regiones `[start, end)` de cada cadena `Gesture.…` del código estructural. */
function gestureChainRegions(code: string): Array<{ start: number; end: number }> {
  const regions: Array<{ start: number; end: number }> = [];
  const re = /\bGesture\s*\.\s*[A-Za-z]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const start = m.index;
    const end = consumeGestureChain(code, start);
    regions.push({ start, end });
    if (end > re.lastIndex) re.lastIndex = end; // no re-scanear adentro de una cadena ya consumida
  }
  return regions;
}

/** Un sitio de callback de evento de worklet: dónde está (para el número de línea) y su cuerpo (para el
 *  blindaje). `code` es estructural (comentarios y strings blanqueados). */
type WorkletCallbackSite = { openParen: number; body: string; kind: string };

/** Enumera TODOS los callbacks de gesto RNGH + handlers de `useAnimatedScrollHandler` del código
 *  estructural. El cuerpo devuelto es el ARGUMENTO completo del callback (incluye la arrow function): si no
 *  hay `try/catch` adentro, no está blindado. */
function findWorkletEventCallbacks(code: string): WorkletCallbackSite[] {
  const sites: WorkletCallbackSite[] = [];
  const regions = gestureChainRegions(code);
  const inRegion = (idx: number) => regions.some((r) => idx >= r.start && idx < r.end);

  // (a) Callbacks de gesto RNGH: SOLO los que caen dentro de una cadena `Gesture.…`.
  const cbRe = new RegExp(`\\.\\s*(${GESTURE_CALLBACK_METHODS.join('|')})\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = cbRe.exec(code)) !== null) {
    if (!inRegion(m.index)) continue;
    const openParen = m.index + m[0].length - 1; // el '(' que abre el argumento
    const close = matchDelim(code, openParen, '(', ')');
    sites.push({ openParen, body: code.slice(openParen, close + 1), kind: `Gesture.${m[1]}` });
  }

  // (b) Handlers de useAnimatedScrollHandler: cada key (onScroll/onBeginDrag/…) dentro del objeto argumento.
  const scrollRe = /\buseAnimatedScrollHandler\s*\(/g;
  while ((m = scrollRe.exec(code)) !== null) {
    const argOpen = m.index + m[0].length - 1;
    const argClose = matchDelim(code, argOpen, '(', ')');
    const arg = code.slice(argOpen, argClose + 1);
    const keyRe = new RegExp(`\\b(${SCROLL_HANDLER_KEYS.join('|')})\\s*:`, 'g');
    let k: RegExpExecArray | null;
    while ((k = keyRe.exec(arg)) !== null) {
      const arrow = arg.indexOf('=>', k.index + k[0].length);
      if (arrow === -1) continue;
      const brace = arg.indexOf('{', arrow);
      if (brace === -1) continue;
      const bodyClose = matchDelim(arg, brace, '{', '}');
      const absOpen = argOpen + k.index; // posición del key en `code` (para el número de línea)
      sites.push({ openParen: absOpen, body: arg.slice(brace, bodyClose + 1), kind: `scrollHandler.${k[1]}` });
    }
    if (argClose > scrollRe.lastIndex) scrollRe.lastIndex = argClose;
  }

  return sites;
}

/** ¿El cuerpo del callback tiene el blindaje completo? */
function isBlindado(body: string): boolean {
  return HAS_TRY.test(body) && HAS_CATCH.test(body) && HAS_DEV_THROW.test(body);
}

/** Número de línea (1-based) de un índice de carácter. */
function lineOf(code: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < code.length; i++) if (code[i] === '\n') line++;
  return line;
}

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
 *
 * Delega en el escáner CON ESTADO compartido del repo. NO se hace con un par de regexes: ese blanqueo
 * abría un bloque FALSO ante un slash-asterisco escrito dentro de un comentario de LÍNEA y se comía todo
 * hasta el próximo cierre de bloque del archivo. Medido sobre el árbol de `fc4d164`, con la métrica
 * "líneas de CÓDIGO que el escáner viejo dejaba invisibles": **556 líneas en 6 archivos** de
 * `app/app`+`app/src` (341 en `maniobra/identificar.tsx`, 113 en `asignar-caravanas.tsx`, 84 en
 * `FindOrCreateOverlay.tsx`, 10 en `app/_layout.tsx`, 6+2 en los dos de SIGSA). Un guard que no ve un
 * pedazo del archivo da falsa confianza: es peor que no tenerlo.
 */
const stripComments = stripSourceComments;

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

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  // Un verificador roto y un verificador que no encuentra nada se ven igual: verde. Acá el guard audita
  // su propia entrada — cuántos archivos vio y si los vio completos. Detalle en `utils/scan-coverage.ts`.
  assertScanCoverage({
    guard: 'worklet-callbacks',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: (f) => relative(APP_ROOT, f).split(sep).join('/'),
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripComments,
  });
});

test('el guard recorre el árbol real (y ve los archivos que tienen worklets)', () => {
  const scanned = ROOTS.flatMap(listFiles);
  assert.ok(scanned.length >= SCANNED_FILES_FLOOR, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  assert.ok(
    scanned.some((f) => f.endsWith(join('src', 'components', 'BottomSheetShell.tsx'))),
    'BottomSheetShell.tsx (el del crash) debería estar dentro del árbol escaneado',
  );
  assert.ok(
    scanned.some((f) => f.endsWith(join('_components', 'ManeuverReorderList.tsx'))),
    'ManeuverReorderList.tsx (el otro archivo con worklets + runOnJS) debería estar dentro del árbol',
  );
});

// ── REGLA 2: cada worklet de gesto/scroll está BLINDADO (try/catch + if(__DEV__)throw) ────────────────
//
// Piso de callbacks de evento enumerados en el árbol real. HOY: 13 —
//   · BottomSheetShell buildDragGesture: onBegin/onStart/onUpdate/onEnd/onFinalize (5)
//   · ManeuverReorderList pan: onStart/onUpdate/onEnd/onFinalize (4) + badgeTap/bodyTap/PoolRow onEnd (3)
//   · WheelPicker: useAnimatedScrollHandler.onScroll (1)
// Si baja de esto, el enumerador dejó de VER callbacks (regex/scoping roto) → rojo en vez de verde-vacío.
const WORKLET_CALLBACK_FLOOR = 10;

test('cada callback de gesto RNGH / animated-scroll-handler está BLINDADO (try/catch + if(__DEV__) throw)', () => {
  const violations: string[] = [];
  let totalSites = 0;
  const byFile = new Map<string, number>();

  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split(/\r?\n/);
      // Estructural: comentarios Y strings blanqueados → el matcheo de delimitadores/keywords no se confunde
      // con un `{`/`try` escrito dentro de un literal, y una MENCIÓN documental no cuenta como callback.
      const structural = stripSourceCommentsAndStrings(raw);
      const rel = relative(APP_ROOT, file).split(sep).join('/');

      const sites = findWorkletEventCallbacks(structural);
      totalSites += sites.length;
      if (sites.length > 0) byFile.set(rel, sites.length);

      for (const site of sites) {
        if (isBlindado(site.body)) continue;
        const lineNo = lineOf(structural, site.openParen); // 1-based
        const here = rawLines[lineNo - 1] ?? '';
        const previous = rawLines[lineNo - 2] ?? '';
        if (BLINDAJE_DISABLE_LINE.test(here) || BLINDAJE_DISABLE_NEXT_LINE.test(previous)) continue;
        violations.push(`${rel}:${lineNo}  ${site.kind}`);
      }
    }
  }

  // El enumerador tiene que estar VIENDO callbacks (un guard que no encuentra nada pasa verde por vacío).
  assert.ok(
    totalSites >= WORKLET_CALLBACK_FLOOR,
    `el guard enumeró ${totalSites} callbacks de gesto/scroll y el piso es ${WORKLET_CALLBACK_FLOOR}: el ` +
      'enumerador dejó de ver worklets (¿regex/scoping roto, se movió un archivo?). Si el árbol encogió a ' +
      'propósito, bajá el piso en el mismo commit y decí por qué.',
  );
  // Y tiene que ver los archivos-testigo (los tres que hoy montan estos worklets).
  for (const witness of ['src/components/BottomSheetShell.tsx', 'app/maniobra/_components/ManeuverReorderList.tsx', 'app/maniobra/_components/WheelPicker.tsx']) {
    assert.ok(byFile.has(witness), `el guard debería enumerar callbacks de gesto/scroll en ${witness} (vio 0)`);
  }

  assert.deepEqual(
    violations,
    [],
    'Hay callbacks de gesto RNGH / animated-scroll-handler SIN BLINDAJE. Una excepción NO ATRAPADA dentro ' +
      'de uno de estos worklets **mata la app entera** (SIGABRT nativo, sin redbox) — así crasheó en device ' +
      '(stack `UIEventHandler::process → runSync → throwPendingError → abort`). Envolvé el cuerpo del ' +
      'callback en `try { … } catch (err) { /* resetear shared values a estado inerte */ if (__DEV__) throw err; }` ' +
      '(mismo patrón que `BottomSheetShell`). Si el callback es legítimamente inofensivo, justificalo con ' +
      '`// worklet-blindaje-disable-next-line -- <razón>`.\n' +
      violations.join('\n'),
  );
});

test('el guard de BLINDAJE sabe FALLAR (detecta un callback sin try/catch, y no se confunde con db.onChange)', () => {
  // Un gesto SIN blindaje → detectado como violación.
  const unguarded = `
    const pan = Gesture.Pan()
      .onUpdate((e) => {
        dragY.value = e.translationY;
      })
      .onEnd(() => {
        runOnJS(commit)();
      });
  `;
  const sitesU = findWorkletEventCallbacks(stripSourceCommentsAndStrings(unguarded));
  assert.equal(sitesU.length, 2, 'debería enumerar los 2 callbacks del gesto');
  assert.ok(sitesU.every((s) => !isBlindado(s.body)), 'ninguno está blindado → violación');

  // El MISMO gesto CON blindaje → sin violación.
  const guarded = `
    const pan = Gesture.Pan()
      .onUpdate((e) => {
        'worklet';
        try {
          dragY.value = e.translationY;
        } catch (err) {
          dragY.value = 0;
          if (__DEV__) throw err;
        }
      })
      .onEnd(() => {
        'worklet';
        try {
          runOnJS(commit)();
        } catch (err) {
          if (__DEV__) throw err;
        }
      });
  `;
  const sitesG = findWorkletEventCallbacks(stripSourceCommentsAndStrings(guarded));
  assert.equal(sitesG.length, 2);
  assert.ok(sitesG.every((s) => isBlindado(s.body)), 'ambos blindados → sin violación');

  // Un `useAnimatedScrollHandler` sin blindaje → detectado.
  const scroll = `
    const onScroll = useAnimatedScrollHandler({
      onScroll: (e) => {
        offsetY.value = e.contentOffset.y;
      },
    });
  `;
  const sitesS = findWorkletEventCallbacks(stripSourceCommentsAndStrings(scroll));
  assert.equal(sitesS.length, 1, 'debería enumerar el handler onScroll');
  assert.ok(!isBlindado(sitesS[0].body), 'sin try/catch → violación');

  // `db.onChange(...)` de PowerSync NO es un gesto (no cuelga de `Gesture.…`) → NO se enumera.
  const dbWatch = `
    const dispose = db.onChange((event) => {
      refetch();
    }, { tables: ['animals'] });
  `;
  assert.equal(findWorkletEventCallbacks(stripSourceCommentsAndStrings(dbWatch)).length, 0, 'db.onChange no es gesto');

  // Una prop JSX `onEnd={fn}` tampoco (no es `.onEnd(` de una cadena Gesture).
  const jsxProp = `<Foo onEnd={handleEnd} onChange={x} />`;
  assert.equal(findWorkletEventCallbacks(stripSourceCommentsAndStrings(jsxProp)).length, 0, 'prop JSX no es gesto');

  // La válvula de escape exige razón escrita.
  assert.ok(BLINDAJE_DISABLE_NEXT_LINE.test('// worklet-blindaje-disable-next-line -- corre en JS thread, no worklet'));
  assert.ok(!BLINDAJE_DISABLE_NEXT_LINE.test('// worklet-blindaje-disable-next-line'));
});
