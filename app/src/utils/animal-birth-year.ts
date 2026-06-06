// Lógica PURA del "año de nacimiento" (year-only) del alta guiada (sub-chunk B). Sin RN, sin red:
// testeable con node:test.
//
// DECISIÓN (context-alta-guiada §"Edge cases", año-de-nacimiento year-only): la base de TODAS las
// categorías es "año de nacimiento (al menos el año)". En el campo no siempre se sabe el día — el
// operario sabe "nació en 2022". Capturamos SOLO el año (4 dígitos) y lo convertimos a un `birth_date`
// completo (la columna `animals.birth_date` es `date` NOT-nullable-opcional, sin precisión de año).
//
// Convención: año AAAA → `birth_date = 'AAAA-07-01'` (1 de JULIO = MITAD del año). Por qué el medio del
// año y no 01-01: el `birth_date` alimenta el cálculo de EDAD (compute_category server-side: cortes de
// 1 y 2 años) y el override del cliente. Con 01-01 sobreestimaríamos la edad hasta ~1 año (un animal
// "de 2022" cargado se vería con casi 1 año más); con 07-01 el sesgo máximo es ~6 meses en cualquier
// dirección (el mínimo posible si solo se sabe el año). Es la mejor estimación sin el día real.
//
// Si en el futuro se quiere la FECHA EXACTA (se sabe el día), se edita desde la ficha (C3.3) — el alta
// guiada manga-friendly pide solo el año (una decisión simple por campo). El año vacío es VÁLIDO
// (opcional): sin año → birth_date null → la categoría cae al default conservador por sexo (= backend).

import type { PregnancyStatus } from './event-timeline';

export type { PregnancyStatus };

/** El año más antiguo plausible para un bovino vivo (cota inferior defensiva). Un bovino rara vez
 * supera los ~20-25 años; 1980 es holgadísimo y descarta tipeos accidentales (ej. 0202 → 202). */
export const MIN_BIRTH_YEAR = 1980;

/** Acota el input de año a SOLO 4 dígitos numéricos (en vivo, prevenir-no-errorear). */
export function sanitizeBirthYearInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4);
}

export type BirthYearValidation =
  | { ok: true; year: number | null } // null = vacío (opcional, válido)
  | { ok: false; error: string };

/**
 * Valida el año al submit. VACÍO es válido (year null → birth_date null, categoría por default). Si hay
 * texto: debe ser 4 dígitos, no futuro, y ≥ MIN_BIRTH_YEAR. `now` inyectable para tests deterministas.
 */
export function validateBirthYear(raw: string, now: Date = new Date()): BirthYearValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, year: null };
  if (!/^\d{4}$/.test(trimmed)) {
    return { ok: false, error: 'El año tiene que tener 4 dígitos (ej. 2022).' };
  }
  const year = Number(trimmed);
  const currentYear = now.getFullYear();
  if (year > currentYear) {
    return { ok: false, error: 'El año no puede ser futuro.' };
  }
  if (year < MIN_BIRTH_YEAR) {
    return { ok: false, error: `El año tiene que ser ${MIN_BIRTH_YEAR} o posterior.` };
  }
  return { ok: true, year };
}

/**
 * Convierte un año (AAAA) a un `birth_date` ISO 'AAAA-07-01' (mitad de año, mínimo sesgo de edad). null
 * (año no provisto) → null (la columna queda sin fecha; la categoría cae al default por sexo).
 *
 * Edge case (autorrevisión B): si el año es el AÑO EN CURSO y todavía no llegó el 1-julio, '07-01' sería
 * una fecha FUTURA → el server (compute_category) la trataría como edad desconocida (cae al default por
 * sexo, NO al corte de edad esperado). Para evitarlo, clampeamos al máximo entre '01-01' del año y NO
 * pasarnos de HOY: si '07-01' es futuro, usamos el 1-ENERO del año (siempre pasado para el año en curso
 * o anterior). Así un "nacido este año" cargado en junio queda < 1 año (no futuro). `now` inyectable.
 */
export function birthYearToDate(year: number | null, now: Date = new Date()): string | null {
  if (year == null) return null;
  const yyyy = String(year).padStart(4, '0');
  const midYear = `${yyyy}-07-01`;
  // ISO local de hoy (YYYY-MM-DD) para comparar como strings (orden lexicográfico = orden de fecha).
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  // Si la mitad de año cae en el futuro, caemos al 1-enero (siempre pasado para un año ≤ el actual).
  return midYear > todayIso ? `${yyyy}-01-01` : midYear;
}

/**
 * ¿El estado de preñez capturado en el alta es POSITIVO (preñada)? small=cola/medium=cuerpo/large=cabeza
 * → true (hay diagnóstico de preñez). 'empty' (Vacía) o null → false (no preñada / sin diagnóstico). Lo
 * usa el alta para (a) el override refinado (computeInitialCategoryCode con pregnant) y (b) decidir si
 * crear un evento de tacto POSITIVO post-create (los "Vacía" del alta NO crean evento — ver crear-animal).
 */
export function isPregnantStatus(status: PregnancyStatus | null | undefined): boolean {
  return status === 'small' || status === 'medium' || status === 'large';
}
