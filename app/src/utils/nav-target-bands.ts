// nav-target-bands — geometría PURA de los targets que conviven en el borde INFERIOR de la app.
//
// ── EL BUG QUE CIERRA (🔴 device Android, reporte de Raf, 2026-08-05) ────────────────────────────────
// El `Pressable` del FAB de Maniobra llevaba `hitSlop={{ top: $fabRaise }}` (26 dp). Eso extendía su
// TARGET 26 dp por encima del círculo PINTADO, o sea dentro de la banda donde el chrome ancla el pill de
// estado del bastón (`StickStatusIndicator`) — con 10 dp de aire entre los dos. Resultado: tocar la mitad
// de abajo del pill abría MODO MANIOBRAS.
//
// El comentario de `_layout.tsx` que justificaba ese `top` afirmaba en negrita que "NO recupera un solo
// píxel HOY, en NINGUNA de las dos plataformas". Era falso en Android. Medido con dos métodos:
//   · WEB (cajas del DOM @412×915): pill bottom=810 · círculo top=820 · techo del target con slop y=794
//     → solape de 16 dp = 48 % inferior del pill.
//   · DEVICE A07 (720×1600, densidad 300 → 1 dp = 1,875 px): techo PINTADO del círculo y=1324 (Pillow
//     sobre `screencap`); techo TÁCTIL y=1276 (barrido de `input tap`) → 48 px = 25,6 dp ≈ $fabRaise, y
//     30 px = 16 dp de solape. Los dos métodos coinciden en el 48 %.
//
// ── POR QUÉ UN MÓDULO PURO Y NO UN TEST DE COMPORTAMIENTO ───────────────────────────────────────────
// Porque **ningún test de comportamiento en web puede ver este bug**: `hitSlop` es NO-OP en
// react-native-web 0.21.2 (`Pressable` no lo implementa; la única aparición en el paquete está en el
// módulo legacy `Touchable`). Un "toco el pill y no navego a maniobra" en web pasa con el bug puesto.
// La única verificación barata y determinista es ARITMÉTICA: derivar las dos bandas de los tokens y
// exigir que no se toquen. El complemento de runtime es `e2e/fab-target-geometry.spec.ts`, que mide las
// cajas reales y caza el drift de layout que la aritmética no ve.
//
// ⚠️ Este archivo tiene DOS mitades. La primera es el MODELO (bandas puras, sin dependencias). La segunda
// —a partir de «RESOLUCIÓN DEL VALOR REAL»— traduce un fuente de producción a números en dp, y existe
// para que el guard estático y el E2E usen **la misma** traducción en vez de dos aproximaciones distintas
// (que fue exactamente cómo el guard se dejó burlar dos veces). Ninguna de las dos mitades importa
// react-native, así que las dos corren en node:test y bajo Playwright.
//
// ── SISTEMA DE COORDENADAS ──────────────────────────────────────────────────────────────────────────
// Todo se mide en dp **hacia ARRIBA desde el borde inferior de la pantalla** (`y_up`). Es la dirección
// natural acá: las tres piezas (nav, FAB, pill) están ancladas al fondo, así que sus posiciones no
// dependen del alto del viewport. Una `Band` es `{ bottom, top }` con `top > bottom`.
//
// ⚠️ El modelo IGNORA el borde superior de 1 px del tabBar (`borderTopColor`), que en el DOM real empuja
// el contenido del nav 1 px hacia abajo. Es deliberado y va en la dirección SEGURA: el modelo coloca el
// círculo 1 dp MÁS ARRIBA que la realidad, o sea calcula 1 dp MENOS de separación de la que hay. Por eso
// el modelo dice 17 dp de solape donde el DOM midió 16, y dirá 20 dp de aire donde el DOM mide 21.

import { stripSourceComments } from './strip-comments';

/** Tokens y medidas que definen la geometría del borde inferior. Todos en dp. */
export interface NavTargetTokens {
  /** Reserva inferior compartida (`useSafeBottomInset()`) = paddingBottom real del tabBar. */
  safeBottomInset: number;
  /** Alto de CONTENIDO del bottom-nav (token `$navBar`). */
  navBar: number;
  /** paddingTop de cada item del nav (token `$navItemTop`). Empuja el círculo hacia abajo. */
  navItemTop: number;
  /** Diámetro del círculo del FAB (token `$fab`). */
  fab: number;
  /** Cuánto sube el FAB sobre la barra (token `$fabRaise`, marginTop negativo). */
  fabRaise: number;
  /** `hitSlop.top` del Pressable del FAB. **Tiene que ser 0**: ver la cabecera. */
  fabHitSlopTop: number;
  /** `hitSlop.bottom` del Pressable del FAB (crece hacia DENTRO del nav; ahí no hay vecinos). */
  fabHitSlopBottom: number;
  /** Gap declarado entre el borde de abajo del pill y el PICO del FAB (token de space del pill). */
  pillGap: number;
  /**
   * Alto PINTADO del pill (no es un target: el pill es `pointerEvents="none"` — ver el bloque ⛔ de
   * `StickStatusIndicator.tsx`). Sale del contenido (`lineHeight $2` + `paddingVertical $2` ×2 + borde
   * ×2); quien lo mide de verdad es `e2e/fab-target-geometry.spec.ts`, acá viaja como dato.
   */
  pillHeight: number;
}

/** Franja vertical en `y_up` (dp sobre el borde inferior de la pantalla). `top > bottom`. */
export interface Band {
  bottom: number;
  top: number;
}

/** Normaliza a número finito ≥ 0 (defiende de NaN/undefined/negativos de un token roto). */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Borde SUPERIOR del bottom-nav (donde arranca la celda de cada tab). */
export function tabBarTop(t: NavTargetTokens): number {
  return nonNegative(t.safeBottomInset) + nonNegative(t.navBar);
}

/**
 * El círculo PINTADO del FAB. Arranca en el techo del nav, baja el `paddingTop` del item y sube
 * `$fabRaise` por el marginTop negativo: `tabBarTop - navItemTop + fabRaise`.
 */
export function fabCircleBand(t: NavTargetTokens): Band {
  const top = tabBarTop(t) - nonNegative(t.navItemTop) + nonNegative(t.fabRaise);
  return { bottom: top - nonNegative(t.fab), top };
}

/** El TARGET del FAB = el círculo pintado expandido por su `hitSlop`. Es lo que responde al toque. */
export function fabTargetBand(t: NavTargetTokens): Band {
  const circle = fabCircleBand(t);
  return {
    bottom: circle.bottom - nonNegative(t.fabHitSlopBottom),
    top: circle.top + nonNegative(t.fabHitSlopTop),
  };
}

/**
 * La banda PINTADA del pill del bastón, anclada `pillGap` por encima del PICO del FAB.
 *
 * ⚠️ El pill NO es un target (`pointerEvents="none"`), y eso **no vuelve inofensivo** que el FAB se meta
 * acá: fue exactamente el bug 🔴 original. El toque atraviesa el pill y cae en lo que hay DEBAJO — y si
 * el target inflado del FAB llega hasta acá, lo que hay debajo es el FAB. El operario toca lo que ve (un
 * chip de estado) y se le abre MODO MANIOBRAS. Por eso el invariante se mide contra la banda PINTADA:
 * es lo que el usuario percibe como "una cosa", tenga o no `onPress`.
 */
export function stickPillBand(t: NavTargetTokens): Band {
  const bottom = tabBarTop(t) + nonNegative(t.fabRaise) + nonNegative(t.pillGap);
  return { bottom, top: bottom + nonNegative(t.pillHeight) };
}

/**
 * Separación entre dos bandas, en dp. **Negativo = se SOLAPAN** (y el valor es cuánto). No asume cuál
 * está arriba: es la distancia entre los bordes enfrentados.
 */
export function bandSeparation(a: Band, b: Band): number {
  const [lower, upper] = a.bottom <= b.bottom ? [a, b] : [b, a];
  return upper.bottom - lower.top;
}

/** ¿Dos targets se pisan? Tocarse exactamente (separación 0) YA es solaparse para un dedo. */
export function bandsOverlap(a: Band, b: Band): boolean {
  return bandSeparation(a, b) <= 0;
}

/**
 * Separación MÍNIMA aceptable entre dos targets adyacentes de esta app, en dp.
 *
 * Material pide ≥8 dp entre targets adyacentes. Acá se DUPLICA por la misma razón por la que
 * `$navBarGap` vale 16 y no 8: se usa con guante, con una mano, a veces con barro (CLAUDE.md principio
 * 4), y el vecino de este target concreto es el CTA más importante de la app — equivocarse saca al
 * operario de lo que estaba haciendo. El as-built es 20 dp; este es el piso por debajo del cual el
 * guard corta.
 */
export const MIN_TAP_TARGET_SEPARATION = 16;

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLUCIÓN DEL VALOR REAL — de un fuente de producción a números en dp.
//
// ── POR QUÉ ESTO VIVE ACÁ Y NO EN UN GUARD ──────────────────────────────────────────────────────────
// Las bandas de arriba son el MODELO. Para que el modelo no describa una app imaginaria, alguien tiene
// que traducir lo que el código realmente escribe (`hitSlop={HIT_SLOP}`, `bottom={safeBottom + …}`) a
// números. Hasta el 2026-08-06 esa traducción estaba hecha DOS veces y de dos maneras distintas:
//   · el guard estático contaba CLAVES leyendo el objeto línea por línea, y
//   · el E2E llevaba un ESPEJO escrito a mano (`const FAB_HIT_SLOP = { top: 0, … }`).
// Las dos se burlan igual: el mutante escribe el objeto de otra forma y los dos oráculos siguen viendo
// lo que esperaban ver. Medido: con `const HIT_SLOP = { bottom: …, top: FAB_RAISE };` **en una sola
// línea** el guard daba 35/35 en verde con el bug 🔴 entero adentro (el extractor se quedaba con la
// primera clave de cada línea; el spread y las claves computadas eran igual de invisibles).
//
// Acá hay UNA sola traducción, compartida por el guard estático y por el E2E, y es **fail-closed**:
// cualquier gramática que no pueda resolver a un número TIRA. Un target que el guard no puede leer es un
// target que nadie puede verificar — que se ponga rojo es la respuesta correcta, no un inconveniente.
//
// ── LÍMITE DECLARADO ────────────────────────────────────────────────────────────────────────────────
// No es un evaluador de TS: resuelve identificadores siguiendo `const X = …` y `X.y` (objeto literal o
// `const X = fn()` con `function fn(){ return {…} }`) del MISMO archivo, aritmética `+ - * / ()`,
// `Math.max`/`Math.min` y `getTokenValue('$x','grupo')`. Todo lo demás —ternarios, llamadas, imports de
// otro módulo, claves computadas— es "no resoluble", o sea ROJO.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** Falla de resolución. Que llegue hasta el test es el comportamiento buscado: fail-closed. */
export class TargetResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetResolutionError';
  }
}

const MAX_RESOLUTION_DEPTH = 8;

/** Cuerpo `{…}` balanceado que arranca en la llave del índice `openIdx`. */
export function braceBody(src: string, openIdx: number): string {
  if (src[openIdx] !== '{') throw new TargetResolutionError(`no hay una llave en el índice ${openIdx}`);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(openIdx + 1, i);
  }
  throw new TargetResolutionError(`llave sin cerrar desde el índice ${openIdx}`);
}

/** Una aparición de `<prop>={…}` con su expresión balanceada (aunque cruce líneas). */
export interface JsxPropExpr {
  /** La expresión de adentro de las llaves, normalizada a una sola línea. */
  expr: string;
  /** Línea (1-based) donde arranca, para el mensaje de error. */
  line: number;
}

/** Las reservas inferiores REALES: web · iOS · Android gestos · Android 3 botones. */
export const REAL_BOTTOM_RESERVES = [12, 34, 40, 64];

/**
 * Resuelve la MISMA expresión con distintos valores de la reserva inferior.
 *
 * Es la herramienta con la que se contesta «¿en qué coordenada termina esto?» **sin mirar cómo está
 * escrito**: da igual que el anclaje llegue con `+`, con `Math.max`, con un token o con una const lavada;
 * lo que se compara son los números que salen para cada plataforma. Que dos valores difieran, además,
 * prueba que el elemento se mueve con la reserva (o sea, que está pegado al borde de la pantalla).
 */
export function resolveByReserve(
  expr: string,
  mkEnv: (reserve: number) => ResolveEnv,
  reserves: readonly number[] = REAL_BOTTOM_RESERVES,
): { values: number[]; dependsOnReserve: boolean } {
  const values = reserves.map((reserve) => evaluateDp(expr, mkEnv(reserve)));
  return { values, dependsOnReserve: values.some((v) => v !== values[0]) };
}

/** Todas las props JSX `<algo>={…}` de un fuente, con su expresión balanceada y el nombre de la prop. */
export function allJsxProps(src: string): Array<JsxPropExpr & { prop: string }> {
  const out: Array<JsxPropExpr & { prop: string }> = [];
  // `\x7b` = `{` (ver la nota de `objectBodyOf`: una llave literal adentro de un regex desbalancea el
  // conteo de `scan-coverage`).
  for (const prop of new Set([...src.matchAll(/\b([A-Za-z][\w]*)=\x7b/g)].map((m) => m[1]))) {
    for (const found of jsxPropExpressions(src, prop)) out.push({ ...found, prop });
  }
  return out;
}

/**
 * Todas las apariciones de `<prop>={…}` de un fuente. Escanear por LÍNEA no alcanza: el `bottom` del pill
 * ocupa 6 líneas y un override (`{{ ...HIT_SLOP, top: FAB_RAISE }}`) es una expresión, no una firma.
 */
export function jsxPropExpressions(src: string, prop: string): JsxPropExpr[] {
  const found: JsxPropExpr[] = [];
  const head = new RegExp(`\\b${prop}=\\{`, 'g');
  let m: RegExpExecArray | null;
  while ((m = head.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue; // fuente truncado/roto: lo reporta el chequeo de cobertura, no esto
    found.push({
      expr: src.slice(open + 1, end).replace(/\s+/g, ' ').trim(),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return found;
}

/** Parte por comas de PRIMER nivel (respeta `()[]{}` y strings). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Lee el lado derecho de un `const X = …;` desde `from` hasta el `;` de PRIMER nivel. */
function readRhs(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if ((c === ';' || c === '\n') && depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

/** Entorno de resolución: el fuente donde vive la expresión + cómo resolver tokens e identificadores. */
export interface ResolveEnv {
  /** Fuente del archivo, **ya sin comentarios**. */
  src: string;
  /** `getTokenValue('$x','<grupo>')` → dp. Devolver `undefined` = no resoluble → rojo. */
  token: (name: string, group: string) => number | undefined;
  /** Identificadores con valor fijado por el llamador (p. ej. la reserva inferior = 0). */
  scope?: Record<string, number>;
}

const IDENTIFIER_RUN = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;

/**
 * Evalúa una expresión de layout a dp. **Tira** ante cualquier cosa que no pueda resolver (esa es la
 * garantía: si el guard no puede leer el valor, se pone rojo en vez de suponer).
 */
export function evaluateDp(expr: string, env: ResolveEnv, seen: ReadonlySet<string> = new Set(), depth = 0): number {
  if (depth > MAX_RESOLUTION_DEPTH) {
    throw new TargetResolutionError(`demasiada indirección resolviendo \`${expr}\``);
  }
  let s = expr.replace(/\s+/g, ' ').trim();
  if (!s) throw new TargetResolutionError('expresión vacía');

  // 1) Tokens del design system.
  //
  // ⚠️ Las comillas van como `\x27`/`\x22` y NO como caracteres literales. `stripSourceComments…` no
  // distingue un literal de regex de una división (límite declarado en `strip-comments.ts`), así que una
  // comilla adentro de un regex le abre un string falso que se come el resto de la línea — incluida la
  // llave de apertura de esta arrow function. Los guards que cuentan el balance de llaves del árbol
  // (`scan-coverage`) lo detectan como fuente desbalanceado, y con razón: es la misma familia de bug que
  // dejaba 556 líneas invisibles. Sin comillas literales, el problema no existe.
  s = s.replace(/getTokenValue\(\s*[\x27\x22]\$([\w]+)[\x27\x22]\s*,\s*[\x27\x22](\w+)[\x27\x22]\s*\)/g, (_m, name: string, group: string) => {
    const value = env.token(name, group);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TargetResolutionError(`el token \`$${name}\` del grupo \`${group}\` no resuelve a un número`);
    }
    return `(${value})`;
  });

  // 2) Identificadores: `Math.max`/`Math.min` se preservan; el resto se resuelve o TIRA.
  s = s.replace(IDENTIFIER_RUN, (id) => {
    if (id === 'Math.max') return '__MATH_MAX__';
    if (id === 'Math.min') return '__MATH_MIN__';
    const fixed = env.scope?.[id];
    if (typeof fixed === 'number') return `(${fixed})`;
    return `(${lookupIdentifierDp(id, env, seen, depth + 1)})`;
  });

  // 3) Whitelist: sacando los placeholders, sólo puede quedar aritmética.
  const bare = s.replace(/__MATH_(?:MAX|MIN)__/g, '');
  if (!/^[-+*/().,\d\s]*$/.test(bare)) {
    throw new TargetResolutionError(
      `\`${expr}\` no es aritmética resoluble (quedó \`${bare.trim()}\`). Ternarios, llamadas y cualquier ` +
        'otra forma quedan afuera A PROPÓSITO: un target que no se puede leer no se puede verificar.',
    );
  }
  s = s.replace(/__MATH_MAX__/g, 'Math.max').replace(/__MATH_MIN__/g, 'Math.min');

  let value: unknown;
  try {
    // eslint-disable-next-line no-new-func -- la expresión ya pasó por la whitelist de arriba
    value = new Function(`"use strict"; return (${s});`)();
  } catch (err) {
    throw new TargetResolutionError(`no se pudo evaluar \`${expr}\` (quedó \`${s}\`): ${String(err)}`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TargetResolutionError(`\`${expr}\` no resolvió a un número finito (dio \`${String(value)}\`)`);
  }
  return value;
}

/** Cuerpo del objeto al que apunta `name`: `const name = {…}` o `const name = fn()` con `function fn`. */
function objectBodyOf(src: string, name: string): string {
  const decl = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*`).exec(src);
  if (!decl) throw new TargetResolutionError(`no encontré \`const ${name} = …\` en el archivo`);
  const from = decl.index + decl[0].length;
  if (src[from] === '{') return braceBody(src, from);
  const call = /^([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(src.slice(from));
  if (call) {
    const fn = new RegExp(`\\bfunction\\s+${call[1]}\\s*\\(`).exec(src);
    if (!fn) throw new TargetResolutionError(`\`${name}\` sale de \`${call[1]}()\` y no encontré esa función`);
    // `\x7b` = `{`. Escrito así por lo mismo que las comillas de arriba: una llave dentro de un literal
    // de regex desbalancea el conteo de los guards que auditan el fuente (`scan-coverage`).
    const ret = /\breturn\s*\x7b/.exec(src.slice(fn.index));
    if (!ret) throw new TargetResolutionError(`\`${call[1]}()\` no devuelve un objeto literal que se pueda leer`);
    return braceBody(src, fn.index + ret.index + ret[0].length - 1);
  }
  throw new TargetResolutionError(`\`${name}\` no es un objeto literal legible estáticamente`);
}

/** Nombre de la clave de una entrada de objeto: `top:`, `'top':`, shorthand. `null` si no es legible. */
function entryKey(entry: string): { key: string; value: string } | null {
  const withValue = /^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]+)$/.exec(entry);
  if (withValue) {
    return { key: withValue[1] ?? withValue[2] ?? withValue[3], value: withValue[4].trim() };
  }
  const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(entry);
  if (shorthand) return { key: shorthand[1], value: shorthand[1] };
  return null;
}

function lookupIdentifierDp(id: string, env: ResolveEnv, seen: ReadonlySet<string>, depth: number): number {
  if (seen.has(id)) throw new TargetResolutionError(`ciclo resolviendo \`${id}\``);
  const next = new Set(seen).add(id);
  const dot = id.indexOf('.');
  if (dot > 0) {
    const key = id.slice(dot + 1);
    const body = objectBodyOf(env.src, id.slice(0, dot));
    for (const entry of splitTopLevel(body)) {
      const parsed = entryKey(entry);
      if (parsed && parsed.key === key) return evaluateDp(parsed.value, env, next, depth + 1);
    }
    throw new TargetResolutionError(`\`${id}\`: el objeto no declara la clave \`${key}\``);
  }
  const decl = new RegExp(`\\bconst\\s+${id}\\s*(?::[^=]+)?=\\s*`).exec(env.src);
  if (!decl) {
    throw new TargetResolutionError(
      `no se pudo resolver \`${id}\`: no hay \`const ${id} = …\` en el archivo y nadie lo puso en el scope`,
    );
  }
  return evaluateDp(readRhs(env.src, decl.index + decl[0].length), env, next, depth + 1);
}

/**
 * Resuelve una expresión de INSETS (`hitSlop={…}`) al valor de CADA LADO en dp.
 *
 * Acepta el identificador pelado, el objeto inline y el spread de otro objeto local — porque el
 * invariante no es "no escribas un spread", es **cuánto crece el target y hacia dónde**. Lo que no puede
 * resolver, TIRA. Las claves posteriores pisan a las anteriores, como en JS.
 */
export function resolveInsetSides(expr: string, env: ResolveEnv, seen: ReadonlySet<string> = new Set()): Record<string, number> {
  const trimmed = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    if (seen.has(trimmed)) throw new TargetResolutionError(`ciclo resolviendo el objeto \`${trimmed}\``);
    return resolveInsetSides(`{${objectBodyOf(env.src, trimmed)}}`, env, new Set(seen).add(trimmed));
  }
  if (!trimmed.startsWith('{')) {
    throw new TargetResolutionError(
      `\`${trimmed}\` no es ni un objeto literal ni un identificador de uno: el valor del target no se ` +
        'puede leer de un solo lugar y por lo tanto nadie puede verificar contra qué choca.',
    );
  }
  const sides: Record<string, number> = {};
  for (const entry of splitTopLevel(braceBody(trimmed, 0))) {
    if (entry.startsWith('...')) {
      Object.assign(sides, resolveInsetSides(entry.slice(3).trim(), env, seen));
      continue;
    }
    const parsed = entryKey(entry);
    if (!parsed) {
      throw new TargetResolutionError(
        `la entrada \`${entry}\` del objeto de insets no tiene una clave legible (¿clave computada?): ` +
          'ese lado del target queda invisible para cualquier verificación estática.',
      );
    }
    sides[parsed.key] = evaluateDp(parsed.value, env, seen);
  }
  return sides;
}

// ─── Tokens REALES desde `tamagui.config.ts` (string adentro, número afuera) ──────────────────────────

/** Cuerpo del grupo `<group>: { … }` DENTRO de `createTokens(...)` (hay otro `size:` en las fuentes). */
function tokenGroupBody(configCode: string, group: string): string {
  const call = configCode.indexOf('createTokens(');
  if (call < 0) throw new TargetResolutionError('tamagui.config.ts tiene que declarar sus tokens con createTokens(...)');
  const all = braceBody(configCode, configCode.indexOf('{', call));
  const head = new RegExp(`(?:^|\\n)\\s*${group}:\\s*\\{`).exec(all);
  if (!head) throw new TargetResolutionError(`el grupo de tokens \`${group}\` no existe dentro de createTokens(...)`);
  return braceBody(all, head.index + head[0].length - 1);
}

/**
 * Valor NUMÉRICO de un token del grupo `size` de `tamagui.config.ts` (el nombre va SIN el `$`).
 *
 * No alcanza con leer un literal: varios tokens del nav son DERIVADOS a propósito (`fab: FAB_SIZE`,
 * `fabRaise: Math.round(FAB_SIZE * FAB_RAISE_RATIO)`) — que es justo lo que hace que valga la pena
 * verificarlos, porque cambiar `FAB_RAISE_RATIO` mueve la geometría entera sin tocar ninguna pantalla.
 */
export function sizeTokenFromConfig(configCode: string, name: string): number {
  const body = tokenGroupBody(configCode, 'size');
  const entry = new RegExp(`[\\s{,]${name}:\\s*([^,\\n]+)`).exec(body);
  if (!entry) throw new TargetResolutionError(`el token \`${name}\` no está en el grupo \`size\` de tamagui.config.ts`);
  // Las constantes de módulo del propio config entran al scope: los tokens del nav son DERIVADOS a
  // propósito y evaluarlos es el punto (cambiar `FAB_RAISE_RATIO` tiene que mover el número de acá).
  const consts: Record<string, number> = {};
  // El `\s*` después del salto NO es cosmético: sin él, una constante indentada (dentro de un bloque, o
  // simplemente con otro formato) desaparece del scope y el token derivado deja de resolver.
  for (const [, key, expr] of configCode.matchAll(/(?:^|\n)\s*const ([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/g)) {
    const rhs = expr.trim();
    // eslint-disable-next-line no-new-func -- sólo si es aritmética pura de literales
    if (/^[-+*/().\d\s]+$/.test(rhs)) consts[key] = Number(new Function(`return (${rhs});`)());
  }
  const value = evaluateConfigArithmetic(entry[1].trim(), consts);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TargetResolutionError(`\`${name}\` vale \`${entry[1].trim()}\`: tiene que resolver a un número > 0`);
  }
  return value;
}

/** Aritmética de un token del config: literales, constantes de módulo y `Math.round/max/min`. */
function evaluateConfigArithmetic(expr: string, consts: Record<string, number>): number {
  const substituted = expr.replace(IDENTIFIER_RUN, (id) => {
    if (id === 'Math.round' || id === 'Math.max' || id === 'Math.min') return id;
    if (typeof consts[id] === 'number') return `(${consts[id]})`;
    throw new TargetResolutionError(`no se pudo resolver \`${id}\` en el token \`${expr}\``);
  });
  if (!/^[-+*/().,\d\s]*$/.test(substituted.replace(/Math\.(?:round|max|min)/g, ''))) {
    throw new TargetResolutionError(`el token \`${expr}\` no es aritmética resoluble`);
  }
  // eslint-disable-next-line no-new-func -- ya pasó por la whitelist de arriba
  const value: unknown = new Function(`"use strict"; return (${substituted});`)();
  if (typeof value !== 'number') throw new TargetResolutionError(`el token \`${expr}\` no dio un número`);
  return value;
}

/** Los cuatro tokens de tamaño que definen la geometría del borde inferior, leídos del config real. */
export function navGeometryFromConfig(configCode: string): Pick<NavTargetTokens, 'navBar' | 'navItemTop' | 'fab' | 'fabRaise'> {
  return {
    navBar: sizeTokenFromConfig(configCode, 'navBar'),
    navItemTop: sizeTokenFromConfig(configCode, 'navItemTop'),
    fab: sizeTokenFromConfig(configCode, 'fab'),
    fabRaise: sizeTokenFromConfig(configCode, 'fabRaise'),
  };
}

/**
 * **El valor REAL del `hitSlop` del FAB**, resuelto del JSX de `app/(tabs)/_layout.tsx`.
 *
 * Se resuelve la expresión que usa el JSX —no la declaración del `const`— porque un override en el sitio
 * de uso (`hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}`) reabre el bug 🔴 sin tocar la declaración. Es la
 * única fuente de verdad del slop: la usan el guard estático y el E2E, así que ninguno de los dos puede
 * quedar mirando un espejo desactualizado.
 */
export function resolveFabHitSlop(
  layoutSrc: string,
  configCode: string,
  opts: { spaceToken?: (name: string) => number | undefined } = {},
): { sides: Record<string, number>; expr: string } {
  const src = stripSourceComments(layoutSrc);
  // tap-target-disable-next-line -- es el RESOLVEDOR del guard, no un target: acá es el NOMBRE de la prop que se busca
  const uses = jsxPropExpressions(src, 'hitSlop');
  if (uses.length !== 1) {
    throw new TargetResolutionError(
      // tap-target-disable-next-line -- mensaje de error del resolvedor, no un uso de la prop
      `el dueño del FAB tiene que declarar UN solo \`hitSlop\` y encontré ${uses.length}. La verificación ` +
        'de vecinos es por TARGET: dos slops en el mismo archivo esconden uno detrás del otro.',
    );
  }
  const env: ResolveEnv = {
    src,
    token: (name, group) =>
      group === 'size' ? sizeTokenFromConfig(configCode, name) : group === 'space' ? opts.spaceToken?.(name) : undefined,
  };
  return { sides: resolveInsetSides(uses[0].expr, env), expr: uses[0].expr };
}

/** El `hitSlop` resuelto, completado con 0 en los lados que NO declara. */
export function insetsWithDefaults(sides: Record<string, number>): { top: number; right: number; bottom: number; left: number } {
  return { top: sides.top ?? 0, right: sides.right ?? 0, bottom: sides.bottom ?? 0, left: sides.left ?? 0 };
}
