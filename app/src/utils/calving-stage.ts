// Lógica PURA del mapeo NACIMIENTO → ETAPA (cabeza/cuerpo/cola) por MES de concepción (spec 07 Stream C —
// R7.8, design §2.5). Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que
// service-months.ts / pregnancy-buckets.ts).
//
// Es el ESPEJO CLIENTE de la asignación mes→tercio que la RPC `rodeo_calving_by_stage` implementa
// server-side (design §2.5, nota de consistencia §8). La RPC devuelve los conteos crudos head/body/tail; este
// helper se usa en la UI para ETIQUETAR un nacimiento individual con su etapa derivada del mes de concepción
// (mes de parto − 9, Gate 0 §5).
//
// FUENTE ÚNICA del *nº* de buckets = `pregnancy-buckets.ts` (`sizeBucketsForServiceMonths`): 1/12/0/null → sin
// distinción; 2 → cabeza/cola; 3..11 → tercios. Este helper agrega la parte NUEVA (no en pregnancy-buckets):
// QUÉ mes cae en QUÉ tercio. Cuando Facundo cierre el bucketing 4-11 (Gate 0 §9), se ajustan AMBOS lugares:
// este helper + la RPC (deuda de consistencia anotada en tasks T2.4).
//
// SEMÁNTICA (espejo de pregnancy-buckets §4): CABEZA = preñez que concibió MÁS TEMPRANO en la ventana de
// servicio (al tacto es la más AVANZADA → `large`); COLA = la que concibió MÁS TARDE (al tacto la más reciente
// → `small`). Por eso el primer tercio del servicio (en ORDEN DE SERVICIO, con wrap) = cabeza.

import { MONTHS_IN_YEAR, serviceRunBounds } from './service-months';

/** Etapa de un nacimiento dentro de la campaña. `null` = el rodeo no tiene distinción de etapas. */
export type CalvingStage = 'head' | 'body' | 'tail' | null;

/** Nº mínimo de meses para distinguir CABEZA/COLA (2). Para tercios (cuerpo) se necesitan ≥3. */
const TWO_MONTHS = 2;

/**
 * Normaliza el mes de PARTO (1–12) a su mes de CONCEPCIÓN (mes de parto − 9, wrap 1–12) — Gate 0 §5.
 * Espejo EXACTO de la derivación server-side `extract(month from (birth.event_date - interval '9 months'))`.
 * Ej.: parto en Marzo (3) → concepción Junio (6); parto Octubre (10) → Enero (1); parto Agosto (8) → Nov (11).
 * Fuera de rango → `null` (defensivo; la UI no debería mandarlo).
 */
export function conceptionMonthFromBirthMonth(birthMonth: number): number | null {
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > MONTHS_IN_YEAR) return null;
  // (birthMonth - 9) normalizado a 1..12 con wrap. -9 ≡ +3 (mod 12).
  return ((birthMonth - 9 - 1) % MONTHS_IN_YEAR + MONTHS_IN_YEAR) % MONTHS_IN_YEAR + 1;
}

/**
 * Posición (0-indexada) de un mes dentro del run de servicio EN ORDEN DE SERVICIO (con wrap), tomando el
 * inicio del run de `serviceRunBounds`. Para un run contiguo de N meses las posiciones son 0..N-1.
 * Devuelve `null` si el mes no pertenece al run o el run no está definido.
 */
function serviceOrderPosition(serviceMonths: number[], start: number, month: number): number | null {
  if (!serviceMonths.includes(month)) return null;
  return ((month - start) % MONTHS_IN_YEAR + MONTHS_IN_YEAR) % MONTHS_IN_YEAR;
}

/**
 * Bucketing por TERCIOS sobre la POSICIÓN de servicio (0-indexada) y el total `n` de meses (la MISMA regla
 * que la RPC `rodeo_calving_by_stage`):
 *   - n === 2 → pos 0 = cabeza, pos 1 = cola (sin cuerpo).
 *   - n >= 3 → tercios enteros: [0, ⌊n/3⌋) cabeza, [⌊n/3⌋, ⌊2n/3⌋) cuerpo, [⌊2n/3⌋, n) cola.
 * (n < 2 o n >= 12 no llega acá — se filtra antes con `sizeBucketsForServiceMonths`.)
 */
function stageForPosition(position: number, n: number): CalvingStage {
  if (n === TWO_MONTHS) return position === 0 ? 'head' : 'tail';
  const headEnd = Math.floor(n / 3);
  const bodyEnd = Math.floor((2 * n) / 3);
  if (position < headEnd) return 'head';
  if (position < bodyEnd) return 'body';
  return 'tail';
}

/**
 * Etapa (cabeza/cuerpo/cola) de un nacimiento dado el `service_months` del rodeo (ordenado o no) y el MES DE
 * PARTO. Devuelve `null` si el rodeo no tiene distinción de etapas (1/12/0/null/disjunto-sin-run) o si el mes
 * de concepción derivado no cae en la ventana de servicio.
 *
 * Pasos: (1) mes de concepción = parto − 9; (2) ¿el rodeo distingue etapas? (2/3..11 meses, run definido);
 * (3) posición de servicio del mes de concepción → tercio.
 */
export function calvingStageForBirth(serviceMonths: number[] | null, birthMonth: number): CalvingStage {
  if (serviceMonths === null) return null;
  const n = serviceMonths.length;
  // Sin distinción de etapas: 0/1 mes o 12 (continuo) — espejo de sizeBucketsForServiceMonths.
  if (n < TWO_MONTHS || n >= MONTHS_IN_YEAR) return null;

  const conception = conceptionMonthFromBirthMonth(birthMonth);
  if (conception === null) return null;

  const bounds = serviceRunBounds(serviceMonths);
  if (bounds === null) return null; // set sin run definido (disjunto histórico) → sin etapa

  const position = serviceOrderPosition(serviceMonths, bounds.start, conception);
  if (position === null) return null; // concebido fuera de la ventana de servicio
  // Defensivo: una posición fuera de 0..n-1 (set disjunto) → sin etapa.
  if (position >= n) return null;

  return stageForPosition(position, n); // n === 2 → cabeza/cola; n >= 3 → tercios
}
