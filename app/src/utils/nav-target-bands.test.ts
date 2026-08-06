// Tests de la geometría de los targets del borde inferior (bugfix 🔴 «el FAB le roba los taps a la banda
// de arriba del nav», 2026-08-06). node:test, puro.
//
// Lo que se fija acá:
//   (a) el TARGET del FAB y el del pill del bastón **no se tocan**, y la separación es ≥ el piso;
//   (b) esa separación NO depende de la plataforma (el inset inferior se cancela) — o sea, verificarlo
//       una vez alcanza para web / iOS / Android gestos / Android 3 botones;
//   (c) el CONTRAFÁCTICO: con los tokens que tenía el repo antes del fix, el modelo da SOLAPE, y del
//       tamaño que se midió en el device. Sin esto, (a) podría estar pasando por casualidad.
//   (d) el target del pill llega al mínimo de la app para targets compactos (`$chipMin`).
//
// ⚠️ Los números de abajo son COPIAS de los tokens reales (un test puro no puede importar tamagui, que
// arrastra react-native). Que la copia siga coincidiendo con el original lo verifica
// `tap-target-collision-guard.test.ts`, que lee `tamagui.config.ts` y los tokens de space de verdad. Una
// copia que nadie compara con el original es exactamente cómo una suite se queda verde describiendo una
// app que ya no existe.
//
// La segunda mitad del archivo (a partir de «EL RESOLVEDOR») no prueba geometría sino la TRADUCCIÓN de
// un fuente de producción a números: es el motor que usan el guard estático y el E2E para no medir un
// espejo. Ahí las gramáticas de los mutantes que burlaron a las versiones anteriores del guard quedan
// fijadas una por una.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_TAP_TARGET_SEPARATION,
  TargetResolutionError,
  bandSeparation,
  bandsOverlap,
  evaluateDp,
  fabCircleBand,
  fabTargetBand,
  insetsWithDefaults,
  jsxPropExpressions,
  REAL_BOTTOM_RESERVES,
  navGeometryFromConfig,
  resolveByReserve,
  resolveFabHitSlop,
  resolveInsetSides,
  sizeTokenFromConfig,
  stickPillBand,
  tabBarTop,
  type NavTargetTokens,
  type ResolveEnv,
} from './nav-target-bands.ts';

// ─── Tokens reales del design system (espejo verificado por el guard) ────────────────────
const NAV_BAR = 60; // $navBar
const NAV_ITEM_TOP = 2; // $navItemTop
const FAB = 64; // $fab
const FAB_RAISE = 26; // $fabRaise = round(64 * 0.40)
/**
 * Alto PINTADO del pill (`lineHeight $2` + `paddingVertical $2` ×2 + borde ×2). NO sale de un token:
 * lo produce el contenido. Quien lo mide de verdad es `e2e/fab-target-geometry.spec.ts` — acá es un
 * dato de entrada del modelo, y por eso NO lo cruza `tap-target-collision-guard` contra ningún token.
 * El pill **no es un target** (`pointerEvents="none"`), así que no aplica ningún mínimo de tap.
 */
const PILL_PAINTED_HEIGHT = 33;
const PILL_GAP = 18; // space.$4 — el gap AS-BUILT del pill (antes: space.$2 = 7)

/**
 * Las cuatro reservas inferiores reales (web · iOS · Android gestos · Android 3 botones).
 * Sale del módulo, no de una copia: el guard estático calcula bandas con esta MISMA lista, y dos listas
 * de plataformas que pueden divergir son otra vez el problema del espejo.
 */
const RESERVES = REAL_BOTTOM_RESERVES;

/** Separación AS-BUILT pill↔FAB. `pillGap + navItemTop` = 18 + 2. Cambiarla es una decisión de diseño. */
const AS_BUILT_SEPARATION = 20;

function tokens(over: Partial<NavTargetTokens> = {}): NavTargetTokens {
  return {
    safeBottomInset: 12,
    navBar: NAV_BAR,
    navItemTop: NAV_ITEM_TOP,
    fab: FAB,
    fabRaise: FAB_RAISE,
    fabHitSlopTop: 0, // AS-BUILT: el `top` se sacó. Es EL fix.
    fabHitSlopBottom: Math.max(0, NAV_BAR - NAV_ITEM_TOP - (FAB - FAB_RAISE)), // = 20
    pillGap: PILL_GAP,
    pillHeight: PILL_PAINTED_HEIGHT,
    ...over,
  };
}

/** Los tokens tal como estaban en `1f1c002`, con el bug puesto. */
function buggyTokens(over: Partial<NavTargetTokens> = {}): NavTargetTokens {
  return tokens({
    fabHitSlopTop: FAB_RAISE, // el `hitSlop.top` que se sacó
    pillGap: 7, // space.$2
    ...over,
  });
}

// ─── (a) El invariante ───────────────────────────────────────────────────────────────────

test('el target del FAB y el del pill NO se solapan', () => {
  for (const safeBottomInset of RESERVES) {
    const t = tokens({ safeBottomInset });
    assert.equal(
      bandsOverlap(fabTargetBand(t), stickPillBand(t)),
      false,
      `con reserva inferior ${safeBottomInset} los dos targets se pisan`,
    );
  }
});

test('la separación entre los dos targets respeta el piso de la app', () => {
  for (const safeBottomInset of RESERVES) {
    const t = tokens({ safeBottomInset });
    const separation = bandSeparation(fabTargetBand(t), stickPillBand(t));
    assert.ok(
      separation >= MIN_TAP_TARGET_SEPARATION,
      `separación ${separation} dp < piso ${MIN_TAP_TARGET_SEPARATION} dp (reserva ${safeBottomInset})`,
    );
  }
});

test('la separación AS-BUILT es 20 dp (si la cambiás a propósito, cambiá este número y decí por qué)', () => {
  // Change-detector deliberado, ADEMÁS del piso: 4 dp de deriva silenciosa hacia el piso serían un
  // empeoramiento real del diseño que ningún test vería.
  assert.equal(bandSeparation(fabTargetBand(tokens()), stickPillBand(tokens())), AS_BUILT_SEPARATION);
});

// ─── (b) La separación no depende de la plataforma ───────────────────────────────────────

test('la separación es INDEPENDIENTE de la reserva inferior (el inset se cancela)', () => {
  // Estructural: los dos anclajes arrancan de `safeBottomInset + navBar`, así que el inset desaparece de
  // la resta. Vale la pena fijarlo: si alguien ancla el pill al inset PELADO (que es como estaba antes de
  // la unidad «aire»), esta propiedad se rompe y el bug vuelve SOLO en Android.
  const separations = RESERVES.map((safeBottomInset) =>
    bandSeparation(fabTargetBand(tokens({ safeBottomInset })), stickPillBand(tokens({ safeBottomInset }))),
  );
  assert.deepEqual(separations, [AS_BUILT_SEPARATION, AS_BUILT_SEPARATION, AS_BUILT_SEPARATION, AS_BUILT_SEPARATION]);
});

test('desincronizar el pill del nav (anclarlo al inset pelado) SÍ rompe la separación en Android', () => {
  // Contrafáctico de la propiedad de arriba: el pill anclado a un inset de 0 mientras el nav reserva 64.
  const nav = tokens({ safeBottomInset: 64 });
  const pillAnchoredToRawInset = stickPillBand(tokens({ safeBottomInset: 0 }));
  assert.ok(bandsOverlap(fabTargetBand(nav), pillAnchoredToRawInset));
});

// ─── (c) El contrafáctico: el modelo reproduce el bug medido ─────────────────────────────

test('CONTRAFÁCTICO: con los tokens de `1f1c002` el modelo da SOLAPE (el bug 🔴 que se arregló)', () => {
  const t = buggyTokens();
  assert.equal(bandsOverlap(fabTargetBand(t), stickPillBand(t)), true);
  // 17 y no 16: el modelo ignora el borde de 1 px del tabBar, a propósito y del lado seguro (ver el
  // docblock del módulo). El DOM midió 16 dp y el device 30 px = 16 dp.
  assert.equal(bandSeparation(fabTargetBand(t), stickPillBand(t)), -17);
  // Y coincide con el síntoma reportado: casi la mitad de abajo del pill le pertenecía al FAB.
  const pill = stickPillBand(t);
  const stolen = fabTargetBand(t).top - pill.bottom;
  assert.equal(Math.round((stolen / (pill.top - pill.bottom)) * 100), 52); // DOM: 48 % (el 1 px de borde)
});

test('CONTRAFÁCTICO: re-agregar SOLO el `hitSlop.top` ya rompe el invariante (aunque el aire sea el nuevo)', () => {
  const t = tokens({ fabHitSlopTop: FAB_RAISE });
  assert.equal(bandsOverlap(fabTargetBand(t), stickPillBand(t)), true);
  assert.equal(bandSeparation(fabTargetBand(t), stickPillBand(t)), -6);
});

test('CONTRAFÁCTICO: volver el gap del pill a `$2` cae por debajo del piso (aunque el slop sea 0)', () => {
  const t = tokens({ pillGap: 7 });
  assert.equal(bandSeparation(fabTargetBand(t), stickPillBand(t)), 9);
  assert.ok(9 < MIN_TAP_TARGET_SEPARATION);
});

test('CONTRAFÁCTICO: agrandar el pill hacia ABAJO (hitSlop.bottom) también lo rompe', () => {
  // Un pill de 40 con 12 de slop inferior "para que sea más fácil de tocar" se come el aire entero.
  const t = tokens();
  const pill = stickPillBand(t);
  const withSlopDown = { bottom: pill.bottom - 12, top: pill.top };
  assert.ok(bandSeparation(fabTargetBand(t), withSlopDown) < MIN_TAP_TARGET_SEPARATION);
});

// ─── (d) El pill NO es un target, y eso no lo saca del invariante ────────────────────────

test('el invariante se mide contra la banda PINTADA del pill, no contra un target suyo', () => {
  // El pill es `pointerEvents="none"` (se intentó hacerlo tocable el 2026-08-06 y se revirtió: se
  // superponía a CTAs de manga). Eso **no** vuelve inofensivo que el FAB se meta en su banda: el toque
  // atraviesa el pill y cae en lo que hay debajo — y si el target inflado del FAB llega hasta ahí, lo que
  // hay debajo ES el FAB. El operario toca un chip de estado y se le abre MODO MANIOBRAS. Que es,
  // literalmente, el reporte de Raf.
  const t = tokens();
  const pill = stickPillBand(t);
  assert.equal(pill.top - pill.bottom, PILL_PAINTED_HEIGHT, 'la banda del modelo es la PINTADA');
  // Con el bug puesto, el FAB llegaba adentro de esa banda pintada aunque el pill no fuera tocable.
  assert.ok(fabTargetBand(buggyTokens()).top > stickPillBand(buggyTokens()).bottom);
  // Y hoy no llega.
  assert.ok(fabTargetBand(t).top < pill.bottom);
});

// ─── Geometría del FAB: que el fix no haya creado una zona muerta ────────────────────────

test('el círculo ENTERO del FAB sigue dentro de su propio target sin el `hitSlop.top`', () => {
  // Es la contracara del fix, y estaba VERIFICADA en device antes de aplicarlo: el target dispara 86 px
  // por encima del techo de la barra, o sea el tabBar NO recorta. Sacar el `top` no puede dejar muerta la
  // parte elevada del círculo, porque el círculo es alcanzable por sus propios bounds.
  const t = tokens();
  const circle = fabCircleBand(t);
  const target = fabTargetBand(t);
  assert.ok(target.top >= circle.top, 'el target tiene que cubrir el círculo pintado hacia arriba');
  assert.ok(target.bottom <= circle.bottom, 'y hacia abajo');
  assert.equal(target.top, circle.top, 'sin slop superior, el techo del target ES el del círculo');
});

test('el `hitSlop.bottom` del FAB llega justo al pie de la celda y NO invade la reserva del sistema', () => {
  for (const safeBottomInset of RESERVES) {
    const t = tokens({ safeBottomInset });
    // El pie del target coincide con el inicio del paddingBottom del nav: cubre el label "Maniobra" y
    // ni un dp más (por debajo está la barra de navegación del SO).
    assert.equal(fabTargetBand(t).bottom, safeBottomInset);
  }
});

test('el FAB asoma ~40% por encima del nav (la premisa de B4 que la geometría del pill usa)', () => {
  const t = tokens();
  const exposed = fabCircleBand(t).top - tabBarTop(t);
  assert.equal(exposed, FAB_RAISE - NAV_ITEM_TOP); // 24 dp de círculo por encima de la línea del nav
});

// ─── Robustez ────────────────────────────────────────────────────────────────────────────

test('NaN / negativos / no-finitos se tratan como 0 y no producen bandas invertidas', () => {
  const t = tokens({ safeBottomInset: NaN, navItemTop: -5, pillGap: Infinity });
  for (const band of [fabCircleBand(t), fabTargetBand(t), stickPillBand(t)]) {
    assert.ok(Number.isFinite(band.top) && Number.isFinite(band.bottom));
    assert.ok(band.top >= band.bottom, 'una banda nunca puede quedar invertida');
  }
});

test('`bandSeparation` no depende del orden de los argumentos', () => {
  const t = tokens();
  const [fab, pill] = [fabTargetBand(t), stickPillBand(t)];
  assert.equal(bandSeparation(fab, pill), bandSeparation(pill, fab));
});

test('tocarse exactamente YA cuenta como solapado (un dedo no distingue 0 dp)', () => {
  assert.equal(bandsOverlap({ bottom: 0, top: 10 }, { bottom: 10, top: 20 }), true);
  assert.equal(bandsOverlap({ bottom: 0, top: 10 }, { bottom: 11, top: 20 }), false);
});

// ═══ EL RESOLVEDOR: leer el VALOR REAL del target, no la forma en que está escrito ═══════════════════
//
// Esto es el motor de los dos oráculos (el guard estático y el E2E). Si acá se cuela una gramática, el
// bug 🔴 vuelve entero con los dos en verde — que es exactamente lo que pasó con el extractor anterior,
// que partía el objeto por LÍNEAS y se quedaba con la primera clave de cada una.

/** Entorno de prueba: `getTokenValue('$x','size'|'space')` con una tabla chica. */
const SIZE: Record<string, number> = { navBar: 60, navItemTop: 2, fab: 64, fabRaise: 26 };
const SPACE: Record<string, number> = { '4': 18, '6': 32, '2': 7 };
const env = (src: string, scope?: Record<string, number>): ResolveEnv => ({
  src,
  token: (name, group) => (group === 'size' ? SIZE[name] : group === 'space' ? SPACE[name] : undefined),
  scope,
});

/** El `const` del FAB tal cual está escrito hoy en `app/(tabs)/_layout.tsx`. */
const REAL_SHAPE = `
  const FAB_SIZE = COLOR.fabSize;
  const FAB_RAISE = COLOR.fabRaise;
  const HIT_SLOP = {
    bottom: Math.max(0, COLOR.navHeight - COLOR.navItemTop - (FAB_SIZE - FAB_RAISE)),
  };
  function navColors() {
    return {
      fabSize: getTokenValue('$fab', 'size'),
      fabRaise: getTokenValue('$fabRaise', 'size'),
      navItemTop: getTokenValue('$navItemTop', 'size'),
      navHeight: getTokenValue('$navBar', 'size'),
    };
  }
  const COLOR = navColors();
`;

test('RESOLVEDOR: la forma AS-BUILT resuelve al valor real (20 dp hacia abajo y NADA hacia arriba)', () => {
  const sides = resolveInsetSides('HIT_SLOP', env(REAL_SHAPE));
  assert.deepEqual(sides, { bottom: 20 });
  assert.deepEqual(insetsWithDefaults(sides), { top: 0, right: 0, bottom: 20, left: 0 });
});

test('RESOLVEDOR: el mutante de UNA SOLA LÍNEA queda visible (el extractor viejo lo perdía)', () => {
  // ── MUTANTE MEDIDO (2026-08-06): con esto el guard daba 35/35 en VERDE y el bug 🔴 estaba puesto ──
  // El extractor anterior partía el cuerpo del objeto por `\n` y aplicaba `^\s*clave:` a cada línea, así
  // que se quedaba con la PRIMERA clave de cada línea: `top` desaparecía por escribirlo al lado de
  // `bottom`. Ahora las entradas se parten por COMAS de primer nivel: la grafía no cambia el valor.
  const src = REAL_SHAPE.replace(
    /const HIT_SLOP = \{[\s\S]*?\};/,
    'const HIT_SLOP = { bottom: Math.max(0, COLOR.navHeight - COLOR.navItemTop - (FAB_SIZE - FAB_RAISE)), top: FAB_RAISE };',
  );
  assert.deepEqual(resolveInsetSides('HIT_SLOP', env(src)), { bottom: 20, top: 26 });
});

test('RESOLVEDOR: el override con SPREAD en el sitio de uso resuelve al valor efectivo', () => {
  // El mutante del reviewer. No se rechaza por "tener un spread": se RESUELVE, y el `top: 26` queda a la
  // vista. Da igual el orden: la última clave gana, como en JS.
  assert.deepEqual(resolveInsetSides('{ ...HIT_SLOP, top: FAB_RAISE }', env(REAL_SHAPE)), { bottom: 20, top: 26 });
  assert.deepEqual(resolveInsetSides('{ top: FAB_RAISE, ...HIT_SLOP }', env(REAL_SHAPE)), { top: 26, bottom: 20 });
  // Y el spread ADENTRO del const (la variante que esquivaba al extractor por no tener forma `clave:`).
  const src = REAL_SHAPE.replace(
    /const HIT_SLOP = \{[\s\S]*?\};/,
    'const EXTRA = { top: FAB_RAISE };\n  const HIT_SLOP = {\n    bottom: 20,\n    ...EXTRA,\n  };',
  );
  assert.deepEqual(resolveInsetSides('HIT_SLOP', env(src)), { bottom: 20, top: 26 });
});

test("RESOLVEDOR: la clave QUOTEADA es la misma clave ('top' no es un lado distinto de top)", () => {
  assert.deepEqual(resolveInsetSides("{ bottom: 20, 'top': 26 }", env(REAL_SHAPE)), { bottom: 20, top: 26 });
  assert.deepEqual(resolveInsetSides('{ bottom: 20, "top": 26 }', env(REAL_SHAPE)), { bottom: 20, top: 26 });
});

test('RESOLVEDOR: lo que NO puede leer, TIRA (fail-closed) — nunca devuelve un objeto incompleto', () => {
  // Cada una de estas formas dejaría un lado del target invisible. Un guard que las "ignora" es un guard
  // que miente; uno que las rechaza obliga a extenderlo antes de usarlas. Eso es lo correcto acá.
  const nope = (expr: string, why: string) =>
    assert.throws(() => resolveInsetSides(expr, env(REAL_SHAPE)), TargetResolutionError, why);
  nope('{ bottom: 20, ["to" + "p"]: 26 }', 'clave computada');
  nope('{ bottom: 20, [SIDE]: 26 }', 'clave computada por variable');
  nope('big ? HIT_SLOP : { top: 26 }', 'ternario');
  nope('Object.assign({}, HIT_SLOP, { top: 26 })', 'llamada');
  nope('withTop(HIT_SLOP, 26)', 'helper');
  nope('{ bottom: 20, top: readTop() }', 'valor que sale de una llamada');
  nope('{ bottom: 20, top: IMPORTADO_DE_OTRO_MODULO }', 'identificador que no está en el archivo');
  nope('{ ...SPREAD_QUE_NO_EXISTE }', 'spread de algo que no está declarado acá');
  // Y el ciclo, que si no cortaría en stack overflow en vez de en un mensaje.
  assert.throws(() => resolveInsetSides('A', env('const A = { ...A };')), TargetResolutionError, 'ciclo');
});

test('RESOLVEDOR: la aritmética real se evalúa (tokens, consts encadenadas, Math.max, paréntesis)', () => {
  const e = env(REAL_SHAPE);
  assert.equal(evaluateDp("getTokenValue('$navBar', 'size')", e), 60);
  assert.equal(evaluateDp("getTokenValue('$4', 'space')", e), 18);
  assert.equal(evaluateDp('COLOR.navHeight - COLOR.navItemTop', e), 58);
  assert.equal(evaluateDp('FAB_SIZE - FAB_RAISE', e), 38); // dos saltos: FAB_SIZE → COLOR.fabSize → token
  assert.equal(evaluateDp('Math.max(0, 5 - 9)', e), 0);
  assert.equal(evaluateDp('Math.min(4, 9) * 2', e), 8);
  // El scope del llamador gana (así se resuelve un anclaje con la reserva inferior puesta en 0).
  assert.equal(evaluateDp("safeBottom + getTokenValue('$navBar', 'size')", env('', { safeBottom: 0 })), 60);
  assert.equal(evaluateDp("safeBottom + getTokenValue('$navBar', 'size')", env('', { safeBottom: 34 })), 94);
  // Y lo que no es aritmética resoluble, tira.
  assert.throws(() => evaluateDp('cond ? 1 : 2', e), TargetResolutionError);
  assert.throws(() => evaluateDp("getTokenValue('$navBar', 'inventado')", e), TargetResolutionError);
  assert.throws(() => evaluateDp('noExiste + 1', e), TargetResolutionError);
});

test('RESOLVEDOR: `jsxPropExpressions` extrae la expresión BALANCEADA aunque cruce líneas', () => {
  const jsx = 'bottom={\n  safeBottom +\n  getTokenValue("$navBar", "size")\n}';
  assert.equal(jsxPropExpressions(jsx, 'bottom')[0].expr, 'safeBottom + getTokenValue("$navBar", "size")');
  assert.equal(jsxPropExpressions('<X hitSlop={{ ...A, top: 1 }} />', 'hitSlop')[0].expr, '{ ...A, top: 1 }');
  assert.equal(jsxPropExpressions('<X hitSlop={8} />', 'hitSlop')[0].expr, '8');
  assert.equal(jsxPropExpressions('<X onPress={go} />', 'hitSlop').length, 0);
});

test('RESOLVEDOR: los tokens salen del config REAL, incluidos los DERIVADOS', () => {
  const config = `
    const FAB_SIZE = 64;
    const FAB_RAISE_RATIO = 0.4;
    export const config = createTokens({
      size: {
        navBar: 60,
        navItemTop: 2,
        fab: FAB_SIZE,
        fabRaise: Math.round(FAB_SIZE * FAB_RAISE_RATIO),
      },
      space: { $4: 18 },
    });
  `;
  assert.deepEqual(navGeometryFromConfig(config), { navBar: 60, navItemTop: 2, fab: 64, fabRaise: 26 });
  // Cambiar el ratio mueve la geometría entera: el resolvedor lo ve (no lee un literal).
  assert.equal(sizeTokenFromConfig(config.replace('0.4', '0.55'), 'fabRaise'), 35);
  assert.throws(() => sizeTokenFromConfig(config, 'noExiste'), TargetResolutionError);
});

test('RESOLVEDOR: `resolveFabHitSlop` lee el JSX, no la declaración (el override no se le escapa)', () => {
  const config = 'export const config = createTokens({ size: { navBar: 60, navItemTop: 2, fab: 64, fabRaise: 26 } });';
  const layout = `${REAL_SHAPE}\n  <Pressable hitSlop={HIT_SLOP} />`;
  assert.deepEqual(resolveFabHitSlop(layout, config).sides, { bottom: 20 });
  // El override en el sitio de uso cambia el VALOR aunque la declaración quede intacta.
  assert.deepEqual(
    resolveFabHitSlop(layout.replace('hitSlop={HIT_SLOP}', 'hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}'), config).sides,
    { bottom: 20, top: 26 },
  );
  // Un `hitSlop` MENCIONADO en un comentario no cuenta como uso…
  assert.deepEqual(resolveFabHitSlop(`${layout}\n  // antes: hitSlop={{ top: 26 }}`, config).sides, { bottom: 20 });
  // …pero un SEGUNDO hitSlop de verdad en el mismo archivo sí: esconde un target detrás del otro.
  assert.throws(
    () => resolveFabHitSlop(`${layout}\n  <Pressable hitSlop={12} />`, config),
    TargetResolutionError,
    'dos hitSlop en el dueño del FAB',
  );
});

test('RESOLVEDOR: `resolveByReserve` da la COORDENADA, sin importar la grafía del anclaje', () => {
  // ── EL 🔴 DEL RE-REVIEW (2026-08-06) ───────────────────────────────────────────────────────────────
  // La firma vieja del anclaje era `expr.includes('+')`. `Math.max(insets.bottom, 86)` llega al MISMO
  // destino sin un solo `+`, así que pasaba. La pregunta correcta nunca fue "¿tiene un más?" sino "¿en
  // qué coordenada termina esto?" — y eso se calcula.
  const mk = (reserve: number) => env('', { safeBottom: reserve, 'insets.bottom': reserve });

  const suma = resolveByReserve('safeBottom + 86', mk);
  assert.deepEqual(suma.values, [98, 120, 126, 150]);
  assert.equal(suma.dependsOnReserve, true);

  // `Math.max`: se queda QUIETO en 86 en las cuatro plataformas — o sea, adentro de la banda del FAB en
  // todas (el techo del target del FAB está en reserva+84: 96 · 118 · 124 · 148).
  const max = resolveByReserve('Math.max(insets.bottom, 86)', mk);
  assert.deepEqual(max.values, [86, 86, 86, 86]);
  assert.equal(max.dependsOnReserve, false, 'no depende de la reserva… y por eso es PEOR, no mejor');
  REAL_BOTTOM_RESERVES.forEach((reserve, i) => {
    const t = tokens({ safeBottomInset: reserve });
    assert.ok(max.values[i] < fabTargetBand(t).top, `con reserva ${reserve} el overlay cae DENTRO del FAB`);
  });

  // La grafía no cambia el número: estas tres son el mismo anclaje que el del pill.
  const conTokens = "safeBottom + getTokenValue('$navBar','size') + getTokenValue('$fabRaise','size') + getTokenValue('$4','space')";
  assert.deepEqual(resolveByReserve(conTokens, mk).values, [116, 138, 144, 168]);
  assert.deepEqual(resolveByReserve('safeBottom + 104', mk).values, [116, 138, 144, 168]);
  assert.deepEqual(resolveByReserve('Math.min(safeBottom + 104, 999)', mk).values, [116, 138, 144, 168]);

  // Y lo que no se puede resolver, TIRA: una coordenada que el guard no puede calcular es una coordenada
  // sin verificar (el elemento se coloca igual).
  assert.throws(() => resolveByReserve('safeBottom + alturaDelToast', mk), TargetResolutionError);
});

test('EL INVARIANTE, con el valor resuelto: cualquier `top` > 0 come el aire del pill', () => {
  // La traducción de "el resolvedor ve el top" a "esto es un bug": no hace falta que el top sea 26. El
  // aire as-built es 20 dp, así que CUALQUIER slop superior come separación, y a partir de 5 dp cae por
  // debajo del piso de la app. Por eso el registro exige `{bottom}` a secas y no "un top chico".
  for (const top of [1, 5, 12, 26]) {
    const t = tokens({ fabHitSlopTop: top });
    const separation = bandSeparation(fabTargetBand(t), stickPillBand(t));
    assert.equal(separation, AS_BUILT_SEPARATION - top);
    if (top > AS_BUILT_SEPARATION - MIN_TAP_TARGET_SEPARATION) {
      assert.ok(separation < MIN_TAP_TARGET_SEPARATION, `un top de ${top} dp ya cae por debajo del piso`);
    }
  }
});
