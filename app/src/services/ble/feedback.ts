// Feedback sensorial de lectura exitosa del bastón (R4). Redundancia para la manga
// (context decisión 3): vibración (se siente con guantes/barro) + beep (se oye al sol/ruido)
// + confirmación visual (R2.4, la maneja la UI).
//
// Reglas (R4.1, R4.2, R4.5):
//   - Vibración SIEMPRE en native (no apagable, R4.1). En web se degrada en silencio (la
//     vibración de desktop es pobre, R4.5).
//   - Beep solo si la preferencia está habilitada (R4.2/R4.3). En web: Web Audio (R4.5);
//     en native: vía el mismo canal háptico/sonido (placeholder hasta device — ver nota).
//
// Diseño para testabilidad: la DECISIÓN de qué canales disparar (decideFeedback) es PURA
// (vive en feedback-logic.ts, sin RN/Web Audio) → node:test la verifica con beep ON/OFF y
// por plataforma. El EFECTO físico (playFeedback) hace la I/O guardada por plataforma y NO
// se testea en CI (necesita device / browser). Así R4.1/R4.2/R4.5 se cubren por la decisión.

import { decideFeedback } from './feedback-logic';
import type { FeedbackPlatform } from './feedback-logic';

export { decideFeedback } from './feedback-logic';
export type { FeedbackPlatform, FeedbackPlan } from './feedback-logic';

// ─── Efecto físico (I/O guardada; no testeado en CI) ────────────────────────────────────
//
// Importes perezosos de RN/Web Audio dentro de las funciones de efecto para que este módulo
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

function vibrateNative(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Vibration } = require('react-native') as typeof import('react-native');
    Vibration.vibrate(50);
  } catch {
    // Vibración no disponible → degradar en silencio (R4.5 generaliza: nunca rompe el flujo).
  }
}

function beepWebAudio(): void {
  try {
    const Ctx =
      typeof window !== 'undefined'
        ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => {
      try {
        ctx.close();
      } catch {
        // ignorar cierre fallido
      }
    };
  } catch {
    // Web Audio no disponible → sin beep, no rompe el flujo (R4.5).
  }
}

/**
 * Dispara el feedback físico de una lectura confirmada (R4). Resuelve la plataforma en
 * runtime y aplica el plan de decideFeedback. La confirmación VISUAL (<1s, R4.4/R2.2) la
 * hace la UI mostrando el EID; este efecto cubre vibración + beep. Best-effort: cada canal
 * está envuelto, ninguna falla propaga (R15.2).
 *
 * El beep native es un placeholder hasta el device (no hay módulo de sonido en deps; la
 * vibración cubre la redundancia táctil obligatoria). En web el beep es real (Web Audio).
 */
export function playFeedback(beepEnabled: boolean): void {
  const platform = resolvePlatform();
  const plan = decideFeedback(platform, beepEnabled);
  if (plan.vibrate) vibrateNative();
  if (plan.beep && plan.beepChannel === 'web-audio') beepWebAudio();
  // plan.beepChannel === 'native': sin canal de sonido nativo en deps; la vibración (R4.1)
  // cubre la redundancia. Se enchufa expo-haptics/sonido cuando se sume al dev build.
}
