// Lógica PURA del feedback (R4): clasificación del desenlace de una lectura + decisión de canales +
// parseo de la preferencia de beep. SIN imports de RN/expo → testeable con node:test (mismo patrón que
// utils/establishment.ts, que aísla la lógica del store de plataforma). feedback.ts (efecto) y
// feedback-pref.ts (I/O) consumen/reexportan desde acá.
//
// ── EL VOCABULARIO SENSORIAL (2026-08-06, 🟡-11 y 🟡-12 del barrido de edge cases) ────────────────────
// Antes, TODO lo que le podía pasar a una lectura producía el MISMO evento para el peón: "entró" era una
// vibración de 50 ms, y "trama corrupta", "re-lectura dentro de los 3 s", "bastón mudo" y "no apretaste
// bien el gatillo" eran EXACTAMENTE el mismo silencio. Con eso el peón no puede aprender del producto:
// no hay diferencia observable entre "el aparato te entendió", "el aparato te escuchó y no sirvió" y "el
// aparato no se enteró".
//
// El vocabulario ahora tiene DOS palabras, y una sola de ellas es nueva:
//   accepted  → háptica 'success' + un pip AGUDO y corto. "Entró."
//   rejected  → háptica 'error'   + dos pips GRAVES y descendentes. "Te escuché y no servía."
//   duplicate → SILENCIO, a propósito (ver abajo).
//
// ── POR QUÉ `duplicate` SIGUE EN SILENCIO (y no es un olvido) ────────────────────────────────────────
// Una re-lectura dentro de la ventana de dedup (R3.1) NO es un fracaso: significa que ese animal YA se
// capturó, hace menos de 3 segundos, y que en ese momento el producto ya confirmó. Darle el aviso
// NEGATIVO sería mentir en la otra dirección (decirle "no sirvió" sobre un animal que sí está), y darle
// otra vez el POSITIVO sería confirmar dos veces una sola captura — que es la clase de confirmación
// falsa que 🔴-2 vino a cerrar. Un tercer sonido propio ("ya lo tenés") tampoco: no hay evidencia de que
// tres patrones se distingan con guante y ruido, y el contexto ya lo desambigua (la pantalla está
// mostrando ese animal desde hace un segundo).
//
// ── POR QUÉ "BASTÓN MUDO" Y "NO APRETASTE EL GATILLO" TAMPOCO TIENEN SEÑAL ACÁ ───────────────────────
// Porque no hay evento: al teléfono no le llega NADA. Señalar una ausencia obligaría a un temporizador
// que dispare "no leíste" cada N segundos, y eso alarmaría sin parar al peón que camina, abre un portón
// o carga un peso — un aviso que suena cuando no pasa nada es ruido, y el ruido se aprende a ignorar.
// Ese hueco NO es del feedback de lectura: es del indicador de conexión (el pill / el hero de cada
// pantalla), que es el que sabe si el bastón está vivo. Ver §2 del barrido.

/** Plataforma de feedback resuelta (subconjunto relevante de Platform.OS). */
export type FeedbackPlatform = 'web' | 'native';

/**
 * Qué le pasó a una lectura que YA pasó el gate de consumidor (`read-dispatch`). Es el eje del
 * vocabulario sensorial: cada desenlace tiene —o no tiene— su propia señal.
 */
export type ReadOutcome = 'accepted' | 'rejected' | 'duplicate';

/**
 * Patrón háptico. No son "intensidades": son los dos patrones que el SISTEMA OPERATIVO ya define como
 * "salió bien" / "salió mal" (`Haptics.NotificationFeedbackType`), así que el peón los reconoce del
 * resto del teléfono sin que nadie se los enseñe.
 */
export type HapticPattern = 'success' | 'error';

/** Qué asset/tono suena. Las dos claves mapean 1:1 a `app/assets/sounds/<cue>.wav`. */
export type SoundCue = 'read-ok' | 'read-error';

/** Canal por el que sale el sonido: Web Audio en el harness web (R4.5), el asset nativo en device. */
export type SoundChannel = 'web-audio' | 'native';

/** Canales de feedback que deben dispararse para un desenlace de lectura. */
export interface FeedbackPlan {
  /**
   * Patrón háptico a emitir (R4.1), o null si no corresponde canal táctil. Native: siempre que haya
   * algo que decir. Web: null (la vibración de desktop es pobre/nula, R4.5).
   */
  haptic: HapticPattern | null;
  /** Qué suena y por dónde (R4.2/R4.5), o null si el desenlace es mudo o el sonido está apagado (R4.3). */
  sound: { cue: SoundCue; channel: SoundChannel } | null;
}

/** El desenlace que le corresponde a cada forma de candidato del motor de ingesta (`EidIngestEngine`). */
export function classifyReadOutcome(
  candidate: { eid: string } | { rejected: string } | null,
): ReadOutcome {
  // null = el motor lo comió por la ventana de dedup (R3.1): el animal ya entró hace <3 s.
  if (candidate === null) return 'duplicate';
  // 'rejected' = llegó una trama y el contrato no pudo sacarle un EID válido (R1.4).
  if ('rejected' in candidate) return 'rejected';
  return 'accepted';
}

/**
 * Decide qué canales de feedback disparar (PURO, R4.1/R4.2/R4.5/R4.8). No produce efectos.
 *
 * @param platform 'web' (harness web-serial) o 'native' (device).
 * @param beepEnabled preferencia de usuario (R4.3), leída de feedback-pref.
 * @param outcome qué le pasó a la lectura (`classifyReadOutcome`).
 *
 * `outcome` es OBLIGATORIO a propósito (mismo criterio que `hasTransport` en connection-view): un call
 * site nuevo tiene que DECIDIR qué está señalando, no heredar un default optimista que confirme.
 */
export function decideFeedback(
  platform: FeedbackPlatform,
  beepEnabled: boolean,
  outcome: ReadOutcome,
): FeedbackPlan {
  // El desenlace mudo corta primero y para las dos plataformas: no hay canal que valga la pena abrir.
  if (outcome === 'duplicate') return { haptic: null, sound: null };

  const pattern: HapticPattern = outcome === 'rejected' ? 'error' : 'success';
  const cue: SoundCue = outcome === 'rejected' ? 'read-error' : 'read-ok';

  // Táctil: SIEMPRE en native y NO apagable (R4.1) — se percibe con guante y con el teléfono guardado.
  // En web se degrada en silencio (R4.5).
  const haptic = platform === 'native' ? pattern : null;
  // Sonido: solo con la preferencia ON (R4.2/R4.3). La preferencia apaga TODO el canal sonoro, no solo
  // el pip de éxito: el motivo por el que se apaga (ruido, una reunión, molesta) no distingue desenlaces,
  // y la señal negativa sigue existiendo por el canal táctil, que nunca se apaga.
  const sound = beepEnabled
    ? { cue, channel: (platform === 'web' ? 'web-audio' : 'native') as SoundChannel }
    : null;

  return { haptic, sound };
}

/**
 * El patrón de `Vibration` del canal de RESPALDO (R4.1/R4.8). PURO y acá —y no inline en `feedback.ts`—
 * porque es el único canal táctil que existe en un APK **sin** el módulo nativo de `expo-haptics`, o sea
 * en el parque instalado hoy.
 *
 * ── LO QUE PROTEGE (🟠-B de la re-review, 2026-08-06) ────────────────────────────────────────────────
 * Inline, colapsar los dos desenlaces a un solo buzz (`Vibration.vibrate(50)` para los dos) dejaba la
 * suite en **67/67 verde**. El test que sonaba a cubrirlo le inyecta un doble, así que prueba la
 * ORQUESTACIÓN y no puede decir nada del respaldo real. Y pega justo donde más duele: sin el módulo
 * nativo el respaldo es el ÚNICO canal táctil, y con el sonido apagado —que el switch permite y R4.1
 * bendice— "entró" y "no servía" volverían a ser indistinguibles. Sería 🟡-12 restaurado exactamente en
 * los equipos donde el respaldo existe para que R4.8 sobreviva.
 *
 * Como valor puro, que los dos patrones DIFIERAN se verifica ejecutándolo.
 *
 * `success` = un pulso corto. `error` = tres pulsos con pausa: más largo y con ritmo, que son las dos
 * dimensiones que se distinguen con guante (`Vibration` no controla amplitud).
 */
export function fallbackVibrationPattern(pattern: HapticPattern): number | number[] {
  return pattern === 'error' ? [0, 55, 70, 55, 70, 55] : 50;
}

/**
 * El MODO DE AUDIO de la app. Vive acá —en el módulo puro y como VALOR— para que un test lo pueda
 * ejercer: sus dos claves críticas son decisiones de campo, no configuración, y un cambio silencioso en
 * cualquiera de las dos es un defecto que solo se descubre en la manga.
 *
 *   · `interruptionMode: 'mixWithOthers'` → NO se pide foco de audio. Sin esto, en iOS la sesión queda
 *     en el default del SO (`soloAmbient`) y **cada bastonazo le corta la radio al peón**; en Android,
 *     pedir foco haría lo mismo. La doc de expo-audio recomienda este modo justamente para "sound
 *     effects, UI feedback, or short audio clips".
 *   · `playsInSilentMode: true` → el aviso suena con el teléfono en silencio. Decisión de producto: el
 *     peón silencia el teléfono por WhatsApp, no para desactivar su lector, y si le sobra tiene el
 *     switch de «Aviso de lectura».
 *     ⚠️ **REVERTIRLO NO ES "VOLVER AL DEFAULT", ES ACTIVAR UNA SUPRESIÓN.** Verificado en el nativo:
 *     `expo-audio/android/.../AudioModule.kt:472` — dentro de `Function("play")` hay un
 *     `if (!shouldPlayInSilentMode()) { return@Function }`, o sea un **`return` antes de tocar**, no un
 *     manejo de foco; y `AudioModule.kt:63` muestra que el default del módulo **ya es `true`**. Con
 *     `false`, el pip **no suena** con el timbre en silencio **ni en vibración** — que es como trabaja
 *     medio campo. Sigue siendo decisión de Raf; lo que cambia es que se toma sabiendo el costo.
 */
export const FEEDBACK_AUDIO_MODE = {
  playsInSilentMode: true,
  interruptionMode: 'mixWithOthers',
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
} as const;

/**
 * Default del beep: ENCENDIDO (R4.2 lo habilita por defecto; R4.3 permite apagarlo). La
 * primera sesión, sin valor persistido, tiene beep ON.
 */
export const BEEP_DEFAULT_ENABLED = true;

/**
 * Interpreta el valor crudo del storage al flag booleano (PURO). null/ausente/ilegible →
 * default ON. Acepta solo el contrato '1'/'0' que escribimos; cualquier otra cosa → default
 * (defensivo ante un storage corrupto, no rompe la lectura).
 */
export function parseBeepPref(raw: string | null): boolean {
  if (raw === '0') return false;
  if (raw === '1') return true;
  return BEEP_DEFAULT_ENABLED;
}

/** Serializa el flag al formato del storage. */
export function serializeBeepPref(enabled: boolean): string {
  return enabled ? '1' : '0';
}
