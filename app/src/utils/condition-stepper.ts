// Lógica PURA del STEPPER de CONDICIÓN CORPORAL (spec 03 M3.2a, R6.6). Sin RN, sin red, sin SDK:
// testeable con node:test (mismo patrón que maneuver-gating.ts / maneuver-sequence.ts).
//
// La condición corporal (R6.6) es un selector CERRADO 1,00–5,00 con step 0,25 (default 3,00). El stepper
// de manga (botones − / +) opera SOLO sobre estos valores discretos: este módulo encapsula el clamp al
// rango, el snap a la grilla de 0,25, el incremento/decremento, y el formato es-AR (coma decimal) — toda
// la aritmética del paso vive acá, fuera del componente (que solo dibuja). Así el paso del stepper, los
// límites (no pasar de 5,00 ni bajar de 1,00) y el redondeo a 2 decimales se testean sin montar UI.
//
// es-AR (memoria reference_es_ar_number_format): el VALOR que ve el operario lleva coma decimal (3,00).
// El número que se persiste (condition_score_events.score) es un float de máquina (punto) — eso lo arma
// el StepValue { kind:'score', score } del orquestador, no este formateo de display.

/** Cota inferior de la escala de condición corporal (R6.6). */
export const SCORE_MIN = 1;
/** Cota superior de la escala de condición corporal (R6.6). */
export const SCORE_MAX = 5;
/** Paso del stepper (R6.6: step 0,25). */
export const SCORE_STEP = 0.25;
/** Valor por defecto al entrar al paso (dirección del leader: arranca en 3,00, el centro de la escala). */
export const SCORE_DEFAULT = 3;

/**
 * Redondea un score a la grilla de 0,25 dentro de [1, 5]. Robusto ante el error de coma flotante: trabaja
 * en "cuartos" (×4) con Math.round y vuelve a dividir, así 3 + 0.25 da exactamente 3.25 (no 3.2499…). Un
 * valor fuera del rango se clampa a [1, 5]; un valor entre marcas (p. ej. 2,1, defensivo ante un dato
 * heredado) se snapea a la marca más cercana.
 */
export function snapScore(value: number): number {
  if (!Number.isFinite(value)) return SCORE_DEFAULT;
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
  // ×4 → entero de cuartos → redondeo → ÷4. Evita el drift binario de los múltiplos de 0,25.
  return Math.round(clamped / SCORE_STEP) * SCORE_STEP;
}

/**
 * Incrementa el score un paso (0,25), sin pasar de 5,00. Snapea primero (defensivo) para que el +
 * siempre caiga en una marca válida aunque el valor entrante esté fuera de grilla.
 */
export function incrementScore(value: number): number {
  return snapScore(snapScore(value) + SCORE_STEP);
}

/**
 * Decrementa el score un paso (0,25), sin bajar de 1,00. Snapea primero (defensivo).
 */
export function decrementScore(value: number): number {
  return snapScore(snapScore(value) - SCORE_STEP);
}

/** ¿Ya está en el tope (5,00)? Para deshabilitar el botón + (no hay a dónde subir). */
export function isScoreAtMax(value: number): boolean {
  return snapScore(value) >= SCORE_MAX;
}

/** ¿Ya está en el piso (1,00)? Para deshabilitar el botón − (no hay a dónde bajar). */
export function isScoreAtMin(value: number): boolean {
  return snapScore(value) <= SCORE_MIN;
}

/**
 * Formatea un score para el DISPLAY de manga, es-AR: coma decimal + SIEMPRE 2 decimales (3 → "3,00",
 * 3.25 → "3,25", 4.5 → "4,50"). Los 2 decimales fijos dan un display ESTABLE (el número hero no salta de
 * ancho al pasar de "3" a "3,25") y comunican la precisión de la escala (R6.6, step 0,25).
 */
export function formatScoreAR(value: number): string {
  return snapScore(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
