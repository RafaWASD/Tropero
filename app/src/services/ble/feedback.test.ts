// Tests de la DECISIÓN de feedback (R4.1, R4.2, R4.5, R4.8) + de la preferencia de sonido (R4.3) + de la
// ORQUESTACIÓN de los dos canales de efecto. node:test.
//
// Dos capas y la frontera entre ellas importa:
//   · La DECISIÓN (`decideFeedback` / `classifyReadOutcome`) es pura y se ejerce entera.
//   · La ORQUESTACIÓN del efecto (`emitHaptic` / `emitCueSound`, en `feedback.ts`) también se EJERCE
//     acá, inyectándole cargadores falsos. No es un lujo: los dos bugs más caros de esta unidad vivían
//     ahí y ninguno era visible desde web, desde CI ni desde un guard de texto — «el respaldo táctil
//     nunca se ejecutaba» (🔴 del review) y «el sonido quedaba mudo del segundo bastonazo» (🟠-2).
//     `feedback.ts` no importa RN/expo en el cuerpo del módulo (todo es `require` perezoso dentro de las
//     funciones), así que node:test lo puede cargar.
//   · Lo que sigue SIN testearse en CI es el efecto FÍSICO real (que el teléfono vibre y suene): eso
//     necesita device. En WEB lo cubre la E2E `baston-feedback-sensorial.spec.ts`, que cuenta los
//     `AudioContext` y mira la frecuencia del oscilador.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReadOutcome,
  decideFeedback,
  fallbackVibrationPattern,
  parseBeepPref,
  BEEP_DEFAULT_ENABLED,
  type FeedbackPlatform,
  type HapticPattern,
  type ReadOutcome,
  type SoundCue,
} from './feedback-logic.ts';
import { emitHaptic, emitCueSound } from './feedback.ts';

const PLATFORMS: FeedbackPlatform[] = ['web', 'native'];
const OUTCOMES: ReadOutcome[] = ['accepted', 'rejected', 'duplicate'];

// ─── Clasificación del desenlace (el eje del vocabulario sensorial) ─────────────────────

test('classifyReadOutcome: mapea las TRES formas de candidato del motor de ingesta', () => {
  assert.equal(classifyReadOutcome({ eid: '982000123456789' }), 'accepted');
  assert.equal(classifyReadOutcome({ rejected: 'invalid_eid' }), 'rejected');
  assert.equal(classifyReadOutcome({ rejected: 'parse_failed' }), 'rejected');
  // 🟡-2 del review de F1: el driver de un tercero que EXPLOTA tiene motivo propio, y al operario le
  // tiene que sonar igual que cualquier otro rechazo (la causa es para el log, no para la manga).
  assert.equal(classifyReadOutcome({ rejected: 'parser_threw' }), 'rejected');
  assert.equal(classifyReadOutcome({ rejected: 'empty' }), 'rejected');
  // null = lo comió la ventana de dedup (R3.1). NO es un fracaso: ese animal ya entró hace <3 s.
  assert.equal(classifyReadOutcome(null), 'duplicate');
});

// ─── R4.1: el canal TÁCTIL ──────────────────────────────────────────────────────────────

test('R4.1: en native la háptica se dispara SIEMPRE, con sonido ON y con sonido OFF', () => {
  // Apagar el sonido NO apaga el canal táctil: es la mitad de la redundancia que sobrevive al ruido.
  for (const beep of [true, false]) {
    assert.equal(decideFeedback('native', beep, 'accepted').haptic, 'success');
    assert.equal(decideFeedback('native', beep, 'rejected').haptic, 'error');
  }
});

test('R4.5: en web el canal táctil se degrada en silencio (la vibración de desktop es pobre)', () => {
  for (const beep of [true, false]) {
    for (const outcome of OUTCOMES) {
      assert.equal(decideFeedback('web', beep, outcome).haptic, null);
    }
  }
});

// ─── R4.8: el desenlace NEGATIVO tiene señal PROPIA (🟡-12) ─────────────────────────────

test('R4.8: "llegó algo y no servía" NO produce la misma señal que "entró" — en NINGÚN canal', () => {
  // EL punto del hallazgo 🟡-12: antes los dos desenlaces eran indistinguibles (uno vibraba, el otro era
  // el mismo silencio que "bastón mudo"), así que el peón no podía aprender del producto. Si alguien
  // colapsa los dos patrones a uno, esto cae.
  const ok = decideFeedback('native', true, 'accepted');
  const bad = decideFeedback('native', true, 'rejected');
  assert.notEqual(ok.haptic, bad.haptic, 'el patrón háptico de "no sirvió" es igual al de "entró"');
  assert.notEqual(ok.sound?.cue, bad.sound?.cue, 'el sonido de "no sirvió" es igual al de "entró"');
  // Y en web, donde no hay canal táctil, la distinción tiene que sobrevivir SOLA en el sonido.
  const okWeb = decideFeedback('web', true, 'accepted');
  const badWeb = decideFeedback('web', true, 'rejected');
  assert.notEqual(
    okWeb.sound?.cue,
    badWeb.sound?.cue,
    'en web el único canal es el sonido: si los dos cues coinciden, el desenlace negativo desaparece',
  );
});

test('R4.8: con el sonido APAGADO la distinción sobrevive por el canal táctil (no se pierde el aviso)', () => {
  const ok = decideFeedback('native', false, 'accepted');
  const bad = decideFeedback('native', false, 'rejected');
  assert.equal(ok.sound, null);
  assert.equal(bad.sound, null);
  assert.notEqual(ok.haptic, bad.haptic, 'sin sonido, apagar el aviso negativo lo dejaría mudo del todo');
});

// ─── Re-lectura dentro de la ventana de dedup: SILENCIO deliberado ──────────────────────

test('R3.1: una re-lectura (duplicate) es MUDA en los dos canales y en las dos plataformas', () => {
  // Confirmar de nuevo sería confirmar dos veces una sola captura (el modo de falla de 🔴-2); avisar
  // "no sirvió" sería mentir sobre un animal que SÍ está. El fundamento está en feedback-logic.ts.
  for (const platform of PLATFORMS) {
    for (const beep of [true, false]) {
      assert.deepEqual(decideFeedback(platform, beep, 'duplicate'), { haptic: null, sound: null });
    }
  }
});

// ─── R4.2 / R4.3 / R4.5: el canal SONORO ────────────────────────────────────────────────

test('R4.2/R4.3: el sonido se dispara SOLO con la preferencia habilitada', () => {
  for (const platform of PLATFORMS) {
    for (const outcome of ['accepted', 'rejected'] as ReadOutcome[]) {
      assert.notEqual(decideFeedback(platform, true, outcome).sound, null);
      assert.equal(decideFeedback(platform, false, outcome).sound, null);
    }
  }
});

test('R4.5: el canal del sonido es web-audio en web y native en device', () => {
  assert.equal(decideFeedback('web', true, 'accepted').sound?.channel, 'web-audio');
  assert.equal(decideFeedback('native', true, 'accepted').sound?.channel, 'native');
  assert.equal(decideFeedback('web', true, 'rejected').sound?.channel, 'web-audio');
  assert.equal(decideFeedback('native', true, 'rejected').sound?.channel, 'native');
});

test('los cues mapean 1:1 a los assets generados (app/assets/sounds/<cue>.wav)', () => {
  assert.equal(decideFeedback('native', true, 'accepted').sound?.cue, 'read-ok');
  assert.equal(decideFeedback('native', true, 'rejected').sound?.cue, 'read-error');
});

test('INVARIANTE: la preferencia apaga el SONIDO y nunca el canal táctil (sobre todo el espacio)', () => {
  // La propiedad, no los casos. Cualquier reescritura que deje la háptica colgando de la preferencia
  // —que es exactamente lo que pediría "hacé que el switch apague todo"— cae acá.
  for (const platform of PLATFORMS) {
    for (const outcome of OUTCOMES) {
      const on = decideFeedback(platform, true, outcome);
      const off = decideFeedback(platform, false, outcome);
      assert.equal(on.haptic, off.haptic, `la preferencia movió la háptica en ${platform}/${outcome}`);
      assert.equal(off.sound, null, `la preferencia OFF dejó sonido en ${platform}/${outcome}`);
    }
  }
});

test('el plan NUNCA tiene un canal a medias (cue sin canal, o canal sin cue)', () => {
  for (const platform of PLATFORMS) {
    for (const beep of [true, false]) {
      for (const outcome of OUTCOMES) {
        const { sound } = decideFeedback(platform, beep, outcome);
        if (sound === null) continue;
        assert.ok(sound.cue === 'read-ok' || sound.cue === 'read-error', `cue inválido: ${sound.cue}`);
        assert.ok(sound.channel === 'web-audio' || sound.channel === 'native');
      }
    }
  }
});

// ─── R4.3: preferencia de sonido persistida (lógica pura del parseo) ────────────────────

test('R4.3: el sonido está ON por defecto (sin valor persistido)', () => {
  assert.equal(BEEP_DEFAULT_ENABLED, true);
  assert.equal(parseBeepPref(null), true);
  assert.equal(parseBeepPref(''), true); // valor inesperado → default
  assert.equal(parseBeepPref('garbage'), true); // storage corrupto → default (defensivo)
});

test('R4.3: el flag persistido se interpreta como booleano (1=ON, 0=OFF)', () => {
  assert.equal(parseBeepPref('1'), true);
  assert.equal(parseBeepPref('0'), false);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// ORQUESTACIÓN DEL CANAL TÁCTIL — el 🔴 del review, EJECUTADO
//
// EL BUG: la primera versión ponía el respaldo (`Vibration`) en el `catch` del `require('expo-haptics')`,
// asumiendo que el require TIRA cuando falta el módulo nativo. No tira: `expo-haptics` resuelve con
// `requireOptionalNativeModule` (devuelve **null**) y `notificationAsync` es `async`, así que el fallo
// sale como **promesa rechazada**. El `.catch` se la comía, venía un `return`, y el bloque de `Vibration`
// quedaba **INALCANZABLE**: en el APK que no tiene el módulo no vibraba nada, cuando antes vibraba 50 ms.
//
// El guard viejo pasaba en verde porque verificaba que el TEXTO del `Vibration` siguiera en el archivo.
// Estos tests verifican que se EJECUTE. Cada uno es una forma distinta de fallar del canal rico, porque
// el error de fondo fue razonar sobre CÓMO falla en vez de mirar SI emitió.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** Espía del canal de respaldo: registra los patrones con los que lo llamaron. */
function fallbackSpy(): { calls: HapticPattern[]; fn: (p: HapticPattern) => void } {
  const calls: HapticPattern[] = [];
  return { calls, fn: (p) => calls.push(p) };
}

test('🔴 R4.1: si el canal rico RECHAZA (módulo nativo ausente) se EJECUTA el respaldo', async () => {
  // Este es EXACTAMENTE el APK instalado hoy: el paquete JS resuelve, el módulo nativo no está, y
  // `notificationAsync` devuelve una promesa rechazada. Antes de este fix, acá no vibraba NADA.
  const spy = fallbackSpy();
  await emitHaptic(
    'success',
    () => () => Promise.reject(new Error('UnavailabilityError: Haptics.notificationAsync')),
    () => spy.fn,
  );
  assert.deepEqual(spy.calls, ['success'], 'el respaldo táctil NO se ejecutó: el bastonazo queda mudo');
});

test('🔴 R4.1: si el paquete no resuelve (cargador devuelve null) también se ejecuta el respaldo', async () => {
  const spy = fallbackSpy();
  await emitHaptic('error', () => null, () => spy.fn);
  assert.deepEqual(spy.calls, ['error']);
});

test('🔴 R4.1: si el CARGADOR del canal rico tira, también se ejecuta el respaldo', async () => {
  const spy = fallbackSpy();
  await emitHaptic(
    'success',
    () => {
      throw new Error('require falló');
    },
    () => spy.fn,
  );
  assert.deepEqual(spy.calls, ['success']);
});

test('🔴 R4.1: si el canal rico TIRA SÍNCRONAMENTE en vez de rechazar, también se ejecuta el respaldo', async () => {
  // La cuarta forma de fallar. El fix no razona sobre cuál es: espera el resultado y mira si emitió.
  const spy = fallbackSpy();
  await emitHaptic(
    'error',
    () => () => {
      throw new Error('boom síncrono');
    },
    () => spy.fn,
  );
  assert.deepEqual(spy.calls, ['error']);
});

test('CONTRAFACTUAL: si el canal rico SÍ emite, el respaldo NO corre (no se vibra dos veces)', async () => {
  // Sin este lado, "vibrar siempre por las dos vías" pasaría todos los tests de arriba, y el peón
  // sentiría el patrón rico pisado por un buzz plano — o sea perdería la distinción de R4.8.
  const spy = fallbackSpy();
  let ricas = 0;
  await emitHaptic(
    'success',
    () => () => {
      ricas += 1;
      return Promise.resolve();
    },
    () => spy.fn,
  );
  assert.equal(ricas, 1, 'no se intentó el canal rico');
  assert.deepEqual(spy.calls, [], 'se vibró DOS veces: el respaldo corrió aunque el canal rico emitió');
});

test('R4.5: sin NINGÚN canal táctil no tira (degrada en silencio y nunca rompe la ingesta)', async () => {
  await assert.doesNotReject(() => emitHaptic('success', () => null, () => null));
  await assert.doesNotReject(() =>
    emitHaptic(
      'error',
      () => () => Promise.reject(new Error('sin módulo')),
      () => () => {
        throw new Error('Vibration tampoco');
      },
    ),
  );
});

test('R4.8: la ORQUESTACIÓN pasa el patrón intacto al canal que emita (con dobles inyectados)', async () => {
  // ⚠️ ALCANCE, dicho con precisión (🟠-B de la re-review): esto usa un doble, así que prueba que
  // `emitHaptic` NO pierde ni pisa el patrón por el camino. NO puede decir NADA del respaldo REAL —
  // que los dos patrones de `Vibration` difieran lo verifica el test de `fallbackVibrationPattern`.
  const spy = fallbackSpy();
  await emitHaptic('success', () => null, () => spy.fn);
  await emitHaptic('error', () => null, () => spy.fn);
  assert.deepEqual(spy.calls, ['success', 'error']);
  const ricos: HapticPattern[] = [];
  await emitHaptic(
    'error',
    () => (p) => {
      ricos.push(p);
      return Promise.resolve();
    },
    () => spy.fn,
  );
  assert.deepEqual(ricos, ['error']);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// EL PATRÓN DEL CANAL DE RESPALDO — 🟠-B de la re-review, EJECUTADO
//
// EL AGUJERO: el patrón vivía inline en `loadFallbackHaptic`, y colapsar los dos desenlaces a un solo
// buzz (`Vibration.vibrate(50)` para los dos) dejaba la suite en **67/67 verde**. El único test que
// sonaba a cubrirlo inyecta un doble → prueba la orquestación, no el respaldo real.
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE: en un APK **sin** el módulo nativo de `expo-haptics` —el que
// hay instalado hoy y todo el parque hasta el próximo build— el respaldo es el ÚNICO canal táctil. Con
// el sonido apagado (el switch lo permite, R4.1 lo bendice) o con sol, ruido o presbiacusia, colapsar
// los patrones deja "entró" y "no servía" indistinguibles: 🟡-12 restaurado justo donde el respaldo
// existía para evitarlo.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

test('🟠-B R4.8: los dos patrones del RESPALDO difieren de verdad (no colapsan a un buzz)', () => {
  const ok = fallbackVibrationPattern('success');
  const bad = fallbackVibrationPattern('error');
  assert.notDeepEqual(
    ok,
    bad,
    'el respaldo táctil colapsó los dos desenlaces a un solo patrón. En un APK sin el módulo nativo ese ' +
      'es el ÚNICO canal táctil: "entró" y "no servía" vuelven a ser indistinguibles (🟡-12).',
  );
});

test('🟠-B: los patrones difieren en lo que se PERCIBE con guante (duración y ritmo, no amplitud)', () => {
  // `Vibration` no controla amplitud, así que "más fuerte" no es una opción: la distinción tiene que
  // estar en el largo y en la cantidad de pulsos. Un mutante que cambie 50 → 60 ms haría `notDeepEqual`
  // verde y seguiría siendo indistinguible en la mano; esto lo caza.
  const total = (p: number | number[]): number =>
    typeof p === 'number' ? p : p.reduce((a, b) => a + b, 0);
  const pulsos = (p: number | number[]): number => (typeof p === 'number' ? 1 : Math.floor(p.length / 2));

  const ok = fallbackVibrationPattern('success');
  const bad = fallbackVibrationPattern('error');
  assert.ok(pulsos(bad) > pulsos(ok), `"no servía" tiene que tener más pulsos que "entró" (${pulsos(bad)} vs ${pulsos(ok)})`);
  assert.ok(
    total(bad) > total(ok) * 1.5,
    `"no servía" (${total(bad)} ms) tiene que ser claramente más largo que "entró" (${total(ok)} ms): ` +
      'con guante, el largo y el ritmo se distinguen antes que cualquier otra cosa',
  );
  // Y ninguno puede ser tan corto que no se sienta, ni tan largo que se lea como una llamada entrante.
  for (const [nombre, p] of [['success', ok], ['error', bad]] as const) {
    assert.ok(total(p) >= 40, `el patrón \`${nombre}\` es demasiado corto para sentirse (${total(p)} ms)`);
    assert.ok(total(p) <= 600, `el patrón \`${nombre}\` dura ${total(p)} ms: se confunde con una notificación`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// ORQUESTACIÓN DEL CANAL SONORO NATIVO — 🟠-2 del review, EJECUTADO
//
// El invariante es un ORDEN: hay que rebobinar ANTES de tocar, y hay que ESPERAR el rebobinado. Un player
// que ya terminó queda parado en el final (`actionAtItemEnd = .pause`), y en expo-audio `play` es una
// `Function` SÍNCRONA mientras `seekTo` es una `AsyncFunction` → un `void seekTo(0); play();` toca primero
// sobre un player parado en el final = **mudo del segundo bastonazo en adelante**.
// Un orden no se verifica con un regex: se verifica ejecutándolo y mirando la secuencia.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** Player falso que registra la secuencia REAL de llamadas. */
function playerSpy(opts: { seekRejects?: boolean; playThrows?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    player: {
      seekTo: async (seconds: number) => {
        calls.push(`seekTo(${seconds})`);
        await Promise.resolve();
        if (opts.seekRejects) throw new Error('seek falló');
      },
      play: () => {
        calls.push('play');
        if (opts.playThrows) throw new Error('play falló');
      },
    },
  };
}

test('🟠-2: el cue REBOBINA y recién después toca (si no, del 2.º bastonazo en adelante queda mudo)', async () => {
  const spy = playerSpy();
  await emitCueSound('read-ok', () => spy.player);
  assert.deepEqual(
    spy.calls,
    ['seekTo(0)', 'play'],
    'el orden se rompió: `play` antes del rebobinado deja el player parado en el final y no suena',
  );
});

test('🟠-2: el rebobinado se ESPERA (un seek encolado sin await deja el play adentro de la ventana)', async () => {
  // El seek falso mete DOS ticks de espera. Si el código volviera a `void seekTo(0); play()`, el `play`
  // se registraría entre `seek:start` y `seek:done` — que es exactamente el bug en device.
  const calls: string[] = [];
  const player = {
    seekTo: async (seconds: number) => {
      calls.push(`seek:start(${seconds})`);
      await Promise.resolve();
      await Promise.resolve();
      calls.push('seek:done');
    },
    play: () => calls.push('play'),
  };
  await emitCueSound('read-error', () => player);
  assert.deepEqual(
    calls,
    ['seek:start(0)', 'seek:done', 'play'],
    'el `play` corrió antes de que el rebobinado terminara: en device eso es un beep que no suena',
  );
});

test('🟠-2: si el rebobinado FALLA igual se intenta tocar ("capaz suena" > "seguro no suena")', async () => {
  const spy = playerSpy({ seekRejects: true });
  await emitCueSound('read-ok', () => spy.player);
  assert.deepEqual(spy.calls, ['seekTo(0)', 'play']);
});

test('sin player (módulo ausente / creación fallida) el cue no tira ni intenta nada', async () => {
  await assert.doesNotReject(() => emitCueSound('read-ok', () => null));
  await assert.doesNotReject(() =>
    emitCueSound('read-error', () => {
      throw new Error('createAudioPlayer falló');
    }),
  );
  const spy = playerSpy({ playThrows: true });
  await assert.doesNotReject(() => emitCueSound('read-ok', () => spy.player));
});

test('cada cue va a SU player (no se cruzan: el aviso negativo no puede sonar como el positivo)', async () => {
  const pedidos: SoundCue[] = [];
  const spy = playerSpy();
  await emitCueSound('read-error', (c) => {
    pedidos.push(c);
    return spy.player;
  });
  await emitCueSound('read-ok', (c) => {
    pedidos.push(c);
    return spy.player;
  });
  assert.deepEqual(pedidos, ['read-error', 'read-ok']);
});
