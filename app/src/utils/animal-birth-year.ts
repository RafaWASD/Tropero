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

// ─── Fecha de nacimiento DÍA/MES opcional separada del año (delta alta-form-refinamiento, RAF2.1) ──────
//
// El campo Año (arriba) se mantiene intacto (year-only → midpoint). ACÁ se agrega un campo OPCIONAL de
// día/mes (DD/MM, día-primero es-AR): con DD/MM válidos la fecha es EXACTA; con solo año cae al midpoint
// (birthYearToDate, intacto). Todo es lógica PURA client-side (offline, testeable con node:test).

/**
 * Sanitiza el input de día/mes EN VIVO (prevenir-no-errorear, RAF2.1.11): solo dígitos, día-primero, con
 * "/" automático tras 2 dígitos, tope DD/MM (4 dígitos). "1502" → "15/02"; "3/" → "3"; "abc" → ""; idempotente.
 */
export function sanitizeDayMonthInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4); // DDMM, máximo 4 dígitos
  if (digits.length <= 2) return digits; // "", "3", "15" — todavía sin mes
  return `${digits.slice(0, 2)}/${digits.slice(2)}`; // "1502" → "15/02"; "150" → "15/0"
}

export type BirthDateValidation =
  | { ok: true; date: string } // ISO 'AAAA-MM-DD' (exacta si hay DD/MM; midpoint si solo año)
  | { ok: true; date: null } // todo vacío (año y DD/MM): birth_date null (opcional, válido)
  | { ok: false; error: string; field: 'year' | 'dayMonth' };

/** Año bisiesto (regla gregoriana estándar): divisible por 4, salvo los seculares no divisibles por 400. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Días del mes (1–12) para un año dado; febrero = 29 en bisiesto, 28 si no. */
function daysInMonth(month: number, year: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [1, 3, 5, 7, 8, 10, 12].includes(month) ? 31 : 30;
}

/** ISO local 'AAAA-MM-DD' de `now` para comparar fechas como strings (orden lexicográfico = orden de fecha). */
function todayIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Valida la fecha de nacimiento COMPLETA al submit (RAF2.1.3–2.1.10). `yearRaw`/`dayMonthRaw` son los strings
 * crudos del form (ya sanitizados en vivo). `now` inyectable (tests deterministas). Reglas:
 *   - año vacío + DD/MM vacío → { ok:true, date:null } (opcional).
 *   - año válido + DD/MM vacío → { ok:true, date: birthYearToDate(year, now) } (midpoint, RAF2.1.3).
 *   - año vacío + DD/MM presente → { ok:false, field:'dayMonth' } (no hay fecha sin año, RAF2.1.5).
 *   - DD/MM incompleto (solo día) → { ok:false, field:'dayMonth' } (todo-o-nada, RAF2.1.6).
 *   - mes ∉ 1..12 / día ∉ 1..daysInMonth / 00 / 31-en-mes-de-30 / 29-02 no bisiesto → { ok:false } (sin clamp, 2.1.7/2.1.8).
 *   - fecha exacta futura → { ok:false, field:'dayMonth' } (RAF2.1.9, criterio propio).
 *   - año válido + DD/MM válido y no-futuro → { ok:true, date: 'AAAA-MM-DD' } (RAF2.1.4).
 * Reusa `validateBirthYear` (eje año: 4 díg / no futuro / ≥ MIN_BIRTH_YEAR) y `birthYearToDate` (midpoint, intacto).
 */
export function validateBirthDate(
  yearRaw: string,
  dayMonthRaw: string,
  now: Date = new Date(),
): BirthDateValidation {
  // Eje AÑO (reusa la util existente, sin duplicar): formato / no futuro / cota inferior.
  const yearV = validateBirthYear(yearRaw, now);
  if (!yearV.ok) return { ok: false, error: yearV.error, field: 'year' };

  const dm = dayMonthRaw.trim();
  if (dm.length === 0) {
    // Sin día/mes: año-solo → midpoint; ambos vacíos → null (ambos delegan en birthYearToDate, intacto).
    return { ok: true, date: birthYearToDate(yearV.year, now) };
  }

  // Hay día/mes → REQUIERE año (no hay fecha exacta sin año), RAF2.1.5.
  if (yearV.year == null) {
    return { ok: false, error: 'Cargá el año para poder usar el día y mes.', field: 'dayMonth' };
  }

  // Todo-o-nada (RAF2.1.6): la fecha exacta necesita día Y mes. El sanitizer inserta "/" recién al 3er
  // dígito → sin "/" sólo hay día (incompleto). Con "/" siempre hay 2 díg de día + ≥1 díg de mes.
  const parts = dm.split('/');
  const dayStr = parts[0] ?? '';
  const monthStr = parts[1] ?? '';
  if (dayStr.length === 0 || monthStr.length === 0) {
    return { ok: false, error: 'Completá el día y el mes (DD/MM).', field: 'dayMonth' };
  }

  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = yearV.year;
  // Rango (sin clamp silencioso, RAF2.1.7/2.1.8): mes 1..12, día 1..díasDelMes (febrero respeta bisiesto).
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
    return { ok: false, error: 'El día y mes no son válidos (revisá DD/MM).', field: 'dayMonth' };
  }

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Fecha exacta futura (RAF2.1.9): el año ya pasó el filtro de "no futuro", pero el día/mes en el año en
  // curso puede caer adelante de hoy → lo rechaza el eje día/mes (sin clamp).
  if (iso > todayIso(now)) {
    return { ok: false, error: 'La fecha de nacimiento no puede ser futura.', field: 'dayMonth' };
  }

  return { ok: true, date: iso };
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
