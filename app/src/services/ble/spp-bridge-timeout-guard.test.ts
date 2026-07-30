// GUARD: NINGÚN AWAIT DEL PUENTE NATIVO SIN PRESUPUESTO (🔴-1 del review de `dad711f`).
//
// ── EL BUG QUE CIERRA, Y POR QUÉ HACE FALTA UN GUARD Y NO "acordate" ──────────────────────────────
// `adapter-spp-android.ts` no tenía UN SOLO timeout. Un await que no resolvía dejaba el latch de
// conexión tomado para siempre y el bastón muerto hasta reiniciar la app. Medido en el A07 el
// 2026-07-30: **2 min 40 s sin un solo evento**, con el Bluetooth prendido y el bastón disponible,
// porque el operario prendió el BT desde el panel rápido en vez de contestarle al diálogo del
// sistema (`progress/bench_baston-spp-emulador.md` §4.2).
//
// Y ya nos había pasado ANTES, en este mismo archivo: el bug 2 de `dad711f` era un `pairDevice()`
// que no resolvía nunca. Aquel fix sacó **la llamada** pero no escribió el guard sobre **la
// ausencia del mecanismo** — así que la clase volvió por otras cinco puertas
// (`requestBluetoothEnabled`, `connectToDevice`, `ensurePermissions`, `getBondedDevices`, el
// `disconnect()` del teardown). Este guard es el que faltaba: no enumera las llamadas que están mal,
// enumera **todas** las que cruzan el puente y exige el mecanismo en cada una, así que una llamada
// NUEVA nace en rojo.
//
// ── EL MODELO ─────────────────────────────────────────────────────────────────────────────────────
//  · SEMILLA   — todo `await <expr>` de `adapter-spp-android.ts` cuya expresión arranque en el puente:
//                `native.` (la lib nativa), `device.` (el socket) o `env.` / `this.env.` (la I/O
//                inyectada: permisos, storage, foreground). Son exactamente las cuatro superficies
//                que no controlamos.
//  · CUBIERTO  — la expresión pasa por `withTimeout(` o `withTimeoutOr(`.
//  · VIOLACIÓN — cualquier otra.
//
// ── LO QUE ESTE GUARD NO PUEDE VER (límite declarado) ────────────────────────────────────────────
//  (a) Un await indirecto: `const p = native.connectToDevice(x); await p;`. La firma se evade
//      guardando la promesa en una variable. Es lectura del reviewer. (Hoy el único caso de promesa
//      guardada —`pending`— existe justamente PARA envolverla, y se le exige a mano más abajo.)
//  (a-bis) Un member-expression PARTIDO en dos líneas (`await native` + newline + `.foo()`): el escáner
//      trabajaba por línea y no lo matcheaba. Lo declaró el reviewer (⚪-H) y quedó **cerrado**: ahora se
//      colapsa el whitespace antes de escanear, así que un await partido se ve igual que uno de una línea.
//  (b) Que el PRESUPUESTO sea razonable (10 s / 30 s / 20 s). Eso lo fija `bridge-timeout.ts` y lo
//      chequea su propia suite; acá solo se exige que exista.
//  (c) Que el nativo respete el timeout. No lo respeta: la promesa queda huérfana. Por eso
//      `withTimeout` acepta un `onTimeout` para limpiar lo que haya quedado abierto.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER = resolve(HERE, 'adapter-spp-android.ts');

/** Prefijos de expresión que SON el puente (lo que no controlamos). */
const BRIDGE_EXPR = /^(native|device|env|this\.env)\s*\./;

function adapterSource(): string {
  return stripSourceComments(readFileSync(ADAPTER, 'utf8'));
}

/**
 * Cada `await` del fuente con su expresión y el número de línea donde arranca.
 *
 * El escaneo NO es por línea (era el límite ⚪-H que marcó el reviewer): un `await native` con el
 * `.isBluetoothEnabled()` en la línea siguiente se escapaba del matcher. Se toma una ventana de 200
 * caracteres desde el `await` con el whitespace colapsado, así que un member-expression partido se ve
 * igual que uno de una sola línea.
 */
function awaitedExpressions(src: string): Array<{ line: number; expr: string }> {
  const out: Array<{ line: number; expr: string }> = [];
  const re = /\bawait\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    const window = src.slice(m.index + m[0].length, m.index + m[0].length + 200).replace(/\s+/g, ' ');
    out.push({ line, expr: window.trim() });
  }
  return out;
}

test('🔴-1: TODO await que cruza el puente nativo está envuelto en withTimeout/withTimeoutOr', () => {
  const src = adapterSource();
  const violations = awaitedExpressions(src)
    .filter((a) => BRIDGE_EXPR.test(a.expr))
    .map((a) => `  adapter-spp-android.ts:${a.line} → await ${a.expr}`);

  assert.deepEqual(
    violations,
    [],
    `hay awaits del puente SIN presupuesto (un solo await que no resuelva mata el bastón hasta reiniciar la app):\n${violations.join('\n')}`,
  );
});

test('🔴-1: el adapter importa el mecanismo (no puede haber quedado "cubierto" por accidente)', () => {
  const src = adapterSource();
  assert.match(src, /from '\.\/bridge-timeout'/);
  // Cota inferior deliberadamente floja: lo que importa no es el número exacto, es que el mecanismo
  // esté en uso REAL y no una importación decorativa. Al 2026-07-30 hay 12 usos.
  const uses = src.match(/withTimeout(Or)?\s*\(/g)?.length ?? 0;
  assert.ok(uses >= 8, `se esperaban ≥8 usos de withTimeout*, hay ${uses}`);
});

test('🔴-1: la ÚNICA promesa del puente que se guarda en una variable (`pending`) se envuelve', () => {
  // Cierra el límite (a) para el caso que existe hoy: `connectToDevice` se guarda para poder
  // cerrarle el socket si resuelve DESPUÉS del vencimiento. Si alguien la awaiteara directo, el
  // guard de arriba no lo vería.
  const src = adapterSource();
  assert.match(src, /const pending = native\.connectToDevice\(/);
  assert.match(src, /withTimeout\(\s*pending,/);
  assert.equal(/\bawait\s+pending\b/.test(src), false, 'la promesa guardada NO se puede awaitear directo');
});

test('🔴-1: el latch de conexión se libera SIEMPRE (finally) y también en disconnect()', () => {
  const src = adapterSource();
  // El latch es `inFlightGen`: se toma en `runConnect` y se libera en su `finally`…
  assert.match(src, /finally\s*\{\s*if \(this\.inFlightGen === gen\) this\.inFlightGen = null;/);
  // …y `disconnect()` lo suelta además por su cuenta, invalidando la generación en curso para que
  // el intento viejo no pueda pisar al nuevo.
  const disconnectBody = /async disconnect\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(src)?.[1] ?? '';
  assert.match(disconnectBody, /this\.connectGeneration \+= 1;/);
  assert.match(disconnectBody, /this\.inFlightGen = null;/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EL MISMO INVARIANTE, FUERA DEL ADAPTER (2026-07-30, ⚪-L → 🟠 del leader)
//
// Hasta acá este guard miraba UNA CARPETA: `adapter-spp-android.ts`. Y el fix-loop metió dos awaits del
// puente **afuera** —`forgetRememberedDevice()` en el `signOut()` y en la baja de cuenta—, o sea justo en
// el punto ciego: un `.catch()` cubre el rechazo y NO el colgado, así que un SecureStore que no contesta
// dejaba al operario **sin poder cerrar sesión**. Es el 🔴-1 de esta unidad entrando por otra puerta.
//
// La lección no es "agregar dos archivos a la lista": es que el guard tiene que vigilar un **invariante**
// y no un directorio. El invariante es:
//
//   *Ninguna promesa que cruza el puente nativo puede quedar sin techo, y el techo va en el BORDE que
//    hace la llamada nativa — no en cada call site, que es lo que se olvida.*
//
// Se chequea en dos mitades que se cierran entre sí:
//   · MITAD 1 — los bordes declarados en `BOUNDED_AT_THE_BOUNDARY` acotan de verdad: en esos archivos,
//     TODO `await` de una primitiva nativa va envuelto. La tabla no puede mentir porque el guard la
//     verifica.
//   · MITAD 2 — en el territorio de esta unidad (`services/ble/**` + `features/ble-stick/**`), NINGÚN
//     archivo awaitea una primitiva nativa sin techo, salvo los que estén nombrados con su motivo en
//     `PRE_EXISTING_UNBOUNDED`. Un archivo NUEVO que lo haga nace en rojo; meterlo en la lista de
//     excepciones es una decisión visible en el diff, no un olvido.
//
// LO QUE NO PUEDE VER (declarado): una primitiva nativa que no esté en `NATIVE_PRIMITIVES`. Si mañana
// entra otra dependencia nativa con su propio wrapper de storage, agregarla a esa lista es parte del
// costo de sumarla. Y no valida los presupuestos (eso lo hace `bridge-timeout.test.ts`).

/** Lo que cruza el puente nativo y por lo tanto puede no contestar. */
const NATIVE_PRIMITIVES = /\b(SecureStore|PermissionsAndroid|AsyncStorage|NativeModules)\s*\./;

/**
 * Bordes que acotan ADENTRO, con la primitiva que envuelven. Los call sites de estas funciones pueden
 * confiar en su techo (y por eso el `signOut()` no necesita envolver el `forgetRememberedDevice()`).
 */
const BOUNDED_AT_THE_BOUNDARY: Array<{ file: string; why: string }> = [
  {
    file: 'remembered-device.ts',
    why: 'lo llaman el signOut(), la baja de cuenta y el arranque de la app (R6.4): colgarse ahí es inaceptable',
  },
];

/**
 * Excepciones PRE-EXISTENTES, nombradas una por una con su motivo. No son "lo mismo pero perdonado":
 * son awaits que ya estaban antes de esta unidad y que NO están en un camino crítico. Anotadas en
 * `docs/backlog.md` para cerrarlas de una pasada, con el resto de los acumuladores sin cota.
 */
const PRE_EXISTING_UNBOUNDED: Array<{ file: string; why: string }> = [
  {
    file: 'feedback-pref.ts',
    why: 'escritura best-effort de una preferencia (beep on/off); nadie la espera para seguir, y su caller ya ignora el resultado',
  },
  {
    file: 'permissions-android.ts',
    why: 'los dos awaits son los diálogos del SO, que POR DEFINICIÓN esperan a una persona; el techo lo pone el caller con su presupuesto `prompt` (el adapter lo hace, y el guard del adapter lo verifica)',
  },
];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('🟠 MITAD 1: los bordes declarados acotan DE VERDAD (la tabla no puede mentir)', () => {
  for (const { file, why } of BOUNDED_AT_THE_BOUNDARY) {
    const src = stripSourceComments(readFileSync(resolve(HERE, file), 'utf8'));
    const unbounded = awaitedExpressions(src)
      .filter((a) => NATIVE_PRIMITIVES.test(a.expr))
      .filter((a) => !/^withTimeout(Or)?\s*\(/.test(a.expr))
      .map((a) => `  ${file}:${a.line} → await ${a.expr.slice(0, 80)}`);
    assert.deepEqual(
      unbounded,
      [],
      `${file} está declarado como borde acotado (${why}) pero tiene awaits nativos sin techo:\n${unbounded.join('\n')}`,
    );
    assert.match(src, /from '\.\/bridge-timeout'/, `${file} tiene que importar el mecanismo`);
  }
});

test('🟠 MITAD 2: en el territorio de esta unidad nadie awaitea una primitiva nativa sin techo', () => {
  const roots = [resolve(HERE, '..', '..', 'services', 'ble'), resolve(HERE, '..', '..', 'features', 'ble-stick')];
  const exempt = new Set([
    ...BOUNDED_AT_THE_BOUNDARY.map((e) => e.file),
    ...PRE_EXISTING_UNBOUNDED.map((e) => e.file),
  ]);
  const violations: string[] = [];
  for (const root of roots) {
    for (const full of tsFilesUnder(root)) {
      const name = full.split(/[\\/]/).pop() ?? '';
      if (exempt.has(name)) continue;
      const src = stripSourceComments(readFileSync(full, 'utf8'));
      for (const a of awaitedExpressions(src)) {
        if (!NATIVE_PRIMITIVES.test(a.expr)) continue;
        if (/^withTimeout(Or)?\s*\(/.test(a.expr)) continue;
        violations.push(`  ${name}:${a.line} → await ${a.expr.slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `hay awaits de primitivas nativas sin techo (un storage que no contesta cuelga a quien lo espere; si el caller es un logout, deja al operario sin poder salir):\n${violations.join('\n')}`,
  );
});

test('🟠 MITAD 2 (contraparte): las excepciones declaradas EXISTEN y siguen siendo excepciones', () => {
  // Una lista de excepciones que acumula archivos borrados es una lista que nadie mira. Y si una
  // excepción se arregló, tiene que salir de la lista (o el guard deja de cubrirla en silencio).
  for (const { file } of [...BOUNDED_AT_THE_BOUNDARY, ...PRE_EXISTING_UNBOUNDED]) {
    const path = resolve(HERE, file);
    assert.ok(existsSync(path), `la excepción declarada '${file}' ya no existe: sacala de la lista`);
  }
  for (const { file } of PRE_EXISTING_UNBOUNDED) {
    const src = stripSourceComments(readFileSync(resolve(HERE, file), 'utf8'));
    const stillUnbounded = awaitedExpressions(src)
      .filter((a) => NATIVE_PRIMITIVES.test(a.expr))
      .filter((a) => !/^withTimeout(Or)?\s*\(/.test(a.expr));
    assert.ok(
      stillUnbounded.length > 0,
      `'${file}' ya no tiene awaits nativos sin techo: sacalo de PRE_EXISTING_UNBOUNDED para que el guard lo cubra`,
    );
  }
});

test('🟠 los call sites CRÍTICOS del bastón recordado están donde tienen que estar', () => {
  // El complemento del techo: que la limpieza se llame en los tres momentos en que el dato deja de ser
  // válido — y el tercero (el fin de sesión INVOLUNTARIO) es el que faltaba. `delete_account` revoca
  // global, así que en el segundo teléfono de la cuenta la sesión muere por `onAuthStateChange` y el
  // `forget` de `services/account.ts` NO corre nunca.
  // Whitespace colapsado: `stripSourceComments` BLANQUEA los comentarios preservando posiciones, así que
  // un comentario largo (como el que explica estos dos call sites) mete cientos de espacios en el medio y
  // una ventana de N caracteres no alcanza. Colapsar mide distancia en CÓDIGO, que es lo que importa.
  const auth = stripSourceComments(
    readFileSync(resolve(HERE, '..', '..', 'contexts', 'AuthContext.tsx'), 'utf8'),
  ).replace(/\s+/g, ' ');
  assert.match(
    auth,
    /event === 'SIGNED_OUT'[\s\S]{0,60}forgetRememberedDevice\(/,
    'falta limpiar el bastón recordado en el fin de sesión INVOLUNTARIO (token revocado/expirado, delete_account desde otro dispositivo)',
  );
  assert.match(
    auth,
    /signOut = useCallback[\s\S]{0,200}forgetRememberedDevice\(/,
    'falta limpiar el bastón recordado en el signOut explícito',
  );
});
