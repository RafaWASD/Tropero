// GUARD: la reserva del borde INFERIOR no se calcula a mano en ningún lado. Se lee del hook compartido
// `useSafeBottomInset()` (que es también de donde la toma el bottom-nav).
//
// ── EL BUG QUE CIERRA (🔴 device Android, Raf, build EAS 7402575a) ───────────────────────────────────
// La fórmula `paddingBottom = max(inset inferior, token de mínimo)` estaba COPIADA A MANO en ~25 archivos
// (más otras ~12 variantes con un aire hardcodeado o un token suelto). Con una barra de navegación real
// (Samsung, 3 botones: `insets.bottom = 48`), `max(48, 12) = 48`: la app reservaba EXACTAMENTE la barra y
// nada más → el CTA "Nueva jornada" terminaba a **1dp** de la barra (medido sobre la captura del device:
// borde del CTA en y=1508, borde de la barra en y=1510). El mínimo de 12 solo podía ganar cuando el inset
// era 0, o sea únicamente en web.
// El error conceptual: meter en un `max` dos cosas de semántica distinta —el INSET ("no me tapes",
// obligación del SO) y el AIRE ("no me toques", decisión de diseño)— que son ADITIVAS **en Android**. Y no
// es solo estética: con el CTA pegado a la barra, un toque bajo con guante cae en "atrás"/"home" y saca al
// operario de la jornada (prevención de errores, Nielsen #5, en una pantalla 🔴 manga).
// La fórmula correcta es `max(insetVigente, insetArranque, $navBottomMin) + (Android ? $navBarGap : 0)`,
// y vive en UN solo lugar: `computeSafeBottomInset` (pura) + `hooks/useSafeBottomInset` (la plataforma).
//
// ── POR QUÉ UN GUARD ────────────────────────────────────────────────────────────────────────────────
// Porque el bug no fue una línea mal escrita: fue una línea CORRECTA-EN-SU-MOMENTO copiada 25 veces.
// Con la fórmula repartida, arreglarla en un lado no arregla nada, y el próximo sheet la copia del
// vecino. Además esto NO lo caza ningún test funcional: en web el inset es 0 y todo se ve bien (el bug
// solo existe en un device con barra real), así que la única verificación barata y determinista es la
// FIRMA en el código. Mismo patrón que `worklet-callbacks-guard.test.ts` / `phone-field-guard.test.ts`.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from './strip-comments';
import { assertScanCoverage } from './scan-coverage';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/**
 * Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Hoy son **364**. Ver
 * `utils/scan-coverage.ts`: si el glob deja de matchear, este guard se pone ROJO en vez de pasar vacío.
 */
const SCANNED_FILES_FLOOR = 300;

/** El ÚNICO archivo que puede leer los tokens del borde inferior junto a un inset y decidir plataforma. */
const HOOK = 'src/hooks/useSafeBottomInset.ts';

// ⚠️ Las firmas prohibidas se ARMAN POR CONCATENACIÓN a propósito: así este archivo no contiene la cadena
// literal de la llamada al max sobre el inset y un grep de aceptación sobre `app/src` + `app/app` sigue
// dando CERO — es decir, sigue siendo un oráculo limpio en vez de reportar al propio guard. El costo es
// leerlo una vez; el beneficio es que el grep no miente.
const MAX_CALL = ['Math', '.', 'max'].join('');

/**
 * La FÓRMULA vieja: cualquier `Math.max(...)` que mezcle el inset inferior con otra cosa. Cubre las dos
 * variantes que había en el repo (`insets.bottom` y el prop `bottomInset` de `export-sigsa`).
 */
const MAX_FORMULA = /Math\.max\(\s*[^)]*\b(?:insets?\.bottom|bottomInset)\b/;

/** Cualquier lectura de un token del borde inferior (el piso o el aire). */
const EDGE_TOKEN = /\$nav(?:BottomMin|BarGap)\b/;
/** Un inset inferior en la misma línea. */
const BOTTOM_INSET = /\b(?:insets?\.bottom|bottomInset|safeBottom|liveInsetBottom)\b/;

/**
 * El AIRE (`$navBarGap`) solo se lee en el hook. Es el término que NO aplica en todas las plataformas:
 * leerlo suelto en una pantalla es re-implementar la decisión (y, casi seguro, aplicarlo también en iOS).
 */
const GAP_TOKEN = /\$navBarGap\b/;

/**
 * El PISO (`$navBottomMin`) tampoco sale del hook. La regla tuvo una excepción a medida
 * ("puede viajar a un call site como argumento del hook") que existía sólo para acomodar los 8 footers
 * que hardcodeaban `+ 12` y que en el 2º fix-loop se plegaron a la reserva canónica. Sin esos 8, la
 * excepción no tiene ningún consumidor legítimo y sí un costo: deja abierta la puerta a que alguien
 * declare "aire propio" de 12 en una superficie nueva y vuelva a haber DOS reservas de footer en la app.
 * Si una superficie necesita aire propio de verdad, usa un token de spacing (`$3`, `$6`), no el piso.
 */
const FLOOR_TOKEN = /\$navBottomMin\b/;

/** La decisión de plataforma del aire vive en el hook y en ningún otro lado (si no, la fórmula se bifurcó). */
const PLATFORM_ANDROID = /Platform\.OS\s*===\s*'android'/;

/** La pura solo se llama desde el hook (es la que recibe `applyGap`: llamarla es decidir la plataforma). */
const PURE_CALL = /\bcomputeSafeBottomInset\s*\(/;

/** Dónde viven los tokens y en qué grupo tienen que estar para que `getTokenValue` los resuelva. */
const TAMAGUI_CONFIG = 'tamagui.config.ts';
const TOKEN_GROUP = 'size';
/**
 * Los dos términos de la RESERVA que salen de un token. `$navBar` (alto de contenido del nav) queda
 * fuera a propósito: no es parte de la reserva y además sí tiene cobertura de runtime — la capture del
 * Gate 2.5 mide el nav en 72px, que solo da si `$navBar`=60 y `$navBottomMin`=12 resuelven. El que NO
 * tiene ninguna cobertura de runtime es `$navBarGap`: en web `applyGap` es false y nunca se lee.
 */
const EDGE_TOKENS = ['navBottomMin', 'navBarGap'] as const;
/**
 * Las constantes que los tests PUROS hardcodean para el piso y el aire. Los tests puros no pueden leer
 * tamagui (importa RN), así que copian los números — y una copia que nadie compara con el original es
 * exactamente cómo una suite entera se queda verde describiendo una app que ya no existe.
 */
const PURE_TEST_CONSTANTS: Array<{ file: string; constants: Record<string, (typeof EDGE_TOKENS)[number]> }> = [
  { file: 'src/utils/footer-action.test.ts', constants: { PISO: 'navBottomMin', GAP: 'navBarGap' } },
  { file: 'src/utils/tab-bar-insets.test.ts', constants: { PISO: 'navBottomMin', GAP: 'navBarGap' } },
];

/** Cuerpo `{…}` que arranca en la llave de `openIdx`, por balanceo. */
function braceBody(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(openIdx + 1, i);
  }
  throw new Error(`llave sin cerrar desde el índice ${openIdx}`);
}

/** Cuerpo del grupo `<group>: { … }` DENTRO de `createTokens(...)` (hay otro `size:` en las fuentes). */
function tokenGroupBody(configSrc: string, group: string): string {
  const code = stripComments(configSrc);
  const call = code.indexOf('createTokens(');
  assert.ok(call >= 0, `${TAMAGUI_CONFIG} tiene que declarar sus tokens con createTokens(...)`);
  const tokens = braceBody(code, code.indexOf('{', call));
  const head = new RegExp(`(?:^|\\n)\\s*${group}:\\s*\\{`).exec(tokens);
  assert.ok(head, `el grupo de tokens \`${group}\` no existe dentro de createTokens(...)`);
  return braceBody(tokens, head.index + head[0].length - 1);
}

/** Válvula de escape por línea, con justificación (mismo patrón que check-hardcode.mjs / worklet-guard). */
const DISABLE_NEXT_LINE = /safe-bottom-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /safe-bottom-disable-line\s*--\s*\S/;

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
      // Los .test.* quedan fuera: este archivo contiene las firmas en sus regexes y en sus casos
      // sintéticos (se auto-reportaría), y los tests de las funciones puras las nombran.
      found.push(p);
    }
  }
  return found;
}

/**
 * Blanquea comentarios preservando saltos de línea: una MENCIÓN documental no es una violación.
 * Delega en el escáner CON ESTADO compartido del repo. NO se hace con un par de regexes: ese blanqueo
 * abría un bloque FALSO ante un slash-asterisco escrito dentro de un comentario de LÍNEA y se comía todo
 * hasta el próximo cierre de bloque del archivo. Medido sobre el árbol de `fc4d164`, con la métrica
 * "líneas de CÓDIGO que el escáner viejo dejaba invisibles" (una línea cuenta si el blanqueo correcto le
 * deja código y el viejo la deja entera en blanco): **556 líneas en 6 archivos** de `app/app`+`app/src`
 * — 341 en `maniobra/identificar.tsx`, 113 en `asignar-caravanas.tsx`, 84 en `FindOrCreateOverlay.tsx`,
 * 10 en `app/_layout.tsx`, 6 en `sigsa-validator.ts`, 2 en `sigsa-txt-generator.ts`. Un guard que no ve
 * un pedazo del archivo da falsa confianza: es peor que no tenerlo.
 */
const stripComments = stripSourceComments;

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

test('nadie calcula la reserva inferior con un `max` (esa fórmula deja el CTA pegado a la barra)', () => {
  assert.deepEqual(
    scan((line) => MAX_FORMULA.test(line)),
    [],
    'La reserva del borde inferior NO es `max(inset, mínimo)`: en Android el inset ES la barra de ' +
      'navegación y el aire se le SUMA. Con una barra real de 48dp, `max(48, 12) = 48` deja el ' +
      'contenido soldado a la barra (bug 🔴 en device Android). Usá `useSafeBottomInset()`.',
  );
});

test('ningún call site combina un token del borde inferior con un inset (eso es re-implementar la fórmula)', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== HOOK && EDGE_TOKEN.test(line) && BOTTOM_INSET.test(line)),
    [],
    '`$navBottomMin` / `$navBarGap` no se mezclan a mano con un inset: esa expresión ES la fórmula, y ' +
      'la fórmula vive en `useSafeBottomInset()`. Si la superficie necesita más aire, se lo pide al ' +
      "hook: `useSafeBottomInset({ extra: getTokenValue('$6', 'space') })`.",
  );
});

test('el AIRE (`$navBarGap`) solo se lee en el hook (es el término que NO aplica en todas las plataformas)', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== HOOK && GAP_TOKEN.test(line)),
    [],
    'El aire contra la barra de navegación es SOLO de Android. Leerlo suelto en una pantalla es ' +
      'decidir la plataforma por segunda vez (y, casi seguro, engordar iOS sin razón). Pedí la ' +
      'reserva completa con `useSafeBottomInset()`.',
  );
});

test('el PISO (`$navBottomMin`) no aparece fuera del hook, punto', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== HOOK && FLOOR_TOKEN.test(line)),
    [],
    'El piso del borde inferior se lee en `' +
      HOOK +
      '` y en ningún otro archivo — tampoco como argumento de `useSafeBottomInset({ extra: … })`. ' +
      'Nombrarlo en un call site es declarar 12px de "aire propio" que en realidad ES la reserva ' +
      'canónica escrita de otra forma: así nacieron los 8 footers outlier que dejaban la app con dos ' +
      'reservas distintas (Android 3 botones: 64 vs 76). Si una superficie necesita aire propio de ' +
      "verdad, que use un token de spacing: `useSafeBottomInset({ extra: getTokenValue('$6', 'space') })`.",
  );
});

test('la decisión de plataforma del aire vive en UN solo archivo', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== HOOK && PLATFORM_ANDROID.test(line) && (EDGE_TOKEN.test(line) || BOTTOM_INSET.test(line))),
    [],
    '`Platform.OS === \'android\'` combinado con la reserva inferior solo puede estar en ' +
      `${HOOK}. Si se bifurca, la mitad de la app queda con una fórmula y la otra mitad con otra.`,
  );
});

test('la función pura `computeSafeBottomInset` solo se llama desde el hook', () => {
  assert.deepEqual(
    scan((line, rel) => rel !== HOOK && rel !== 'src/utils/footer-action.ts' && PURE_CALL.test(line)),
    [],
    'Llamar a la pura es tener que decidir `applyGap` a mano — o sea, re-decidir la plataforma. ' +
      'Los componentes usan `useSafeBottomInset()`; el bottom-nav también.',
  );
});

test('el hook decide el aire por PLATAFORMA (no lo deja fijo en true/false)', () => {
  // La única pieza de la fórmula que NO se puede testear con node:test es el hook (importa react-native
  // y tamagui). Sin esto, alguien podría poner `applyGap: true` y volver a la aditiva-en-todas-las-
  // plataformas sin que caiga ningún test: en web/iOS el resultado sería 28/50 en vez de 12/34.
  const src = readFileSync(join(APP_ROOT, HOOK), 'utf8');
  const code = stripComments(src);
  assert.match(
    code,
    PLATFORM_ANDROID,
    'el hook tiene que derivar el aire de la plataforma (Android es la única con barra de navegación ' +
      'opaca ocupando el inset inferior)',
  );
  assert.match(
    code,
    /applyGap:\s*[A-Z_a-z][A-Za-z0-9_]*\s*,/,
    'applyGap se pasa como la constante derivada de Platform, no un literal',
  );
  assert.doesNotMatch(code, /applyGap:\s*(?:true|false)\b/, 'applyGap NO puede ser un literal fijo');
  // Y los dos tokens (piso y aire) se leen efectivamente acá.
  assert.match(code, /getTokenValue\('\$navBottomMin'/);
  assert.match(code, /getTokenValue\('\$navBarGap'/);
});

test('los tokens del borde inferior RESUELVEN (nombre + grupo + valor), no solo se nombran', () => {
  // ── EL MODO DE FALLA QUE CIERRA ESTE TEST ────────────────────────────────────────────────────────
  // `getTokenValue('$navBarGap', 'size')` devuelve `undefined` si el token no existe con ESE nombre en
  // ESE grupo. `computeSafeBottomInset` lo pasa por `nonNegative()` → 0 → **el fix entero se vuelve un
  // no-op en Android** (la reserva vuelve a ser el `max` pelado, o sea el bug 🔴 original) y NO cae
  // NADA: los tests puros hardcodean el 16, y la capture solo mide web, donde `applyGap` es false y el
  // token ni se lee. El bug sería observable únicamente en un device Android — otra vez.
  // Por eso acá se verifica la CADENA COMPLETA en las dos puntas: el hook pide `<nombre, grupo>` y el
  // config define ese `<nombre>` en ese `<grupo>` con un número finito positivo.
  const configSrc = readFileSync(join(APP_ROOT, TAMAGUI_CONFIG), 'utf8');
  const groupBody = tokenGroupBody(configSrc, TOKEN_GROUP);
  const hookCode = stripComments(readFileSync(join(APP_ROOT, HOOK), 'utf8'));

  const resolved: Record<string, number> = {};
  for (const name of EDGE_TOKENS) {
    // (a) el hook lo lee del grupo que vamos a verificar (si alguien lo pide de 'space', no resuelve).
    const read = new RegExp(`getTokenValue\\('\\$${name}',\\s*'([A-Za-z]+)'\\)`).exec(hookCode);
    assert.ok(read, `${HOOK} tiene que leer $${name} con getTokenValue`);
    assert.equal(
      read[1],
      TOKEN_GROUP,
      `el hook pide $${name} del grupo '${read[1]}' pero el token vive en '${TOKEN_GROUP}': ` +
        'getTokenValue devolvería undefined → la reserva se degrada en silencio',
    );

    // (b) el token existe en ese grupo del config…
    const entry = new RegExp(`[\\s{,]${name}:\\s*([^,\\n]+)`).exec(groupBody);
    assert.ok(
      entry,
      `el token \`${name}\` no está en el grupo \`${TOKEN_GROUP}\` de ${TAMAGUI_CONFIG}. ` +
        `Sin él, getTokenValue('$${name}', '${TOKEN_GROUP}') devuelve undefined y la reserva pierde ese término.`,
    );

    // (c) …y su valor es un número finito POSITIVO (un 0 o un NaN también anulan el término).
    const value = Number(entry[1].trim());
    assert.ok(
      Number.isFinite(value) && value > 0,
      `\`${name}\` vale \`${entry[1].trim()}\` en ${TAMAGUI_CONFIG}: tiene que ser un número finito > 0`,
    );
    resolved[name] = value;
  }

  // (d) Los tests PUROS hardcodean estos números (no pueden importar tamagui). Que la copia siga
  //     coincidiendo con el original: si no, la suite queda verde probando una app que no existe.
  for (const { file, constants } of PURE_TEST_CONSTANTS) {
    const src = stripComments(readFileSync(join(APP_ROOT, file), 'utf8'));
    for (const [constName, token] of Object.entries(constants)) {
      const decl = new RegExp(`const\\s+${constName}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`).exec(src);
      assert.ok(decl, `${file} tiene que declarar \`const ${constName} = <número>;\` (espejo de $${token})`);
      assert.equal(
        Number(decl[1]),
        resolved[token],
        `${file} hardcodea ${constName} = ${decl[1]} pero $${token} vale ${resolved[token]} en ` +
          `${TAMAGUI_CONFIG}: los tests puros estarían verificando una fórmula con otros números`,
      );
    }
  }
});

test('el guard DETECTA las firmas (no pasa verde por no estar mirando nada)', () => {
  // Un guard que no puede fallar es un guard muerto. Se verifica sobre las líneas EXACTAS que tenía el
  // repo antes de esta unidad, sin tocar el árbol real.
  assert.ok(
    MAX_FORMULA.test(`  const bottomPad = ${MAX_CALL}(insets.bottom, getTokenValue('$navBottomMin', 'size'));`),
    'la línea que estaba copiada en ~20 archivos debe detectarse',
  );
  assert.ok(MAX_FORMULA.test(`  const bottomPad = ${MAX_CALL}(insets.bottom, getTokenValue('$4', 'space'));`));
  assert.ok(MAX_FORMULA.test(`  const bottomPad = ${MAX_CALL}(bottomInset, getTokenValue('$4', 'space'));`));
  assert.ok(MAX_FORMULA.test(`paddingBottom={${MAX_CALL}( insets.bottom , MIN )}`));

  // La re-implementación ADITIVA a mano (el otro modo de copiar la fórmula) también cae.
  const additive = `  const pad = insets.bottom + getTokenValue('$navBarGap', 'size');`;
  assert.ok(EDGE_TOKEN.test(additive) && BOTTOM_INSET.test(additive));
  const withFloor = `  const pad = safeBottom + getTokenValue('$navBottomMin', 'size');`;
  assert.ok(EDGE_TOKEN.test(withFloor) && BOTTOM_INSET.test(withFloor));

  // El aire suelto en una pantalla, aunque no toque un inset.
  assert.ok(GAP_TOKEN.test(`  const gap = getTokenValue('$navBarGap', 'size');`));

  // La bifurcación de plataforma.
  assert.ok(
    PLATFORM_ANDROID.test("  const pad = Platform.OS === 'android' ? insets.bottom + 16 : insets.bottom;") &&
      BOTTOM_INSET.test("  const pad = Platform.OS === 'android' ? insets.bottom + 16 : insets.bottom;"),
  );

  // Lo CORRECTO no dispara.
  assert.ok(!MAX_FORMULA.test('  const bottomPad = useSafeBottomInset();'));
  assert.ok(!MAX_FORMULA.test(`  const base = ${MAX_CALL}(systemInset + extra, minInset, floor);`)); // la pura
  assert.ok(!MAX_FORMULA.test(`  paddingBottom: insets.bottom + getTokenValue('$6', 'space'),`)); // scroll slack
  // El piso pasado como argumento del hook —la vieja excepción a medida— AHORA ES VIOLACIÓN (regla 4
  // endurecida en el 2º fix-loop). Importa que la cace la regla 4 SOLA: no hay ningún inset en esa
  // línea, así que la regla 2 (token + inset) no la ve. Sin este assert, la regla podría relajarse de
  // nuevo sin que nada caiga, y los 8 footers outlier volverían de a uno.
  const ownFloor = `  const bottomPad = useSafeBottomInset({ extra: getTokenValue('$navBottomMin', 'size') });`;
  assert.ok(!BOTTOM_INSET.test(ownFloor), 'sin inset en la línea, la regla 2 NO la caza');
  assert.ok(FLOOR_TOKEN.test(ownFloor), 'la regla 4 endurecida tiene que cazarla sola');
  // El aire propio LEGÍTIMO (token de spacing, no el piso) sigue pasando limpio por las 4 reglas.
  const ownAir = `  const bottomPad = useSafeBottomInset({ extra: getTokenValue('$6', 'space') });`;
  assert.ok(!MAX_FORMULA.test(ownAir) && !BOTTOM_INSET.test(ownAir));
  assert.ok(!FLOOR_TOKEN.test(ownAir) && !GAP_TOKEN.test(ownAir));
  // Y el `Platform.OS === 'android'` de cualquier OTRA cosa (a11y, haptics) tampoco molesta.
  assert.ok(!BOTTOM_INSET.test("  const label = Platform.OS === 'android' ? a : b;"));

  // Una mención en un comentario tampoco (se blanquea antes de escanear).
  assert.ok(!MAX_FORMULA.test(stripComments(`// antes: ${MAX_CALL}(insets.bottom, MIN)`)));
  assert.ok(!GAP_TOKEN.test(stripComments('/* el aire vive en $navBarGap */')));

  // La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// safe-bottom-disable-next-line -- overlay que NO toca el borde'));
  assert.ok(!DISABLE_NEXT_LINE.test('// safe-bottom-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// safe-bottom-disable-next-line --'));
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  // Un verificador roto y un verificador que no encuentra nada se ven igual: verde. Acá el guard audita
  // su propia entrada — cuántos archivos vio y si los vio completos. Detalle en `utils/scan-coverage.ts`.
  assertScanCoverage({
    guard: 'safe-bottom-inset',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: (f) => relative(APP_ROOT, f).split(sep).join('/'),
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripComments,
  });
});

test('el guard recorre el árbol real (y ve los archivos que tenían la fórmula copiada)', () => {
  const scanned = ROOTS.flatMap(listFiles);
  assert.ok(scanned.length >= SCANNED_FILES_FLOOR, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  for (const expected of [
    join('app', 'maniobra', '_components', 'ExitJornadaSheet.tsx'), // uno de los ~20 sheets migrados
    join('src', 'components', 'FooterActionShell.tsx'), // el primitivo del CTA
    join('src', 'hooks', 'useSafeBottomInset.ts'), // la fuente única (usa los tokens permitidos)
  ]) {
    assert.ok(
      scanned.some((f) => f.endsWith(expected)),
      `${expected} debería estar dentro del árbol escaneado`,
    );
  }
  // Y el hook está donde el guard lo exime: si se mueve, las exenciones dejan de aplicar en silencio.
  assert.ok(
    scanned.some((f) => relative(APP_ROOT, f).split(sep).join('/') === HOOK),
    `${HOOK} tiene que existir con ese path exacto (es el allowlist del guard)`,
  );
});
