// Lockout local de login por intentos fallidos (spec 01, R1.7 / T3.5).
//
// R1.7: 5 fallos consecutivos en < 10 minutos → bloqueo de 15 minutos para ese
// email. Esto es una capa de UX LIVIANA apoyada en el rate-limiting NATIVO de
// Supabase Auth (que es la defensa real server-side, R1.7 + authErrorMessage 429).
// No re-implementamos seguridad en el cliente: solo damos feedback inmediato y
// evitamos spamear el endpoint. Lógica PURA y testeable (el reloj se inyecta).

export const MAX_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutos

/** Estado de lockout persistido por email (en SecureStore por la pantalla). */
export type LockoutState = {
  /** Timestamps (ms) de los fallos recientes, más viejo primero. */
  failures: number[];
  /** Si está bloqueado, hasta cuándo (ms epoch). null = no bloqueado. */
  lockedUntil: number | null;
};

export const EMPTY_LOCKOUT: LockoutState = { failures: [], lockedUntil: null };

/** ¿Está bloqueado AHORA? Devuelve los ms restantes (0 si no está bloqueado). */
export function remainingLockMs(state: LockoutState, now: number): number {
  if (state.lockedUntil == null) return 0;
  const left = state.lockedUntil - now;
  return left > 0 ? left : 0;
}

export function isLockedOut(state: LockoutState, now: number): boolean {
  return remainingLockMs(state, now) > 0;
}

/**
 * Registra un fallo de login. Descarta los fallos fuera de la ventana de 10 min,
 * suma el nuevo y, si se alcanzó el umbral, fija el bloqueo de 15 min. Devuelve el
 * estado nuevo (no muta el input).
 */
export function registerFailure(state: LockoutState, now: number): LockoutState {
  // Si ya estaba bloqueado y el bloqueo sigue vigente, no acumulamos más.
  if (isLockedOut(state, now)) return state;

  const recent = state.failures.filter((t) => now - t < ATTEMPT_WINDOW_MS);
  recent.push(now);

  if (recent.length >= MAX_ATTEMPTS) {
    return { failures: [], lockedUntil: now + LOCKOUT_MS };
  }
  return { failures: recent, lockedUntil: null };
}

/** Login exitoso: limpia todo el rastro de fallos. */
export function resetLockout(): LockoutState {
  return { failures: [], lockedUntil: null };
}

/**
 * Normaliza un estado al "ahora": si el bloqueo ya expiró, lo levanta y descarta
 * los fallos viejos. Útil al rehidratar el estado persistido al montar la pantalla.
 */
export function normalizeLockout(state: LockoutState, now: number): LockoutState {
  const lockedUntil = state.lockedUntil != null && state.lockedUntil > now ? state.lockedUntil : null;
  const failures = lockedUntil != null ? state.failures : state.failures.filter((t) => now - t < ATTEMPT_WINDOW_MS);
  return { failures, lockedUntil };
}

/** Formatea los ms restantes a un copy de UX en voseo ("15 minutos", "1 minuto"). */
export function formatLockMinutes(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}
