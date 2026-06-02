// Lógica PURA de los inputs de carga de evento (spec 02 C3.1). Sin RN, sin red: testeable con
// node:test (mismo patrón que animal-input.ts / animal-form.ts).
//
// Filosofía: PREVENIR, no errorear (memoria de input pro). El peso reusa sanitizeWeightInput +
// parseWeight (ya existen); la fecha reusa maskDateInput (ya existe). Acá agregamos:
//   - la lista cerrada de los 17 scores válidos de condición corporal (1.00→5.00, paso 0.25),
//   - la validación de submit del peso (numérico > 0, parte entera ≤ 4 cifras / < 10000; dominio bovino),
//   - el tope de largo + validación (no vacío) del texto de observación.
// NO duplicamos sanitizeWeightInput / maskDateInput / parseWeight (viven en animal-input/animal-form).

// NOTA: NO importamos parseWeight de animal-form como valor a propósito. Los utils PUROS de la
// suite de tests (node:test) son self-contained — ninguno hace value-import de un sibling (solo
// `import type`), porque el runner los carga sin bundler y la resolución de extensiones difiere de
// Metro. `parseNumberArAr` de abajo es el mismo parser de coma-decimal que parseWeight (3 líneas):
// no es el SANITIZER de input (ese sí vive una sola vez en animal-input.ts y NO lo duplicamos), es
// el parser de submit. La intención de "no dupliques" del brief apunta a sanitizeWeightInput /
// maskDateInput (el sanitizado en vivo), que el campo del form reusa de animal-input.ts.

// ─── Condición corporal: 17 valores cerrados (R6.4, CHECK del server 0028) ────────────────
// 1.00, 1.25, 1.50, ..., 5.00 — paso 0.25. El selector es CERRADO (nunca texto libre) → el valor
// elegido SIEMPRE cumple el CHECK del DB. Generamos la lista para no tipear 17 literales a mano.

export const CONDITION_SCORE_MIN = 1;
export const CONDITION_SCORE_MAX = 5;
export const CONDITION_SCORE_STEP = 0.25;

/** Los 17 scores válidos como números (1.00 → 5.00, paso 0.25). */
export const CONDITION_SCORES: readonly number[] = (() => {
  const out: number[] = [];
  // Iteramos en cuartos enteros para evitar acumular error de punto flotante.
  const minQuarters = CONDITION_SCORE_MIN / CONDITION_SCORE_STEP; // 4
  const maxQuarters = CONDITION_SCORE_MAX / CONDITION_SCORE_STEP; // 20
  for (let q = minQuarters; q <= maxQuarters; q++) {
    out.push(q * CONDITION_SCORE_STEP);
  }
  return out;
})();

/** ¿Es `n` uno de los 17 scores válidos? (defensa: el selector cerrado ya lo garantiza). */
export function isValidConditionScore(n: number): boolean {
  return CONDITION_SCORES.some((s) => Math.abs(s - n) < 1e-9);
}

/** Formatea un score para mostrar en es-AR: "3.00" → "3", "3.25" → "3,25" (coma decimal). */
export function formatConditionScore(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0$/, '').replace('.', ',');
}

// ─── Peso: validación de submit (dominio bovino: > 0, parte entera ≤ 4 cifras) ────────────
// El bovino más pesado registrado pesó 1.740 kg; ninguno llegó a 5 cifras (10.000 kg). El cap de
// dominio es 4 cifras ENTERAS → el valor debe ser < 10000 (los decimales siguen permitidos, ej.
// 9999,99). Es MÁS estricto que el CHECK del server (numeric(7,2) > 0 = ≤ 99999.99): este backstop
// caza cualquier 5+ cifras que se escape del sanitizer (paste raro, edición). El sanitizeWeightInput
// (animal-input.ts) ya acota la parte entera a 4 dígitos EN VIVO; acá lo re-validamos al submit.

/** Tope EXCLUSIVO: el peso debe ser estrictamente menor a esto (parte entera ≤ 4 cifras). */
export const WEIGHT_KG_LIMIT = 10000;

export type WeightValidation = { ok: true; value: number } | { ok: false; error: string };

/** Parsea un decimal aceptando coma es-AR ("320,5" → 320.5). null si no es número. */
function parseNumberArAr(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Valida el peso al submit. `raw` es el string del campo (ya sanitizado en vivo). Requerido
 * (un evento de peso sin peso no tiene sentido): vacío → error. Acepta coma decimal (es-AR).
 */
export function validateWeight(raw: string): WeightValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Ingresá el peso en kilos.' };
  }
  const n = parseNumberArAr(trimmed);
  if (n === null || n <= 0) {
    return { ok: false, error: 'El peso tiene que ser un número mayor a 0.' };
  }
  if (n >= WEIGHT_KG_LIMIT) {
    return { ok: false, error: 'El peso no puede tener más de 4 cifras.' };
  }
  return { ok: true, value: n };
}

// ─── Fecha del evento: validación de submit (formato + no-futura razonable) ───────────────
// El campo usa maskDateInput EN VIVO (animal-input.ts), así que solo puede contener AAAA-MM-DD
// parcial/completo. Validamos al submit: formato completo + no-futura (avisamos, no es absurda).

export type EventDateValidation =
  | { ok: true; value: string } // ISO 'YYYY-MM-DD'
  | { ok: false; error: string };

/** Parsea 'YYYY-MM-DD' a Date UTC midnight, validando rango. null si formato/valor inválido. */
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Valida la fecha del evento (peso / condición). REQUERIDA (todo evento tiene una fecha): vacío →
 * error. Formato completo AAAA-MM-DD. No futura (no podés cargar un pesaje de mañana). `today`
 * inyectable para tests deterministas.
 */
export function validateEventDate(raw: string, today: Date = new Date()): EventDateValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Ingresá la fecha del evento.' };
  }
  const d = parseIsoDate(trimmed);
  if (!d) {
    return { ok: false, error: 'Fecha inválida (usá AAAA-MM-DD).' };
  }
  if (d.getTime() > startOfUtcDay(today).getTime()) {
    return { ok: false, error: 'La fecha no puede ser futura.' };
  }
  return { ok: true, value: trimmed };
}

// ─── Observación libre: tope de largo + validación (no vacío) ─────────────────────────────

export const OBSERVATION_MAX_LENGTH = 1000;

/** Acota el texto de la observación al tope (no filtra caracteres: es texto libre). */
export function sanitizeObservationInput(raw: string): string {
  return raw.slice(0, OBSERVATION_MAX_LENGTH);
}

export type ObservationValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Valida la observación al submit: no vacía (trim) y dentro del tope. */
export function validateObservation(raw: string): ObservationValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Escribí la observación.' };
  }
  if (trimmed.length > OBSERVATION_MAX_LENGTH) {
    return { ok: false, error: `La observación es muy larga (máx ${OBSERVATION_MAX_LENGTH} caracteres).` };
  }
  return { ok: true, value: trimmed };
}
