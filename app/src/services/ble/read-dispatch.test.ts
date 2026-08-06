// Tests + GUARD del invariante «no se emite feedback sensorial —ni se consume la ventana de dedup— por
// una lectura que no va a recibir NADIE» (🔴-2 del barrido de edge cases del Bluetooth, 2026-08-06).
//
// Tres capas, porque ninguna sola alcanza:
//   (1) la DECISIÓN pura (`resolveReadHandling`) — node:test, exhaustiva sobre el espacio de entradas.
//   (2) un GUARD ESTÁTICO sobre el provider: es `.tsx` (React) y no lo cubre ninguna suite node:test, y
//       el E2E corre en web sin vibración → si alguien vuelve a poner el `playFeedback` ANTES del gate,
//       o vuelve a correr el motor de dedup antes, NADA se pone rojo. El único oráculo barato es la
//       forma del código.
//   (3) un GUARD SOBRE LA AUSENCIA: la tabla de TODOS los consumidores del bastón. El bug no fue una
//       línea mal escrita, fue una pantalla que NO tenía el mecanismo (`maniobra/carga` no tiene
//       listener propio y el overlay global se suprime en todo `maniobra/*`). Un test de `carga.tsx` no
//       serviría: mañana hay otra pantalla sin consumidor y nace rota. Lo que se fija acá es que
//       cualquier call site NUEVO del listener quede en ROJO hasta que alguien decida —y escriba— si
//       se auto-censura (y entonces debe declarar `accepts`) o si consume siempre.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acceptingTargets, resolveAccepts, resolveReadHandling } from './read-dispatch.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..', '..', '..'); // app/
const PROVIDER = join(APP_ROOT, 'src', 'services', 'ble', 'BleStickListenerProvider.tsx');

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) LA DECISIÓN PURA
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('escuchando + al menos un consumidor que acepta → se procesa (camino feliz de la manga)', () => {
  assert.equal(resolveReadHandling({ listening: true, acceptingConsumers: 1 }), 'process');
  assert.equal(resolveReadHandling({ listening: true, acceptingConsumers: 3 }), 'process');
});

test('🔴-2: escuchando y NADIE va a actuar → drop_no_consumer (silencio honesto, no vibración)', () => {
  // Este es EXACTAMENTE `maniobra/carga`: el overlay global está suscripto pero suprimido por ruta
  // (`BLE_OWNED_ROUTES` incluye el árbol `maniobra` entero) y la pantalla no tiene listener propio.
  assert.equal(resolveReadHandling({ listening: true, acceptingConsumers: 0 }), 'drop_no_consumer');
});

test('listener suspendido → drop_listener_suspended, aunque haya consumidores suscriptos', () => {
  // MODO MANIOBRAS con el listener apagado / form CREATE-EDIT con busyMode. Es el estado NORMAL de esas
  // pantallas: se descarta en silencio y SIN loguear (ver el provider), a diferencia del no-consumer.
  assert.equal(resolveReadHandling({ listening: false, acceptingConsumers: 0 }), 'drop_listener_suspended');
  assert.equal(resolveReadHandling({ listening: false, acceptingConsumers: 5 }), 'drop_listener_suspended');
});

test('INVARIANTE: `process` ⟺ (escuchando ∧ ≥1 consumidor que acepta) — sobre TODO el espacio', () => {
  // La propiedad, no los casos: cualquier reescritura que habilite el feedback en otra combinación cae.
  for (const listening of [true, false]) {
    for (const acceptingConsumers of [0, 1, 2, 7, 128]) {
      const handling = resolveReadHandling({ listening, acceptingConsumers });
      assert.equal(
        handling === 'process',
        listening && acceptingConsumers > 0,
        `resolveReadHandling({listening:${listening}, acceptingConsumers:${acceptingConsumers}}) = ${handling}`,
      );
    }
  }
});

test('una cuenta ROTA (NaN / negativa) cae del lado del descarte, no del feedback', () => {
  // `!== 0` habría dejado pasar el NaN y un -1 (los dos "distintos de cero") → vibración sobre una
  // lectura perdida, que es justo el modo de falla que este módulo existe para cerrar.
  assert.equal(resolveReadHandling({ listening: true, acceptingConsumers: Number.NaN }), 'drop_no_consumer');
  assert.equal(resolveReadHandling({ listening: true, acceptingConsumers: -1 }), 'drop_no_consumer');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (1-bis) EL FILTRADO DE CONSUMIDORES, POR COMPORTAMIENTO
// Es la pieza que distingue "cuántos están suscriptos" de "cuántos van a actuar" — o sea, el corazón del
// 🔴-2. Vive en el módulo puro justamente para verificarla ejecutándola, y no con un regex sobre el
// provider (que es `.tsx` y no lo cubre ninguna suite node:test).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('acceptingTargets: entrega SOLO a los que aceptan (el overlay global suscripto y censurado no cuenta)', () => {
  const overlaySuprimido = { cb: 'overlay', accepts: () => false };
  const pantallaDuena = { cb: 'identificar', accepts: () => true };
  assert.deepEqual(acceptingTargets([overlaySuprimido, pantallaDuena], () => undefined), ['identificar']);
  // `maniobra/carga`: el overlay está suscripto pero censurado por ruta, y no hay pantalla dueña.
  assert.deepEqual(acceptingTargets([overlaySuprimido], () => undefined), []);
  assert.deepEqual(acceptingTargets([], () => undefined), []);
});

test('acceptingTargets: el predicado se evalúa EN CADA lectura (no se congela al suscribirse)', () => {
  // El caso real: el overlay pasa de aceptar a censurar cuando el peón entra a una ruta dueña, sin
  // re-suscribirse. Si el valor se capturara una sola vez, el gate quedaría clavado en el estado inicial.
  let acepta = true;
  const sub = { cb: 'overlay', accepts: () => acepta };
  assert.deepEqual(acceptingTargets([sub], () => undefined), ['overlay']);
  acepta = false;
  assert.deepEqual(acceptingTargets([sub], () => undefined), []);
});

test('resolveAccepts: el `false` de un consumidor MANDA (el `|| true` que burló al guard viejo, muerto)', () => {
  // 🔴-A del review. Este es EL test que faltaba: el cableado del hook se verificaba con un regex
  // ("¿aparece el token `acceptsRef` después de `subscribeTagRead(`?") y el reviewer lo burló cambiando
  // dos caracteres en `stick.ts` — `?? true` por `|| true` — con `tsc` en RC=0 y 49/49 en verde, y el
  // 🔴-2 restaurado ENTERO (todo consumidor aceptaba siempre). Acá se ejecuta la composición:
  //   · sin predicado declarado → acepta (el default de `/baston`, que solo lista lecturas);
  //   · con predicado que dice NO → NO acepta. Con `||` esto daría `true` y el test cae.
  assert.equal(resolveAccepts({ current: undefined })(), true, 'sin `accepts` declarado, el consumidor acepta');
  assert.equal(
    resolveAccepts({ current: () => false })(),
    false,
    'un consumidor que declara que NO va a actuar tiene que contar como NO consumidor: si esto da true, ' +
      'el overlay global (siempre suscripto) vuelve a hacer que SIEMPRE haya "consumidor" y el 🔴-2 vuelve entero',
  );
  assert.equal(resolveAccepts({ current: () => true })(), true);
});

test('resolveAccepts: lee la ref EN CADA lectura (M5b: olvidarse de invocar el predicado)', () => {
  // El consumidor pasa una arrow nueva en cada render; el predicado compuesto tiene que leer la ref
  // vigente, no la que había al suscribirse. Y tiene que INVOCARLA: devolver la función en vez de su
  // resultado daría siempre truthy.
  const ref: { current: (() => boolean) | undefined } = { current: () => true };
  const accepts = resolveAccepts(ref);
  assert.equal(accepts(), true);
  ref.current = () => false;
  assert.equal(accepts(), false, 'el predicado quedó congelado del render viejo');
  ref.current = undefined;
  assert.equal(accepts(), true);
  assert.equal(typeof accepts(), 'boolean', 'devolvió la función en vez de invocarla (todo sería truthy)');
});

test('acceptingTargets: un predicado que TIRA falla ABIERTO y avisa (un bastón mudo es peor)', () => {
  // Fail-CLOSED acá significaría que el peón bastonea y no pasa NADA, sin causa visible, en la manga.
  // Una confirmación de más es recuperable; un bastón mudo por un bug de predicado, no.
  const errores: unknown[] = [];
  const roto = {
    cb: 'roto',
    accepts: () => {
      throw new Error('boom');
    },
  };
  assert.deepEqual(acceptingTargets([roto], (e) => errores.push(e)), ['roto']);
  assert.equal(errores.length, 1, 'el predicado roto tiene que dejar rastro');
  // Y no se traga a los demás: el que sigue se evalúa igual.
  assert.deepEqual(
    acceptingTargets([roto, { cb: 'ok', accepts: () => true }], () => undefined),
    ['roto', 'ok'],
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (2) GUARD ESTÁTICO SOBRE EL PROVIDER: el ORDEN es el fix
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cuerpo `{…}` que arranca en la llave de `openIdx`, por balanceo (mismo helper que el safe-bottom guard). */
function braceBody(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(openIdx + 1, i);
  }
  throw new Error(`llave sin cerrar desde el índice ${openIdx}`);
}

/** El cuerpo de `handleReading` del provider, con los comentarios blanqueados. */
function handleReadingBody(): string {
  const code = stripSourceComments(readFileSync(PROVIDER, 'utf8'));
  const head = /const handleReading = useCallback\(\([^)]*\) => \{/.exec(code);
  assert.ok(head, 'no se encontró `handleReading` en el provider (¿se renombró? actualizá este guard)');
  return braceBody(code, head.index + head[0].length - 1);
}

test('GUARD: el provider decide si hay consumidor ANTES de vibrar y ANTES del motor de dedup', () => {
  const body = handleReadingBody();

  const gate = body.indexOf('resolveReadHandling(');
  assert.ok(
    gate >= 0,
    '`handleReading` ya no llama a `resolveReadHandling`: volvió a decidir a mano si procesa la lectura, ' +
      'y con eso vuelve el 🔴-2 (vibrar por un bastonazo que no recibe nadie).',
  );

  // ⚠️ Los dos chequeos de abajo buscan TODAS las ocurrencias con un patrón por FORMA, no la primera
  // aparición de un texto exacto. La versión anterior comparaba contra `body.indexOf('engine.processEid(')`
  // y la burlé con una línea: `engineRef.current.processEid(...)` antes del gate quema la ventana de dedup
  // igual y no matchea ese literal. Un guard atado al alias de una variable no es un guard.
  const occurrences = (re: RegExp): number[] => [...body.matchAll(re)].map((m) => m.index ?? -1);

  // (a) El FEEDBACK sensorial va después del gate — y se busca por el NOMBRE PELADO del canal, no por
  //     `playFeedback(`. M2 del review sobrevivió justo por eso: `const fb = playFeedback; fb(true);`
  //     antes del gate no matchea una llamada, dispara el feedback igual, y dejaba la suite en verde.
  //     Nombrar un canal sensorial antes de haber decidido que hay consumidor ya es la violación.
  const feedbacks = occurrences(new RegExp(SENSORY_EMIT.source, 'g'));
  assert.ok(feedbacks.length > 0, 'el provider ya no dispara el feedback de la lectura (¿se movió? actualizá este guard)');
  for (const idx of feedbacks) {
    assert.ok(
      gate < idx,
      'se nombra un canal de feedback sensorial ANTES de decidir si hay consumidor (' +
        JSON.stringify(body.slice(Math.max(0, idx - 50), idx + 40).trim()) +
        '): eso ES el bug 🔴-2 — la vibración es la señal que el peón lee como "entró", y estaría ' +
        'confirmando un dato perdido. Incluye aliasearlo: `const fb = playFeedback` arriba del gate es ' +
        'el mismo bug con otro nombre.',
    );
  }

  // (b) El MOTOR DE INGESTA (que es quien consume la ventana de dedup) también, sin importar por qué
  //     referencia se lo llame. Si corriera antes, `dedup.shouldEmit` registraría el EID y lo dejaría
  //     quemado 3 s por una lectura que nadie recibió — y el re-bastoneo tampoco entraría.
  const ingests = occurrences(/\.\s*(?:processRawLine|processEid|shouldEmit)\s*\(/g);
  assert.ok(
    ingests.length >= 2,
    `el provider debería llamar al motor de ingesta por sus dos caminos (raw + eid); se vieron ${ingests.length}`,
  );
  for (const idx of ingests) {
    assert.ok(
      gate < idx,
      'el motor de ingesta corre ANTES del gate de consumidor (' +
        JSON.stringify(body.slice(Math.max(0, idx - 60), idx + 30).trim()) +
        '): la ventana de dedup se consumiría por una lectura que no recibe nadie, y `TagDedup.shouldEmit` ' +
        'documenta que se mide desde la última emisión CONFIRMADA.',
    );
  }

  // Y entre la decisión y el feedback tiene que haber una SALIDA: sin el `return`, calcular el handling
  // sería decorativo.
  const betweenGateAndFeedback = body.slice(gate, Math.min(...feedbacks));
  assert.match(
    betweenGateAndFeedback,
    /\breturn\b/,
    'entre la decisión y el feedback no hay ningún `return`: el gate no corta nada.',
  );
  // El descarte por falta de consumidor deja rastro (el síntoma correcto —silencio— es indistinguible
  // de "el bastón no leyó" desde afuera).
  assert.match(
    betweenGateAndFeedback,
    /read_dropped_no_consumer/,
    'el descarte por falta de consumidor no se loguea: un agujero de producto quedaría invisible.',
  );
});

/**
 * CUALQUIER emisión de feedback SENSORIAL, por la API que sea. No es la lista de las que hoy se usan: es
 * la lista de las formas de hacerle sentir algo al operario. `haptic` está incluido a propósito aunque el
 * repo no lo use hoy en este camino — `src/utils/haptics.ts` existe (lo usan el reorder y la rueda) y su
 * cabecera declara que ES el lugar donde se va a enchufar el canal háptico rico cuando exista.
 *
 * ── AMPLIADO EL 2026-08-06 (unidad «el bastón tiene que sonar y vibrar de verdad») ────────────────────
 * Al enchufar `expo-haptics` + `expo-audio`, la versión anterior de este patrón se volvía burlable en un
 * renglón: nombraba `playFeedback` LITERAL, así que una función nueva llamada `playRejectFeedback()` —o
 * un `Haptics.notificationAsync(...)`, o un `createAudioPlayer(...)`— antes del gate NO matcheaba nada y
 * dejaba la suite en verde con el 🔴-2 restaurado para el camino nuevo. Ahora:
 *   · `play[A-Z]\w*` en vez de `playFeedback` → cubre CUALQUIER `playAlgo()` (playSound, playBeep,
 *     playRejectFeedback, playTone…), que es la forma en que se escribe un emisor nuevo;
 *   · las APIs concretas de los dos módulos nuevos (`notificationAsync`, `impactAsync`, `selectionAsync`,
 *     `createAudioPlayer`, `AudioPlayer`, `setAudioModeAsync`).
 * Lo que este patrón NO puede ver, dicho explícitamente: un emisor con un nombre que no empiece con
 * `play` y que use un módulo que no esté enumerado. Esa mitad la cierra `feedback-guard.test.ts`, que
 * vigila los MÓDULOS importados (no se puede hacer sonar un teléfono sin importar algo).
 */
const SENSORY_EMIT =
  /\b(?:Vibration|vibrate|\w*[Hh]aptics?\w*|notificationAsync|impactAsync|selectionAsync|createOscillator|AudioContext|createAudioPlayer|AudioPlayer|setAudioModeAsync|play[A-Z]\w*|primeFeedback|emitCueSound)\b/;

/**
 * Los ÚNICOS nombres sensoriales que el provider puede pronunciar, con su razón:
 *   · `playFeedback`  → EL punto único de emisión. Se invoca exactamente una vez, y después del gate.
 *   · `primeFeedback` → warm-up de los canales (carga el asset del sonido) al MONTAR. No emite nada, y
 *                       el test de abajo verifica que no aparezca dentro de `handleReading`.
 * Cualquier otro token sensorial en este archivo es un canal al costado del punto único.
 */
const PROVIDER_SENSORY_ALLOWED = new Set(['playFeedback', 'primeFeedback']);

/** Todos los tokens sensoriales de una línea (no "¿matchea?": CUÁLES, para poder allowlistear por nombre). */
function sensoryTokens(line: string): string[] {
  return [...line.matchAll(new RegExp(SENSORY_EMIT.source, 'g'))].map((m) => m[0]);
}

test('GUARD: el feedback SENSORIAL de una lectura se emite en UN SOLO punto (escrito sobre el invariante)', () => {
  // ── 🟠-E del review: el guard era más angosto que el invariante que declaraba ─────────────────────
  // Decía "no se emite feedback sensorial sin consumidor" pero cercaba "no se llama `playFeedback`". El
  // reviewer lo pasó por arriba dos veces sin tocar el gate: con un ALIAS (`const fb = playFeedback`) y
  // con OTRA API (`hapticTick()`), las dos antes del gate, con la suite entera en verde. La segunda
  // encima esquiva el E2E, que mide `AudioContext`.
  // Ahora la regla se escribe sobre la AUSENCIA y por FORMA de efecto, no por nombre de función: en todo
  // `services/ble/**` —que es el camino de la lectura— nadie puede emitir feedback sensorial salvo
  // `feedback.ts`, que ES el punto único, y el provider, que lo invoca DESPUÉS del gate (orden verificado
  // en el test de arriba). Un canal nuevo (expo-haptics, un sonido nativo) nace en rojo hasta que se lo
  // enchufe DENTRO de `feedback.ts`, que es exactamente donde su propia cabecera dice que va.
  // NO prohíbe la háptica en la app: `src/utils/haptics.ts` y sus consumidores de UI quedan fuera del
  // barrido, porque ninguna lectura del bastón pasa por ahí.
  // El "punto único" son DOS archivos por diseño: la DECISIÓN pura de qué canales corresponden
  // (`feedback-logic.ts`, sin RN, testeable) y el EFECTO físico (`feedback.ts`). Los dos están aguas
  // abajo del gate; separarlos es lo que hace testeable la decisión. Se verifica abajo que la decisión
  // siga siendo pura, para que exentarla no se convierta en una puerta trasera para emitir.
  const PUNTO_UNICO = ['src/services/ble/feedback.ts', 'src/services/ble/feedback-logic.ts'];
  const violations = scanTree(
    (line, rel) => rel.startsWith('src/services/ble/') && !PUNTO_UNICO.includes(rel) && SENSORY_EMIT.test(line),
  );
  const fueraDelProvider = violations.filter((v) => !v.startsWith('src/services/ble/BleStickListenerProvider.tsx:'));
  assert.deepEqual(
    fueraDelProvider,
    [],
    'Alguien emite feedback sensorial en el camino de la lectura fuera del punto único. El invariante no ' +
      'es "no llamar a playFeedback": es que NINGUNA confirmación sensorial salga sin haber decidido antes ' +
      `que hay un consumidor. Enchufá el canal nuevo dentro de \`${PUNTO_UNICO}\`, que es el único lugar ` +
      'aguas abajo del gate.',
  );
  // Y en el provider, lo ÚNICO sensorial que puede nombrarse está en la allowlist: ni un canal al
  // costado, ni un alias. Se mira TOKEN POR TOKEN y no "¿la línea menciona playFeedback?": el chequeo
  // viejo se pasaba escribiendo `playFeedback; Vibration.vibrate(50);` en el MISMO renglón.
  const providerSrc = stripSourceComments(readFileSync(PROVIDER, 'utf8'));
  const otrosCanales = providerSrc
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => sensoryTokens(line).some((t) => !PROVIDER_SENSORY_ALLOWED.has(t)))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
  assert.deepEqual(
    otrosCanales,
    [],
    'el provider nombra un canal sensorial que NO es el punto único. Aunque estuviera después del gate, ' +
      'un segundo canal parte el invariante en dos lugares y el próximo se agrega sin que nadie lo vea.',
  );
  // La invocación es UNA sola (dos llamadas = dos caminos, y solo uno queda cubierto por el orden).
  const invocaciones = (providerSrc.match(/\bplayFeedback\s*\(/g) ?? []).length;
  assert.equal(invocaciones, 1, `el provider invoca \`playFeedback\` ${invocaciones} veces; debería ser exactamente 1`);

  // El warm-up es warm-up: si `primeFeedback` apareciera DENTRO de `handleReading`, la carga del asset
  // volvería al camino caliente (🟡-11 con otra cara) y encima habría dos nombres sensoriales ahí adentro,
  // donde el test de orden solo razona sobre uno.
  assert.doesNotMatch(
    handleReadingBody(),
    /\bprimeFeedback\b/,
    '`primeFeedback` (warm-up) se coló en el camino de la lectura: tiene que correr al MONTAR el provider.',
  );

  // El punto único, además, sigue siendo alcanzable SOLO desde el provider (nadie más lo invoca).
  // (el guard de R4.9 —camino caliente síncrono y sin I/O— vive en su propio test, más abajo)
  const callers = scanTree((line, rel) => !PUNTO_UNICO.includes(rel) && /\bplayFeedback\s*\(/.test(line));
  assert.deepEqual(
    callers.map((c) => c.split(':')[0]),
    ['src/services/ble/BleStickListenerProvider.tsx'],
    `\`playFeedback\` se invoca desde fuera del provider: ${callers.join(', ')}`,
  );

  // Y la mitad exenta que NO es el efecto sigue siendo pura: si `feedback-logic.ts` empezara a importar
  // RN, la exención de arriba se volvería un agujero (podría emitir de verdad y nadie lo vería).
  const logic = stripSourceComments(readFileSync(join(APP_ROOT, 'src', 'services', 'ble', 'feedback-logic.ts'), 'utf8'));
  assert.doesNotMatch(
    logic,
    /from '(?:react-native|expo-[\w-]+)'|require\('react-native'\)/,
    '`feedback-logic.ts` está exento del barrido porque es la DECISIÓN pura (solo nombra los canales). Si ' +
      'importa RN/expo pasa a poder EMITIR, y la exención se vuelve la puerta trasera exacta que este guard cierra.',
  );
});

test('el guard del feedback DETECTA los canales que lo burlaron (M2 y M3 del review)', () => {
  // Sin esto, la regla de arriba podría quedar mirando un patrón que ya no matchea nada y pasar verde.
  assert.ok(SENSORY_EMIT.test('    const fb = playFeedback; fb(true);'), 'M2: alias de playFeedback');
  assert.ok(SENSORY_EMIT.test('    hapticTick();'), 'M3: otro canal de vibración del repo');
  assert.ok(SENSORY_EMIT.test('    Vibration.vibrate(50);'));
  assert.ok(SENSORY_EMIT.test('    void Haptics.impactAsync();'));
  assert.ok(SENSORY_EMIT.test('    const ctx = new AudioContext();'));
  assert.ok(SENSORY_EMIT.test('    osc = ctx.createOscillator();'));
  // El patrón matchea el NOMBRE pelado a propósito: importar o aliasear el canal desde otro archivo de
  // `services/ble/` ya es la mitad de M2, y el exento es el provider (que lo importa para invocarlo
  // DESPUÉS del gate), no "cualquiera que solo lo importe".
  assert.ok(SENSORY_EMIT.test('import { playFeedback } from "./feedback";'));
  // Y no se dispara con lo que NO es un canal sensorial…
  assert.ok(!SENSORY_EMIT.test('  const feedbackEnabled = true;'));
  assert.ok(!SENSORY_EMIT.test('  void readBeepEnabled().then(setBeep);'));
  // …ni con una mención documental (se blanquea antes de escanear).
  assert.ok(!SENSORY_EMIT.test(stripSourceComments('// acá se dispara Vibration.vibrate(50)')));
});

/** Nombres de I/O de preferencia/storage que NO pueden aparecer en el camino caliente (R4.9). */
const HOT_PATH_IO =
  /\b(?:readBeepEnabled|writeBeepEnabled|SecureStore|getItemAsync|setItemAsync|localStorage|AsyncStorage)\b/;

test('GUARD (R4.9): el camino de la lectura es SÍNCRONO y sin I/O — cero storage por bastonazo', () => {
  // ── EL BUG QUE CIERRA (🟡-11; y 🟠-3 del review: era el único requisito nuevo sin red) ──────────────
  // El as-built anterior llamaba `readBeepEnabled()` EN CADA LECTURA: un cruce del puente nativo a
  // `expo-secure-store` (el KeyStore de Android) POR BASTONAZO, para alimentar un booleano que no cambia
  // salvo que alguien toque un switch. Y encima colgaba la emisión del feedback de una promesa, así que
  // en una ráfaga el orden de los microtasks no quedaba atado al orden de las lecturas.
  // El reviewer lo revirtió y la suite entera quedó VERDE (la E2E tampoco lo ve: sigue sonando, solo que
  // async). O sea: sin este guard, el 🟡-11 vuelve solo y nadie se entera.
  //
  // ── LO QUE ESTA REGLA NO VE, Y POR ESO NO ES LA PRINCIPAL (🟠-A de la re-review) ───────────────────
  // La primera versión decía que "sin `await`/`.then(` un helper nuevo con otro nombre tampoco pasa".
  // **Era falso**, y el reviewer lo demostró con una indirección de una línea:
  //     export function refreshBeepPrefNow(): void { void readBeepEnabled(); }   // firma SÍNCRONA
  //     refreshBeepPrefNow();                                                    // en handleReading
  // → unit COMPLETA 2852/2852 en verde con el cruce a SecureStore POR BASTONAZO restaurado entero. Las
  // tres reglas de abajo miran la FORMA de la llamada; la asincronía vive ADENTRO del helper, invisible
  // desde el call site. Mismo error que tuve en el respaldo táctil: razonar sobre cómo se manifiesta el
  // problema en vez de observar el resultado.
  //
  // Por eso el invariante se sostiene en TRES capas y esta es la más barata, no la que decide:
  //   1. OBSERVACIÓN del resultado (la que vale): la E2E `baston-feedback-sensorial.spec.ts` **cuenta
  //      los accesos reales al storage** durante N bastonazos y exige CERO. No infiere: mide. Mata
  //      cualquier indirección, tenga el nombre que tenga.
  //   2. ALLOWLIST de lo invocable en el camino caliente (test de abajo): un nombre NUEVO ahí adentro
  //      nace en rojo, aunque no nombre nada sospechoso. Es la versión "escrita sobre la ausencia".
  //   3. Las tres reglas de forma de acá: baratas, corren en `check.mjs`, y matan el mutante literal.
  //
  // Tres reglas sobre el CUERPO de `handleReading`, que es el camino caliente literal:
  //   (a) los nombres de la I/O de la preferencia y del storage no pueden aparecer;
  //   (b) el cuerpo no puede tener NINGÚN `await` ni `.then(` — cubre la asincronía ESCRITA acá, no la
  //       escondida en un helper (eso lo cubren las capas 1 y 2);
  //   (c) el lado POSITIVO: tiene que leer el caché. Sin (c), borrar la consulta entera —y beepear
  //       siempre— pasaría (a) y (b).
  const body = handleReadingBody();

  const ioHit = HOT_PATH_IO.exec(body);
  assert.equal(
    ioHit,
    null,
    `el camino de la lectura volvió a hacer I/O de la preferencia (\`${ioHit?.[0]}\`): eso es un cruce del ` +
      'puente nativo POR BASTONAZO (🟡-11). El valor sale de `cachedBeepEnabled()`, que es síncrono.',
  );
  assert.doesNotMatch(
    body,
    /\bawait\b/,
    'apareció un `await` en `handleReading`: el camino de la lectura tiene que ser SÍNCRONO (R4.9). Lo ' +
      'asíncrono va al warm-up del provider, o fire-and-forget aguas abajo del punto único.',
  );
  assert.doesNotMatch(
    body,
    /\.\s*then\s*\(/,
    'apareció un `.then(` en `handleReading`: colgar el feedback de una promesa desordena las ' +
      'confirmaciones en una ráfaga, además de reintroducir el I/O por bastonazo (🟡-11).',
  );
  assert.match(
    body,
    /\bcachedBeepEnabled\s*\(\s*\)/,
    'el camino de la lectura ya no consulta la preferencia cacheada: o beepea siempre, o nunca.',
  );
});

/**
 * TODO lo que se puede INVOCAR dentro de `handleReading`, con su razón. Es la tabla del camino caliente:
 * un nombre nuevo ahí adentro nace en ROJO hasta que alguien venga a escribir por qué corresponde.
 *
 * ── POR QUÉ ESTA TABLA Y NO OTRA REGLA MÁS (🟠-A de la re-review) ────────────────────────────────────
 * Prohibir `await`/`.then(` mira la FORMA de la llamada, y un helper de firma síncrona que adentro hace
 * la I/O la esconde en una línea (`refreshBeepPrefNow()` → 2852/2852 verde con el 🟡-11 restaurado). No
 * hay patrón de texto que distinga un helper barato de uno que cruza el puente nativo: lo único que
 * escala es **forzar la decisión explícita**, igual que `CONSUMERS` para las superficies del bastón y
 * `PROVIDER_SENSORY_ALLOWED` para los canales. El costo de agregar algo legítimo es una línea acá con su
 * motivo; el costo del falso negativo es un cruce a SecureStore por bastonazo que nadie ve.
 *
 * El oráculo que MIDE (y no infiere) es la E2E: cuenta los accesos reales al storage durante N
 * bastonazos y exige cero. Esta tabla es la red barata que corre en cada `check.mjs`.
 */
const HOT_PATH_CALLABLE: Record<string, string> = {
  acceptingTargets: 'filtra los suscriptores que van a ACTUAR (puro, sin I/O) — 🔴-2',
  resolveReadHandling: 'la decisión del gate (pura) — 🔴-2',
  logTransportEvent: 'logging no bloqueante (console.*) — R15.1',
  now: '`Date.now()`: el reloj del teléfono para la ventana de dedup — R1.5',
  processRawLine: 'motor de ingesta, camino de stream crudo — R1.2',
  processEid: 'motor de ingesta, camino de EID limpio — R7.1',
  classifyReadOutcome: 'clasifica el desenlace para el feedback (pura) — R4.8',
  cachedBeepEnabled: 'LA preferencia, desde el caché en memoria: SÍNCRONA y sin I/O — R4.9',
  playFeedback: 'el punto único del feedback sensorial, aguas abajo del gate — R4.7',
  cb: 'la entrega al consumidor que aceptó (su trabajo asíncrono corre del otro lado) — R1.6',
};

/** Palabras del lenguaje que van seguidas de `(` y no son llamadas. */
const NOT_A_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'await', 'in', 'of',
]);

/** Los nombres INVOCADOS en un cuerpo (`foo(` y `x.foo(` → `foo`), sin las palabras del lenguaje. */
function calleeNames(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!NOT_A_CALL.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

test('GUARD (R4.9): TODO lo invocable en el camino caliente está declarado (uno nuevo nace en rojo)', () => {
  // El repro exacto del reviewer que esto mata: `refreshBeepPrefNow()` — un helper `void` de firma
  // síncrona que adentro hace `void readBeepEnabled()`. No nombra ningún token de I/O, no tiene `await`
  // ni `.then(`, y sigue llamando `cachedBeepEnabled()`: pasaba las tres reglas de forma. Acá cae por lo
  // único que no puede esconder — que es un nombre que nadie declaró en el camino caliente.
  const invocados = calleeNames(handleReadingBody());
  const declarados = Object.keys(HOT_PATH_CALLABLE).sort();

  const sinDeclarar = invocados.filter((n) => !(n in HOT_PATH_CALLABLE));
  assert.deepEqual(
    sinDeclarar,
    [],
    `Hay algo NUEVO invocado dentro de \`handleReading\` (${sinDeclarar.join(', ')}). El camino caliente ` +
      'corre UNA VEZ POR BASTONAZO: cualquier cosa que se llame ahí tiene que ser síncrona y sin I/O ' +
      '(R4.9). Declaralo en `HOT_PATH_CALLABLE` con su motivo, o —si hace I/O— movelo al warm-up del ' +
      'provider. Un helper de firma síncrona que adentro cruza el puente nativo se ve exactamente igual ' +
      'que uno barato desde acá: por eso la decisión hay que escribirla, no adivinarla.',
  );

  const fantasmas = declarados.filter((n) => !invocados.includes(n));
  assert.deepEqual(
    fantasmas,
    [],
    `\`HOT_PATH_CALLABLE\` declara cosas que el camino caliente ya no invoca: ${fantasmas.join(', ')}. ` +
      'Una tabla que describe un código que no existe deja de ser un oráculo.',
  );
});

test('el extractor de invocaciones ve las formas reales (y no confunde palabras del lenguaje)', () => {
  // Un extractor ciego dejaría la tabla en verde sin mirar nada.
  // De `bar.baz(1)` sale `baz` (el CALLEE) y no `bar`: es el nombre de lo que se ejecuta, que es lo que
  // hay que declarar. Lo verifiqué al revés — mi primera expectativa incluía `bar` y este test la corrigió.
  assert.deepEqual(calleeNames('foo(); bar.baz(1); if (x) { qux() }'), ['baz', 'foo', 'qux']);
  assert.deepEqual(calleeNames('for (const a of b) { }'), []);
  assert.deepEqual(calleeNames('try { x() } catch { }'), ['x']);
  assert.deepEqual(calleeNames('return new Map();'), ['Map']);
  // El repro del reviewer, visto por el extractor.
  assert.ok(calleeNames('refreshBeepPrefNow();').includes('refreshBeepPrefNow'));
  assert.ok(!('refreshBeepPrefNow' in HOT_PATH_CALLABLE), 'el helper del repro no puede estar declarado');
  // Y las otras formas de esconder lo mismo.
  assert.ok(calleeNames('prefs.refreshNow();').includes('refreshNow'));
  assert.ok(calleeNames('void warmPref();').includes('warmPref'));
});

test('el guard de R4.9 DETECTA sus mutantes (no pasa verde por mirar un patrón muerto)', () => {
  const ve = (linea: string): boolean =>
    HOT_PATH_IO.test(linea) || /\bawait\b/.test(linea) || /\.\s*then\s*\(/.test(linea);
  // El mutante EXACTO del reviewer, más las evoluciones naturales del bug.
  assert.ok(ve('void readBeepEnabled().then((b) => playFeedback(classifyReadOutcome(candidate), b));'));
  assert.ok(ve('const beep = await readBeepEnabled();'));
  assert.ok(ve('const raw = await SecureStore.getItemAsync(KEY);'));
  assert.ok(ve('const raw = window.localStorage.getItem(KEY);'));
  assert.ok(ve('void loadPref().then(setBeep);'), 'un helper NUEVO con otro nombre: lo caza la regla del .then');
  // Falso positivo: la línea que SÍ corresponde en el camino caliente no puede disparar.
  assert.ok(!ve('playFeedback(classifyReadOutcome(candidate), cachedBeepEnabled());'));
  assert.ok(!ve('const candidate = isRawStream ? engine.processRawLine(rawOrEid, now) : engine.processEid(rawOrEid, now);'));
});

test('MUTANTES 2026-08-06: los canales NUEVOS (expo-haptics / expo-audio) también caen', () => {
  // ── El agujero real que tenía este guard hasta hoy ─────────────────────────────────────────────────
  // El patrón viejo nombraba `playFeedback` LITERAL. Lo probé: una función `playRejectFeedback()` (que es
  // exactamente el nombre que pide el hallazgo 🟡-12) NO matcheaba, así que se podía emitir el aviso
  // negativo ANTES del gate —o desde otro archivo de `services/ble/`— con la suite entera en verde. Cada
  // línea de acá es un mutante que probé contra el patrón VIEJO y pasaba.
  const MUTANTES = [
    ['playRejectFeedback();', 'el emisor del aviso negativo con nombre propio'],
    ['playSound("read-error");', 'un emisor genérico de sonido'],
    ['playBeep();', 'un emisor genérico de beep'],
    ["const H = require('expo-haptics'); H.notificationAsync(H.NotificationFeedbackType.Success);", 'expo-haptics directo'],
    ['void Haptics.notificationAsync(type);', 'la API concreta de la háptica nueva'],
    ['void Haptics.selectionAsync();', 'la tercera API de expo-haptics'],
    ["const p = createAudioPlayer(require('../../assets/sounds/read-ok.wav'));", 'crear un player de audio'],
    ['const player: AudioPlayer = players[cue];', 'nombrar el tipo del player'],
    ['await setAudioModeAsync({ playsInSilentMode: true });', 'tocar el modo de audio del SO'],
    ['primeFeedback();', 'el warm-up (permitido SOLO en el provider y fuera de handleReading)'],
    // ── Agregados en el fix-loop: los dos orquestadores que `feedback.ts` ahora EXPORTA para poder
    //    testearlos por comportamiento. Exportarlos los vuelve importables desde otro archivo de
    //    `services/ble/`, así que el patrón tiene que verlos o abrimos una puerta nueva.
    ['void emitHaptic(pattern);', 'el orquestador del canal táctil, importado desde otro lado'],
    ['void emitCueSound(cue);', 'el orquestador del canal sonoro, importado desde otro lado'],
    ["import { emitHaptic } from './feedback';", 'importar el orquestador táctil'],
  ];
  for (const [linea, porque] of MUTANTES) {
    assert.ok(SENSORY_EMIT.test(linea), `el guard NO ve: ${porque} → ${linea}`);
  }

  // Controles de FALSO POSITIVO: si el patrón se pusiera tan ancho que marca cualquier cosa, el guard se
  // vuelve inservible y alguien lo va a aflojar. Estas líneas TIENEN que seguir en verde.
  const NO_SON_CANALES = [
    "import { cachedBeepEnabled } from './feedback-pref';",
    'const outcome = classifyReadOutcome(candidate);',
    'const plan = decideFeedback(platform, beepEnabled, outcome);',
    'if (!beepEnabled) return null;',
    'const displayLabel = playerName;',
  ];
  for (const linea of NO_SON_CANALES) {
    assert.ok(!SENSORY_EMIT.test(linea), `falso positivo del guard: ${linea}`);
  }

  // Y la allowlist del provider es EXACTAMENTE la que se documentó: si alguien agrega un nombre acá sin
  // explicarlo, este test le recuerda que la allowlist ES la superficie del invariante.
  assert.deepEqual([...PROVIDER_SENSORY_ALLOWED].sort(), ['playFeedback', 'primeFeedback']);
  // El chequeo del provider mira TOKEN por token (M2-bis): dos canales en el MISMO renglón, uno
  // permitido y otro no, tiene que caer. Con el filtro viejo (`!/\bplayFeedback\b/.test(line)`) pasaba.
  const renglonMixto = 'playFeedback(outcome, beep); Vibration.vibrate(50);';
  assert.ok(
    sensoryTokens(renglonMixto).some((t) => !PROVIDER_SENSORY_ALLOWED.has(t)),
    'un renglón con `playFeedback` + otro canal se cuela: el chequeo volvió a mirar la línea entera',
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (3) GUARD SOBRE LA AUSENCIA: la tabla de consumidores del bastón
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * TODAS las puertas de consumo de lecturas del bastón, con su modo de aceptación DECLARADO.
 *
 *   'declares-accepts' → el consumidor se auto-censura en algún estado (ruta dueña, scanner acotado,
 *                        carga manual en curso, sin campo activo) → TIENE que pasar `accepts` para que
 *                        el provider no crea que hay consumidor cuando no lo hay.
 *   'always'           → consume TODA lectura mientras está montado; `accepts` sería ruido.
 *
 * Si aparece un call site que no está acá, este test se pone rojo. Es a propósito: el 🔴-2 nació de una
 * pantalla SIN el mecanismo, así que lo que hay que forzar es la DECISIÓN explícita, no el parche.
 */
interface ConsumerSpec {
  file: string;
  mode: 'declares-accepts' | 'always';
  why: string;
  /**
   * Los TÉRMINOS que el predicado de este consumidor tiene que mirar. No es cosmética: M6 del review
   * borró del `acceptsRead` del overlay el término de la ruta dueña y la suite quedó verde — el predicado
   * seguía existiendo, seguía siendo el mismo de los dos lados, y ya no censuraba nada. Declarar los
   * términos convierte "sacar una condición" en un cambio que hay que venir a escribir acá.
   */
  terms?: string[];
  /**
   * Los ÚNICOS cortes tempranos permitidos dentro de su `onTagRead`, con su razón. M6b: el guard exigía
   * `if (!acceptsRead()) return`, pero NO prohibía un SEGUNDO return — y un corte que el provider no
   * conoce es exactamente el bug peor (confirma y el callback tira). Un corte nuevo nace en rojo.
   *
   * `kind` es la distinción que importa:
   *   'gate'  → corta ANTES de hacer nada con la lectura. TIENE que ser la misma condición que el
   *             predicado, si no el provider confirma algo que este callback descarta.
   *   'stale' → corre DESPUÉS de un await, y descarta un RESULTADO viejo (un lookup que perdió su
   *             ticket, un cambio de campo en vuelo). No puede producir una confirmación falsa: la
   *             lectura YA llegó al consumidor y disparó su trabajo; lo que se tira es la respuesta
   *             obsoleta, y en todos los casos hay un bastonazo más nuevo que sí se está atendiendo.
   */
  earlyReturns?: Array<{ cond: string; kind: 'gate' | 'stale'; why: string }>;
}

const CONSUMERS: ConsumerSpec[] = [
  {
    file: 'app/_components/FindOrCreateOverlay.tsx',
    mode: 'declares-accepts',
    why: 'overlay GLOBAL (siempre montado y siempre suscripto): se suprime por ruta dueña, por scanner acotado y sin campo activo',
    terms: ['establishmentIdRef', 'onBleOwnedRouteRef', 'scopedScannerActiveRef'],
    earlyReturns: [
      { cond: '!establishmentId', kind: 'gate', why: 'estrechamiento de tipo; MISMA condición que el término establishmentIdRef del predicado' },
      { cond: '!acceptsRead()', kind: 'gate', why: 'la guarda ÚNICA (defensa en profundidad del gate del provider)' },
      { cond: 'seqRef.current !== ticket', kind: 'stale', why: 'live-rescan (RB3.5): descarta un lookup que perdió su ticket contra un bastonazo MÁS NUEVO, que sí se está atendiendo' },
    ],
  },
  {
    file: 'app/maniobra/identificar.tsx',
    mode: 'declares-accepts',
    why: 'en maniobra/* el overlay global está suprimido: si esta pantalla no puede actuar (sin campo activo) no queda ningún consumidor',
    terms: ['establishmentIdRef'],
    earlyReturns: [
      { cond: '!acceptsRead()', kind: 'gate', why: 'la guarda ÚNICA' },
      { cond: '!establishmentId', kind: 'gate', why: 'estrechamiento de tipo; MISMA condición que el predicado' },
      { cond: '!mountedRef.current || seqRef.current !== ticket', kind: 'stale', why: 'la pantalla se desmontó por el auto-avance, o el lookup perdió su ticket contra un bastonazo más nuevo' },
    ],
  },
  {
    file: 'app/asignar-caravanas.tsx',
    mode: 'declares-accepts',
    why: 'ruta dueña del bastón sin entrada manual: sin campo activo no encola nada, y con un scanner acotado activo (`/baston`, alcanzable por el CTA nuevo) la lectura es de esa pantalla',
    terms: ['establishmentIdRef', 'scopedScannerActiveRef'],
    earlyReturns: [
      { cond: '!acceptsRead()', kind: 'gate', why: 'la guarda ÚNICA' },
      { cond: '!estId', kind: 'gate', why: 'estrechamiento de tipo; MISMA condición que el término establishmentIdRef' },
      { cond: 'establishmentIdRef.current !== estId', kind: 'stale', why: 'cambió el campo activo mientras el lookup estaba en vuelo; la sesión ya se reinició por su propio efecto' },
    ],
  },
  {
    file: 'src/components/TagScanSheet.tsx',
    mode: 'declares-accepts',
    why: 'ignora las lecturas con un assign en vuelo o con la carga manual abierta, y mientras tanto tiene la propiedad exclusiva del listener',
    terms: ['assigningRef', 'manualModeRef'],
    earlyReturns: [{ cond: '!acceptsRead()', kind: 'gate', why: 'la guarda ÚNICA' }],
  },
  {
    file: 'src/features/ble-stick/screens/StickConnectionScreen.tsx',
    mode: 'always',
    // 🟡-H del review: la pantalla toma el scanner acotado con `useFocusEffect` pero se suscribe con
    // `useEffect([api])`, así que montada-sin-foco sigue contando como consumidor y `drop_no_consumer` no
    // puede dispararse mientras esté en el stack. DECISIÓN: se deja 'always' en esta unidad. El archivo
    // está fuera de alcance (lo edita la unidad hermana, sin commitear) y el efecto es acotado: una
    // lectura de más en una lista que nadie mira, sin dato perdido ni confirmación falsa (la pantalla SÍ
    // la muestra, y si volvés ahí está). Anotado en `docs/backlog.md` por su consecuencia.
    why: 'la pantalla de conexión solo LISTA las lecturas en vivo: mientras está montada consume todas',
  },
];

/**
 * Cómo se detecta un consumidor de lecturas. M8/M8b del review pasaron por acá: el patrón viejo era
 * `useBleStickListener(` o `.subscribeTagRead(`, así que un `const { subscribeTagRead } = api;`
 * (idiomático en React) o un `import { useBleStickListener as useStick }` agregaban un consumidor con la
 * tabla en verde. Ahora se detecta el NOMBRE en cualquier posición —llamada, destructuring, import con o
 * sin alias— porque nombrar el mecanismo ya es entrar en la tabla.
 */
const CONSUMER_CALL = /\b(?:useBleStickListener|subscribeTagRead)\b/;
/** Los archivos que IMPLEMENTAN el mecanismo (no son consumidores). */
const MECHANISM_FILES = new Set(['src/services/ble/stick.ts', 'src/services/ble/BleStickListenerProvider.tsx']);

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
    if (statSync(p).isDirectory()) found.push(...listFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(p);
  }
  return found;
}

const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** Violaciones `<rel>:<línea>` sobre el árbol real, con los comentarios blanqueados. */
function scanTree(predicate: (line: string, rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const rel = relative(APP_ROOT, file).split(sep).join('/');
      stripSourceComments(readFileSync(file, 'utf8'))
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (predicate(line, rel)) hits.push(`${rel}:${i + 1}`);
        });
    }
  }
  return hits;
}

test('GUARD sobre la ausencia: todo consumidor del bastón está en la tabla (uno nuevo nace en rojo)', () => {
  const found = new Set(
    scanTree((line, rel) => !MECHANISM_FILES.has(rel) && CONSUMER_CALL.test(line)).map((v) => v.split(':')[0]),
  );
  const declared = new Set(CONSUMERS.map((c) => c.file));

  const sinDeclarar = [...found].filter((f) => !declared.has(f)).sort();
  assert.deepEqual(
    sinDeclarar,
    [],
    'Hay una superficie NUEVA que consume lecturas del bastón y no está declarada en CONSUMERS ' +
      '(`read-dispatch.test.ts`). Decidí y escribilo: ¿se auto-censura en algún estado? Entonces tiene que ' +
      'pasar `accepts` — si no, el provider va a VIBRAR por lecturas que esa pantalla tira, que es el bug ' +
      '🔴-2 (`maniobra/carga`).',
  );

  const fantasmas = [...declared].filter((f) => !found.has(f)).sort();
  assert.deepEqual(
    fantasmas,
    [],
    'La tabla CONSUMERS declara superficies que ya no consumen el bastón: una tabla que describe una app ' +
      'que no existe deja de ser un oráculo.',
  );
});

/**
 * El nombre CANÓNICO del predicado de aceptación en los consumidores. No es cosmética: exigir un
 * IDENTIFICADOR compartido (y no una expresión cualquiera) es lo que hace que el `accepts` del listener y
 * la guarda de adentro de `onTagRead` no puedan divergir — ver el test de abajo.
 */
const ACCEPTS_FN = 'acceptsRead';

test('GUARD: los consumidores que se auto-censuran DECLARAN `accepts` (sin eso el fix es un no-op)', () => {
  // ── CÓMO SE BURLA ESTO, Y POR QUÉ EL CHEQUEO ES EL QUE ES ────────────────────────────────────────
  // La primera versión de este guard preguntaba `/\baccepts\s*:/` — o sea, "¿el archivo menciona la
  // prop?". Lo probé: cambiar `accepts: acceptsRead` por `accepts: () => true` en el overlay MATA el fix
  // entero (el overlay global está siempre suscripto → siempre habría un "consumidor" → el provider
  // volvería a confirmar lecturas que nadie recibe) y el guard seguía VERDE. Un guard que se burla en una
  // línea es peor que no tenerlo, porque da confianza.
  // Ahora se exigen tres cosas, y cada una mata un bypass distinto:
  //   (a) el valor de `accepts` es el IDENTIFICADOR `acceptsRead`  → mata `accepts: () => true` y
  //       cualquier predicado ad-hoc escrito en el call site;
  //   (b) `acceptsRead` está DEFINIDO en el archivo y su cuerpo no es una constante verdadera → mata
  //       `const acceptsRead = () => true`;
  //   (c) `acceptsRead()` se INVOCA dentro de `onTagRead` → mata que el predicado del listener y la
  //       guarda real del callback se separen (que es como el bug nace de nuevo: el callback tira la
  //       lectura por un motivo que el provider no conoce).
  for (const { file, mode, why } of CONSUMERS) {
    const code = stripSourceComments(readFileSync(join(APP_ROOT, file), 'utf8'));
    const declaresAccepts = /\baccepts\s*:/.test(code);

    if (mode !== 'declares-accepts') {
      assert.equal(
        declaresAccepts,
        false,
        `${file} está declarado como 'always' pero pasa \`accepts\`: o la tabla está desactualizada, o el ` +
          'consumidor empezó a censurarse y hay que decirlo.',
      );
      continue;
    }

    // (a) el valor pasado es el identificador canónico, no una expresión escrita en el call site.
    const passed = /\baccepts\s*:\s*([^,}\n]+)/.exec(code);
    assert.ok(
      passed,
      `${file} se auto-censura (${why}) pero NO le declara \`accepts\` al listener. El provider contaría ` +
        'un consumidor que va a tirar la lectura → confirmación sobre un dato perdido.',
    );
    assert.equal(
      passed[1].trim(),
      ACCEPTS_FN,
      `${file} pasa \`accepts: ${passed[1].trim()}\`. Tiene que pasar el identificador \`${ACCEPTS_FN}\` — ` +
        'el MISMO que gatea su `onTagRead`. Un predicado escrito en el call site (o un `() => true`) ' +
        'desactiva el gate del provider sin que se note: el overlay global está SIEMPRE suscripto, así ' +
        'que basta uno que mienta para que vuelva la confirmación falsa del 🔴-2.',
    );

    // (b) está definido acá y no es una constante verdadera disfrazada.
    const defined = new RegExp(`const\\s+${ACCEPTS_FN}\\s*=\\s*([\\s\\S]{0,400}?);`).exec(code);
    assert.ok(defined, `${file} pasa \`${ACCEPTS_FN}\` pero no lo define (¿viene importado? el guard lo exige local)`);
    const body = defined[1].replace(/\s+/g, ' ');
    assert.doesNotMatch(
      body,
      /=>\s*true\s*$|\(\)\s*=>\s*true\b/,
      `${file}: \`${ACCEPTS_FN}\` es una constante verdadera (${body}). Eso es el no-op con otro nombre: ` +
        `si esta superficie ya no se censura nunca, movela a 'always' en la tabla CONSUMERS y explicá por qué.`,
    );

    // (c) el MISMO predicado gatea la entrega real. Si el callback tira la lectura por un motivo que el
    //     provider no conoce, el 🔴-2 vuelve por la puerta de atrás.
    assert.match(
      code,
      new RegExp(`if\\s*\\(!${ACCEPTS_FN}\\(\\)\\)\\s*return`),
      `${file}: \`onTagRead\` no arranca con \`if (!${ACCEPTS_FN}()) return;\`. El predicado que declara al ` +
        'provider y la guarda que realmente descarta la lectura tienen que ser LA MISMA función: si ' +
        'divergen, el provider confirma lecturas que este callback tira.',
    );

    // (d) el predicado sigue MIRANDO lo que declara mirar (M6). Sacarle un término lo deja existiendo,
    //     idéntico de los dos lados… y sin censurar nada.
    for (const term of CONSUMERS.find((c) => c.file === file)?.terms ?? []) {
      assert.match(
        body,
        new RegExp(`\\b${term}\\b`),
        `${file}: \`${ACCEPTS_FN}\` dejó de mirar \`${term}\`. El predicado sigue ahí y sigue siendo el mismo ` +
          'de los dos lados, pero ya no suprime ese caso — el provider volvería a confirmar lecturas que ' +
          'esa condición existía para descartar. Si el término ya no corresponde, sacalo también de la ' +
          'tabla CONSUMERS y explicá por qué.',
      );
    }
  }
});

/**
 * Las condiciones de todos los `if (<cond>) return` de un cuerpo, con los paréntesis BALANCEADOS.
 *
 * No es un detalle: la primera versión usaba `/if\s*\(([^)]*)\)\s*return\b/`, que se corta en el primer
 * `)` — o sea que NO veía `if (!acceptsRead()) return`, que es justo el corte más importante. El guard
 * se creía completo mirando la mitad de los cortes. Lo cazó su propio chequeo de entradas muertas.
 */
function earlyReturnConditions(body: string): string[] {
  const conds: string[] = [];
  for (const m of body.matchAll(/\bif\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')' && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) continue;
    if (/^\s*return\b/.test(body.slice(close + 1))) {
      conds.push(body.slice(open + 1, close).replace(/\s+/g, ''));
    }
  }
  return conds;
}

test('el extractor de cortes tempranos ve los que tienen paréntesis adentro (se auto-verifica)', () => {
  // Un extractor ciego a `!f()` deja pasar exactamente el corte que más importa, y el guard que lo usa
  // pasa verde creyendo que miró todo.
  assert.deepEqual(earlyReturnConditions('if (!acceptsRead()) return;'), ['!acceptsRead()']);
  assert.deepEqual(earlyReturnConditions('if (!a) return;\nif (b.c !== d) return;'), ['!a', 'b.c!==d']);
  assert.deepEqual(earlyReturnConditions('if (!x.current || y !== z) return;'), ['!x.current||y!==z']);
  // Un `if` que NO corta no cuenta.
  assert.deepEqual(earlyReturnConditions('if (ok) { doThing(); }'), []);
});

test('GUARD (M6b): el callback no corta la lectura por motivos que el provider NO conoce', () => {
  // ── EL BUG QUE CIERRA ────────────────────────────────────────────────────────────────────────────
  // El chequeo (c) de arriba exige que exista `if (!acceptsRead()) return`, pero NO prohíbe un SEGUNDO
  // corte temprano. El reviewer lo usó: agregar otro `if (...) return` adentro del callback deja la suite
  // en verde y pone el modo de falla PEOR — el provider cree que hay consumidor, CONFIRMA, y el callback
  // tira la lectura igual. Es el 🔴-2 con una confirmación falsa encima, que es de donde venimos.
  // La regla: todo corte temprano del `onTagRead` está DECLARADO en la tabla con su razón. Uno nuevo nace
  // en rojo hasta que alguien escriba por qué no puede divergir del predicado.
  for (const { file, mode, earlyReturns } of CONSUMERS) {
    if (mode !== 'declares-accepts') continue;
    const code = stripSourceComments(readFileSync(join(APP_ROOT, file), 'utf8'));
    const head = /const onTagRead = useCallback\(/.exec(code);
    assert.ok(head, `${file}: no se encontró \`onTagRead\` (¿se renombró? actualizá este guard)`);
    const cb = braceBody(code, code.indexOf('{', head.index + head[0].length));

    const found = earlyReturnConditions(cb);
    const declared = (earlyReturns ?? []).map((e) => e.cond.replace(/\s+/g, ''));
    const sinDeclarar = found.filter((c) => !declared.includes(c));
    assert.deepEqual(
      sinDeclarar,
      [],
      `${file}: \`onTagRead\` tiene un corte temprano NO declarado (${sinDeclarar.join(' | ')}). Un motivo ` +
        'de descarte que el provider no conoce es el modo de falla peor: confirma la lectura y el callback ' +
        'la tira igual. Declaralo en `earlyReturns` de la tabla CONSUMERS con la razón por la que no puede ' +
        'divergir del predicado — o, mejor, movelo AL predicado.',
    );
    // …y los declarados existen de verdad (una tabla con entradas muertas deja de describir la app).
    const muertos = declared.filter((c) => !found.includes(c));
    assert.deepEqual(muertos, [], `${file}: \`earlyReturns\` declara cortes que ya no existen: ${muertos.join(' | ')}`);
  }
});

test('GUARD: el mecanismo existe de las dos puntas (el hook lo pasa, el provider lo evalúa)', () => {
  // Sin esto, alguien puede dejar los `accepts:` de los consumidores intactos y romper el cableado en el
  // medio: el hook los ignoraría, el provider contaría a todos los suscriptores y todo seguiría verde.
  const hook = stripSourceComments(readFileSync(join(APP_ROOT, 'src', 'services', 'ble', 'stick.ts'), 'utf8'));
  assert.match(
    hook,
    /subscribeTagRead\([\s\S]*acceptsRef/,
    '`useBleStickListener` ya no le pasa el predicado de aceptación a `subscribeTagRead`: los `accepts` de ' +
      'los consumidores quedarían decorativos.',
  );

  const provider = stripSourceComments(readFileSync(PROVIDER, 'utf8'));
  // Los destinatarios salen de la función PURA (testeada arriba por comportamiento), no de un filtro
  // reescrito a mano en el provider —que es `.tsx` y no lo cubre ninguna suite—.
  assert.match(
    provider,
    /const targets = listening\s*\r?\n?\s*\?\s*acceptingTargets\(/,
    'el provider ya no deriva `targets` de `acceptingTargets(...)`: volvería a contar suscriptores en vez ' +
      'de consumidores, y el overlay global (siempre suscripto) haría del gate un no-op.',
  );
  // …y el número que alimenta la decisión es el de ESOS destinatarios, no el tamaño del Set.
  assert.match(
    provider,
    /acceptingConsumers:\s*targets\.length/,
    'el gate ya no se decide con la cantidad de destinatarios REALES.',
  );
  assert.doesNotMatch(
    provider,
    /acceptingConsumers:\s*(?:subscribers|tagSubscribersRef)/,
    'el gate volvió a contar SUSCRIPTORES: el overlay global está siempre suscripto, así que eso es un no-op.',
  );
  // Y el despacho va a los que aceptaron, no al Set entero: si no, "a quién le confirmó" y "quién la
  // recibió" pueden divergir otra vez.
  assert.match(
    provider,
    /for \(const cb of targets\)/,
    'el despacho volvió a recorrer todos los suscriptores en vez de los que aceptaron.',
  );

  // Cada entrega va ACOTADA (🟠-D del review). No es cosmético: es la condición que hace defendible el
  // fail-open de `acceptingTargets`. Sin el try/catch, un consumidor que tira se lleva a los que siguen y
  // la excepción sube al read-loop del transporte, que tampoco atrapa → el bastón queda mudo hasta
  // reconectar, y el fundamento escrito del fail-open deja de ser cierto.
  const dispatch = /for \(const cb of targets\)\s*\{([\s\S]{0,500}?)\n {4}\}/.exec(provider);
  assert.ok(dispatch, 'no se pudo aislar el bucle de despacho (¿cambió de forma? actualizá este guard)');
  assert.match(
    dispatch[1],
    /try\s*\{[\s\S]*?cb\(candidate\.eid\);[\s\S]*?\}\s*catch/,
    'el despacho entrega `cb(...)` SIN try/catch: un consumidor que tira mata la ingesta del bastón hasta ' +
      'reconectar, y el fail-open del predicado se queda sin fundamento.',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó el árbol real (no pasa verde por no mirar nada)', () => {
  const scanned = ROOTS.flatMap(listFiles);
  assert.ok(scanned.length >= 300, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  for (const expected of CONSUMERS.map((c) => c.file)) {
    assert.ok(
      scanned.some((f) => relative(APP_ROOT, f).split(sep).join('/') === expected),
      `${expected} tiene que existir con ese path exacto (es la tabla del guard)`,
    );
  }
  assert.ok(scanned.some((f) => f === PROVIDER), 'el provider tiene que estar dentro del árbol escaneado');
});

test('el guard DETECTA las firmas (no pasa verde por no estar mirando nada)', () => {
  // Un guard que no puede fallar es un guard muerto. Se verifica sobre las líneas EXACTAS del árbol.
  assert.ok(CONSUMER_CALL.test('  useBleStickListener({ enabled, onTagRead });'));
  assert.ok(CONSUMER_CALL.test('    const unsub = api.subscribeTagRead((eid) => {'));
  assert.ok(CONSUMER_CALL.test('  const { isConnected } = useBleStickListener({'));
  // ── Las dos formas con las que el review agregó un consumidor con la tabla en VERDE (M8 / M8b) ──
  // Se detecta el NOMBRE en cualquier posición: nombrar el mecanismo ya es entrar en la tabla. Cuesta
  // algún falso positivo (un import que no llama) y eso está bien: el costo es escribir una línea en la
  // tabla; el costo del falso negativo es una pantalla que recibe bastonazos y los tira en silencio.
  assert.ok(CONSUMER_CALL.test('  const { subscribeTagRead } = api;'), 'M8: destructuring');
  assert.ok(
    CONSUMER_CALL.test("import { useBleStickListener as useStick } from '@/services/ble/stick';"),
    'M8b: alias de import',
  );
  assert.ok(CONSUMER_CALL.test('import { useBleStickListener } from "@/services/ble/stick";'));
  // Una mención en un comentario NO dispara (se blanquea antes de escanear).
  assert.ok(!CONSUMER_CALL.test(stripSourceComments('// la pantalla usa useBleStickListener({...})')));
  // Y algo que no nombra el mecanismo tampoco.
  assert.ok(!CONSUMER_CALL.test('  const { isConnected } = useBleConnectionStatus();'));
});
