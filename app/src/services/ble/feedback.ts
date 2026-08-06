// Feedback sensorial de una lectura del bastón (R4) — EL PUNTO ÚNICO de emisión (R4.7). Redundancia
// para la manga (context decisión 3): háptica (se siente con guante/barro y con el teléfono guardado) +
// sonido (se oye al sol, que es cuando la pantalla no se ve) + confirmación visual (R2.4, la maneja la
// UI). El peón mira al ANIMAL, no al teléfono.
//
// Reglas (R4.1, R4.2, R4.5, R4.8):
//   - Háptica SIEMPRE en native (no apagable, R4.1), con patrón distinto según el desenlace: 'success'
//     para una lectura que entró, 'error' para una que llegó y no servía (R4.8). En web se degrada en
//     silencio (la vibración de desktop es pobre, R4.5).
//   - Sonido solo si la preferencia está habilitada (R4.2/R4.3). En web: Web Audio (R4.5); en native:
//     el asset .wav vía expo-audio.
//   - Una re-lectura dentro de la ventana de dedup es MUDA a propósito (ver feedback-logic.ts).
//
// ── POR QUÉ expo-haptics / expo-audio, y por qué el motivo escrito antes ERA FALSO ────────────────────
// Hasta el 2026-08-06 este archivo decía que el beep nativo era «un placeholder: no hay módulo de sonido
// en deps», y `utils/haptics.ts` justificaba no usar `expo-haptics` porque «abriría superficie de
// postinstall (onlyBuiltDependencies, ADR-011)». Eso es fácticamente falso y se verificó ejecutando
// `npm view expo-haptics scripts dependencies` y lo mismo para `expo-audio`: los DOS paquetes tienen
// `dependencies: {}` y NINGÚN script de `postinstall`/`install`/`prepare` (solo lint/test/build/clean de
// `expo-module-scripts`). El allowlist de pnpm ni se consulta para ellos, y la instalación no agregó una
// sola entrada a `onlyBuiltDependencies`. Además `ADR-013 §Capa 4` ya los listaba en el stack
// («expo-haptics — feedback táctil. El operario con guantes/barro siente la vibración aunque no vea la
// pantalla»), o sea que la nota del código contradecía al ADR, que está más arriba en la jerarquía de
// verdad.
//
// Lo que SÍ cambia de verdad al sumarlos: el FINGERPRINT del build nativo. Los dos traen módulo nativo →
// hace falta un build de EAS nuevo para verlos en device. Hasta que ese build exista, el APK instalado
// no tiene los módulos: el sonido queda apagado y el canal táctil cae al RESPALDO de `Vibration`
// (`emitHaptic`, abajo), o sea que no se rompe nada y no se pierde el feedback que ya había.
//
// Diseño para testabilidad: la DECISIÓN de qué canales disparar (decideFeedback) es PURA (vive en
// feedback-logic.ts, sin RN/expo) → node:test la verifica por desenlace, con sonido ON/OFF y por
// plataforma. El EFECTO físico (playFeedback) hace la I/O guardada por plataforma y NO se testea en CI
// (necesita device / browser); en WEB sí lo ve la E2E, que cuenta los `AudioContext` y mira la
// frecuencia del oscilador (así "¿el producto le dijo algo al peón, y qué?" es un número observable).

import {
  decideFeedback,
  classifyReadOutcome,
  fallbackVibrationPattern,
  FEEDBACK_AUDIO_MODE,
} from './feedback-logic';
import type { FeedbackPlatform, HapticPattern, ReadOutcome, SoundCue } from './feedback-logic';

export { decideFeedback, classifyReadOutcome } from './feedback-logic';
export type { FeedbackPlatform, FeedbackPlan, ReadOutcome, HapticPattern, SoundCue } from './feedback-logic';

// ─── Efecto físico (I/O guardada; no testeado en CI) ────────────────────────────────────
//
// Importes perezosos de RN/expo/Web Audio dentro de las funciones de efecto para que este módulo
// siga siendo importable desde node:test (la DECISIÓN no arrastra RN). decideFeedback queda
// puro arriba; playFeedback solo se ejecuta en runtime de app.

function resolvePlatform(): FeedbackPlatform {
  // Acceso perezoso a Platform: si RN no está disponible (node:test no llama a playFeedback),
  // este código no se ejecuta. require dinámico para no romper el type-stripping de node.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native') as typeof import('react-native');
    return Platform.OS === 'web' ? 'web' : 'native';
  } catch {
    return 'native';
  }
}

// ─── Canal TÁCTIL ────────────────────────────────────────────────────────────────────────
//
// `notificationAsync` y no `impactAsync`: un impacto es UN golpe (una intensidad), y lo que hace falta
// acá no es "más fuerte" sino DISTINGUIBLE. Los `NotificationFeedbackType` son patrones —varios pulsos
// con su ritmo— que el sistema operativo ya usa para "salió bien" / "salió mal" en todo el teléfono, así
// que el peón los reconoce sin que nadie se los enseñe y no los confunde con un WhatsApp entrante.
// En iOS además maneja el Taptic Engine de verdad; `Vibration.vibrate(ms)` de RN en iOS solo sabe hacer
// el zumbido crudo de ~400 ms y IGNORA la duración pedida.
//
// ── 🔴 DEL REVIEW (2026-08-06): EL FALLBACK ERA CÓDIGO MUERTO ────────────────────────────────────────
// La primera versión asumía que `require('expo-haptics')` TIRA cuando falta el módulo nativo, y sobre
// ese supuesto ponía el `Vibration` en el `catch`. Es falso, y lo verifiqué en la fuente del paquete:
//   · `expo-haptics/src/ExpoHaptics.ts` → `requireOptionalNativeModule('ExpoHaptics')`, que devuelve
//     **`null` y NO tira** (la variante OPCIONAL; `expo-audio` usa `requireNativeModule`, que sí tira —
//     esa asimetría es la que se me pasó y por eso traté a los dos módulos igual);
//   · `expo-haptics/src/Haptics.ts` → `notificationAsync` es `export async function` y hace
//     `if (!ExpoHaptics?.notificationAsync) throw new UnavailabilityError(...)` ADENTRO, o sea que el
//     fallo sale como **promesa rechazada**, nunca como throw síncrono.
// Camino real en un APK sin el módulo: `require` OK → promesa rechazada → `.catch` se la comía → `return`
// → el bloque de `Vibration` **inalcanzable**. Resultado: **NO vibraba nada**, cuando antes de esta
// unidad vibraba 50 ms. Un retroceso, disfrazado de degradación.
//
// ── CÓMO SE ARREGLA PARA QUE NO VUELVA ───────────────────────────────────────────────────────────────
// El error no fue una línea: fue **razonar sobre CÓMO falla el canal**. Así que ahora no se razona: se
// espera el resultado y **el respaldo se decide por lo que PASÓ**, no por dónde saltó la excepción.
// `emitHaptic` está EXPORTADA y con los dos cargadores INYECTABLES a propósito — no es una comodidad de
// diseño, es la única forma de que un test EJECUTE el camino de la ausencia sin un teléfono. El guard
// anterior verificaba que el texto `Vibration } = require('react-native')` existiera en el archivo, y
// pasaba en verde con el fallback muerto: verificaba la PRESENCIA del código, no su ALCANZABILIDAD.

/** Canal táctil rico. La promesa RECHAZA si no pudo emitir (módulo ausente, error nativo). */
type RichHaptic = (pattern: HapticPattern) => Promise<void>;
/** Canal táctil de respaldo, síncrono. */
type FallbackHaptic = (pattern: HapticPattern) => void;

/** `expo-haptics`, o null si el paquete no está resoluble. Ojo: NO dice si el módulo NATIVO está. */
function loadRichHaptic(): RichHaptic | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Haptics = require('expo-haptics') as typeof import('expo-haptics');
    return (pattern: HapticPattern) =>
      Haptics.notificationAsync(
        pattern === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success,
      );
  } catch {
    return null;
  }
}

/**
 * El `Vibration` de RN, o null (web / sin RN).
 *
 * El patrón sale de `fallbackVibrationPattern` (puro) y NO de un ternario escrito acá: es el único canal
 * táctil en un APK sin el módulo nativo, y colapsar los dos desenlaces a un solo buzz dejaba la suite en
 * verde (🟠-B de la re-review). Como valor puro, que los dos difieran se verifica ejecutándolo.
 */
function loadFallbackHaptic(): FallbackHaptic | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Vibration } = require('react-native') as typeof import('react-native');
    if (!Vibration) return null;
    return (pattern: HapticPattern) => Vibration.vibrate(fallbackVibrationPattern(pattern));
  } catch {
    return null;
  }
}

/** Invoca un cargador sin dejar que su falla se propague. */
function safeLoad<T>(load: () => T | null): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

/**
 * Emite el canal táctil de una lectura (R4.1): intenta el canal RICO y, **si no emitió de verdad**, cae
 * al de respaldo. "No emitió de verdad" incluye las tres formas en que esto falla —el paquete no
 * resuelve, el módulo nativo no está (promesa rechazada), o el nativo tira— y por eso se **espera** el
 * resultado en vez de suponer por dónde va a saltar.
 *
 * Nunca rechaza: sin ningún canal, silencio (R4.5 generaliza: el feedback jamás rompe el flujo).
 *
 * Los cargadores son parámetros con default para que `feedback.test.ts` pueda EJECUTAR el camino de la
 * ausencia. Ese test es el que faltaba: el guard viejo miraba el texto y pasaba con el fallback muerto.
 */
export async function emitHaptic(
  pattern: HapticPattern,
  loadRich: () => RichHaptic | null = loadRichHaptic,
  loadFallback: () => FallbackHaptic | null = loadFallbackHaptic,
): Promise<void> {
  const rich = safeLoad(loadRich);
  if (rich) {
    try {
      await rich(pattern);
      // Emitió. Solo ACÁ se puede volver sin respaldo: después de saber, no antes.
      return;
    } catch {
      // El canal rico no estaba o falló → sigue el respaldo. R4.1 dice "háptica SIEMPRE en native".
    }
  }
  const fallback = safeLoad(loadFallback);
  if (!fallback) return;
  try {
    fallback(pattern);
  } catch {
    // Ni el respaldo → sin canal táctil. Degradar en silencio, nunca una excepción.
  }
}

// ─── Canal SONORO en WEB (harness) ───────────────────────────────────────────────────────
//
// Es el único canal observable por la E2E, así que además de cumplir R4.5 es EL ORÁCULO de "qué le dijo
// el producto al peón": la frecuencia del oscilador distingue 'read-ok' de 'read-error'.

/** Tonos del harness web. Espejan los assets nativos (ver scripts/gen-baston-sounds.mjs). */
const WEB_TONES: Record<SoundCue, { hz: number; ms: number }[]> = {
  'read-ok': [{ hz: 3150, ms: 110 }],
  'read-error': [
    { hz: 1300, ms: 95 },
    { hz: 850, ms: 110 },
  ],
};

function beepWebAudio(cue: SoundCue): void {
  try {
    const Ctx =
      typeof window !== 'undefined'
        ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tones = WEB_TONES[cue];
    let at = ctx.currentTime;
    let last: OscillatorNode | null = null;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = tone.hz;
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      at += tone.ms / 1000;
      osc.stop(at);
      // 45 ms de silencio entre pips (mismo gap que el asset nativo) → el doble pip se OYE doble.
      at += 0.045;
      last = osc;
    }
    if (last) {
      last.onended = () => {
        try {
          ctx.close();
        } catch {
          // ignorar cierre fallido
        }
      };
    }
  } catch {
    // Web Audio no disponible → sin sonido, no rompe el flujo (R4.5).
  }
}

// ─── Canal SONORO en NATIVE (expo-audio) ─────────────────────────────────────────────────
//
// Un reproductor POR CUE, creado una sola vez y reusado. Crear un player por bastonazo cargaría el asset
// cada vez (latencia justo en el instante que tiene que ser inmediato) y dejaría objetos nativos
// colgando en una ráfaga de manga.
//
// Los `require()` de los .wav son estáticos a propósito aunque estén dentro de una función: Metro los
// resuelve por el literal, así que los empaqueta igual, y de esta forma este módulo se sigue pudiendo
// importar desde node:test sin que Node intente leer un binario.

interface CuePlayer {
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
}

let cuePlayers: Record<SoundCue, CuePlayer> | null = null;
/** Se apagó el canal nativo (sin módulo / falló la creación) → no se reintenta por bastonazo. */
let nativeAudioUnavailable = false;

function ensureCuePlayers(): Record<SoundCue, CuePlayer> | null {
  if (nativeAudioUnavailable) return null;
  if (cuePlayers) return cuePlayers;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
    cuePlayers = {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      'read-ok': createAudioPlayer(require('../../../assets/sounds/read-ok.wav')),
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      'read-error': createAudioPlayer(require('../../../assets/sounds/read-error.wav')),
    };
    return cuePlayers;
  } catch {
    nativeAudioUnavailable = true;
    return null;
  }
}

/**
 * Reproduce un cue nativo: **rebobina y RECIÉN AHÍ toca**. Exportada y con el cargador inyectable por el
 * mismo motivo que `emitHaptic`: el invariante que protege es un ORDEN, y un orden solo se verifica
 * ejecutándolo (🟠-2 del review: los dos mutantes que rompían el orden sobrevivían los 52 tests).
 *
 * ── POR QUÉ EL ORDEN, Y POR QUÉ HAY QUE ESPERARLO (verificado en el nativo de LAS DOS plataformas) ───
 * Un player que ya terminó queda parado EN EL FINAL, y un `play()` pelado no vuelve a sonar: en
 * `expo-audio/ios/AudioPlayer.swift:38,103` el fin de reproducción sin loop deja
 * `actionAtItemEnd = .pause`. O sea que **a partir del SEGUNDO bastonazo no habría beep** — justo el caso
 * que importa en la manga, y justo el que no se ve en web ni en CI.
 * Y no alcanza con encolar el seek sin esperarlo: `play` está declarado como `Function` **síncrona**
 * (`ios/AudioModule.swift:212`, `android/.../AudioModule.kt` `Function("play")`) y `seekTo` como
 * `AsyncFunction` (`ios/AudioModule.swift:280`; en Android `runOnQueue(Queues.MAIN)`), así que un
 * `void seekTo(0); play();` ejecuta el play PRIMERO —sobre un player parado en el final, o sea mudo— y el
 * seek después. Esperar cuesta un round-trip del puente (unidades de ms contra un cue de 110 ms:
 * imperceptible).
 *
 * Si el seek falla, **igual se intenta reproducir**: "capaz suena" es mejor que "seguro no suena".
 */
export async function emitCueSound(
  cue: SoundCue,
  loadPlayer: (cue: SoundCue) => CuePlayer | null = (c) => ensureCuePlayers()?.[c] ?? null,
): Promise<void> {
  const player = safeLoad(() => loadPlayer(cue));
  if (!player) return;
  try {
    await player.seekTo(0);
  } catch {
    // Rebobinado fallido: se intenta tocar igual (puede estar en 0 ya).
  }
  try {
    player.play();
  } catch {
    // Estado transitorio del player: se pierde ESTE aviso, no el canal.
  }
}

/** ¿Ya se fijó el modo de audio de la app? (una sola vez por proceso). */
let audioModeSet = false;

/**
 * Fija el MODO DE AUDIO de la app una sola vez. No es configuración de adorno: sin llamarlo, la sesión
 * queda en el default del SO y en iOS eso es `AVAudioSessionCategorySoloAmbient`, que **interrumpe el
 * audio de las otras apps**. O sea: cada bastonazo le cortaría la radio o la música al peón. En una manga
 * donde se trabaja con la radio prendida, eso no lo arregla la preferencia de sonido — se la apagarían el
 * primer día y volveríamos al 🟡-11 por la puerta de atrás.
 *
 * Las dos decisiones, explícitas:
 *   · `interruptionMode: 'mixWithOthers'` → NO se pide foco de audio (la propia doc de expo-audio lo
 *     recomienda para *"sound effects, UI feedback, or short audio clips"*, que es exactamente esto). La
 *     radio sigue sonando y el pip se superpone.
 *   · `playsInSilentMode: true` → el aviso suena aunque el teléfono esté en silencio. Es una decisión de
 *     PRODUCTO: el peón pone el teléfono en silencio para que no lo moleste WhatsApp, no para desactivar
 *     su lector; y si el sonido le sobra, tiene el switch de «Aviso de lectura».
 *     ⚠️ **Revertirlo NO es "volver al default"**: en Android el default del módulo ya es `true`
 *     (`AudioModule.kt:63`) y con `false` el `Function("play")` hace un `return` ANTES de tocar
 *     (`AudioModule.kt:472`, `if (!shouldPlayInSilentMode())`) → el pip queda **mudo** con el timbre en
 *     silencio **o en vibración**. O sea que ponerlo en `false` no relaja nada: ACTIVA una supresión que
 *     hoy no existe, justo para quien más necesita el aviso.
 */
function ensureAudioMode(): void {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio');
    // El modo es un VALOR del módulo puro (`FEEDBACK_AUDIO_MODE`), no un literal escrito acá: así lo
    // puede ejercer un test en vez de tener que leer este archivo con un regex.
    void setAudioModeAsync({ ...FEEDBACK_AUDIO_MODE }).catch(() => undefined);
  } catch {
    // Sin el módulo no hay canal sonoro que configurar (lo cubre `ensureCuePlayers`).
  }
}

/**
 * Calienta los canales de efecto FUERA del camino caliente: fija el modo de audio y crea los
 * reproductores. Lo llama el provider al montar. Sin esto, la primera lectura de la jornada pagaría la
 * carga del .wav — justo el bastonazo del primer animal, que es el que forma la expectativa del peón.
 * Best-effort e idempotente.
 */
export function primeFeedback(): void {
  if (resolvePlatform() !== 'native') return;
  ensureAudioMode();
  ensureCuePlayers();
}

/**
 * Dispara el feedback físico de un desenlace de lectura (R4). Resuelve la plataforma en runtime y
 * aplica el plan de decideFeedback. La confirmación VISUAL (<1s, R4.4/R2.2) la hace la UI mostrando el
 * EID; este efecto cubre háptica + sonido. Best-effort: cada canal está envuelto, ninguna falla propaga
 * (R15.2 / R4.5) — el feedback NUNCA puede romper la ingesta.
 *
 * Se llama SIEMPRE que una lectura llegó a un consumidor real (aguas abajo del gate de `read-dispatch`),
 * incluso cuando el desenlace es mudo: quién decide el silencio es `decideFeedback`, no el call site.
 * Que la decisión viva en un solo lugar es lo que hace que "esto no debería sonar" sea un test y no una
 * convención.
 */
export function playFeedback(outcome: ReadOutcome, beepEnabled: boolean): void {
  const platform = resolvePlatform();
  const plan = decideFeedback(platform, beepEnabled, outcome);
  // Los dos canales nativos son async por dentro (el puente nativo) pero NO se esperan acá: el camino de
  // la lectura sigue de largo. Ninguno de los dos rechaza por construcción; el `.catch` es por si un día
  // alguien mete un `await` sin envolver — una rejection sin manejar en RN es ruido en producción.
  if (plan.haptic) void emitHaptic(plan.haptic).catch(() => undefined);
  if (plan.sound) {
    if (plan.sound.channel === 'web-audio') beepWebAudio(plan.sound.cue);
    else void emitCueSound(plan.sound.cue).catch(() => undefined);
  }
}
