// Lógica PURA del feedback (R4): decisión de canales + parseo de la preferencia de beep.
// SIN imports de RN/expo → testeable con node:test (mismo patrón que utils/establishment.ts,
// que aísla la lógica del store de plataforma). feedback.ts (efecto) y feedback-pref.ts
// (I/O) consumen/reexportan desde acá.

/** Plataforma de feedback resuelta (subconjunto relevante de Platform.OS). */
export type FeedbackPlatform = 'web' | 'native';

/** Canales de feedback que deben dispararse para una lectura confirmada. */
export interface FeedbackPlan {
  /** Vibración táctil (R4.1). Native: siempre. Web: degradada (false). */
  vibrate: boolean;
  /** Beep sonoro (R4.2). Solo si la preferencia está habilitada (R4.3). */
  beep: boolean;
  /** Canal del beep cuando corresponde: 'web-audio' en web (R4.5), 'native' en device. */
  beepChannel: 'web-audio' | 'native' | null;
}

/**
 * Decide qué canales de feedback disparar (PURO, R4.1/R4.2/R4.5). No produce efectos.
 *
 * @param platform 'web' (harness web-serial) o 'native' (device).
 * @param beepEnabled preferencia de usuario (R4.3), leída de feedback-pref.
 */
export function decideFeedback(platform: FeedbackPlatform, beepEnabled: boolean): FeedbackPlan {
  // Vibración: siempre en native (R4.1); degradada en silencio en web (R4.5).
  const vibrate = platform === 'native';
  // Beep: solo si la preferencia está ON (R4.2/R4.3). Canal según plataforma (R4.5).
  const beep = beepEnabled;
  const beepChannel = beep ? (platform === 'web' ? 'web-audio' : 'native') : null;
  return { vibrate, beep, beepChannel };
}

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
