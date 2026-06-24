// Lógica PURA de la regla de BUCKETS CCL del tacto de preñez (spec 03 Stream B / B2 — DD-PSC-3).
// Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que service-months.ts /
// maneuver-gating.ts). Es la FUENTE ÚNICA de la regla del Gate 0 §4 (RPSC.4.5/RPSC.5.8): decide, a
// partir del nº de meses de servicio del rodeo, qué botones de TAMAÑO de preñez mostrar (cabeza/cuerpo/
// cola → large/medium/small) y si por default conviene medir tamaño. La consumen DOS lugares:
//   1. el DEFAULT de "¿medir tamaño?" del config de tanda (RPSC.4.2) — `defaultMeasureSize`.
//   2. el Nº DE BOTONES de tamaño de `TactoStep` (RPSC.5.8) — `sizeBucketsForServiceMonths`.
// Una sola fuente evita el drift cuando Facundo afine el bucketing ([TENTATIVO] Gate 0 §9): el cambio
// se hace en un solo lugar.
//
// Regla del Gate 0 §4 (nº de meses de servicio → buckets de tamaño):
//   - 0 (sin configurar / vacío) → []                    (ventana desconocida → sin tamaño)
//   - 1  → []                                            (todas la misma edad → preñada/vacía, sin tamaño)
//   - 2  → [Cabeza, Cola]                                (sin "Cuerpo")
//   - 3  → [Cabeza, Cuerpo, Cola]                        (tercios exactos)
//   - 4..11 → [Cabeza, Cuerpo, Cola]                     (tercios) [TENTATIVO — espera a Facundo §9]
//   - 12 → []                                            (servicio continuo → preñada/vacía, sin CCL) [TENTATIVO]
//   - NULL → 0 → []                                      (sin configurar)
//
// El enum `pregnancy_status` (small/medium/large) NO cambia: cada bucket mapea 1:1 a un status
// (Cabeza→large, Cuerpo→medium, Cola→small — RPSC.5.6, espejo de event-timeline.PREGNANCY_LABELS:
// small=Cola, medium=Cuerpo, large=Cabeza). El caso `[]` lo resuelve `TactoStep` con la convención de
// DD-PSC-2 (preñada sin tamaño → persiste 'large', sin sub-paso de tamaño).

import type { PregnancyStatus } from './maneuver-sequence';

/** Un bucket de tamaño = un botón de `TactoStep`. `label` es-AR + el `pregnancy_status` que persiste (1:1, §4). */
export type SizeBucket = {
  label: 'Cabeza' | 'Cuerpo' | 'Cola';
  status: Extract<PregnancyStatus, 'large' | 'medium' | 'small'>;
};

/** Bucket "Cabeza" — preñez más temprana/avanzada (cabeza del feto palpable). Persiste `large`. */
const HEAD: SizeBucket = { label: 'Cabeza', status: 'large' };
/** Bucket "Cuerpo" — preñez intermedia. Persiste `medium`. */
const BODY: SizeBucket = { label: 'Cuerpo', status: 'medium' };
/** Bucket "Cola" — preñez más reciente (cola/cuernos). Persiste `small`. */
const TAIL: SizeBucket = { label: 'Cola', status: 'small' };

const ONE_MONTH = 1;
const FULL_YEAR = 12;
const TWO_MONTHS = 2;

/**
 * Buckets de tamaño para un rodeo con `nMonths` meses de servicio (regla del Gate 0 §4, FUENTE ÚNICA).
 * `nMonths` se deriva de `array_length(service_months)` (lo computa el caller; este util no parsea).
 *   - `null` / 0 / 1 / 12  → `[]`             (sin tamaño: ventana desconocida, 1 mes = misma edad, o continuo)
 *   - 2                    → `[Cabeza, Cola]` (sin "Cuerpo")
 *   - 3..11                → `[Cabeza, Cuerpo, Cola]` (tercios; 3 exacto, 4–11 [TENTATIVO])
 * Un `nMonths` negativo, no entero o > 12 se trata como "fuera de la distinción" (→ `[]`): defensivo,
 * la UI no debería mandarlos pero el contrato es duro. Devuelve SIEMPRE un array nuevo (no compartido).
 */
export function sizeBucketsForServiceMonths(nMonths: number | null): SizeBucket[] {
  if (nMonths === null || !Number.isInteger(nMonths)) return [];
  if (nMonths <= ONE_MONTH || nMonths >= FULL_YEAR) return []; // 0/1 y 12+ → sin tamaño
  if (nMonths === TWO_MONTHS) return [HEAD, TAIL]; // 2 → cabeza/cola (sin cuerpo)
  return [HEAD, BODY, TAIL]; // 3..11 → tercios (3 exacto; 4–11 [TENTATIVO])
}

/**
 * Default de "¿medir tamaño?" derivado del rodeo (RPSC.4.2): hay distinción de etapas posible ⟺ el rodeo
 * produce ≥1 bucket. Es decir: 2/3/4–11 meses → `true` (SÍ por default); 1/12/0/NULL → `false` (NO).
 * El operario puede override el default en cualquier sentido (RPSC.4.3) — esto sólo PRE-CARGA.
 */
export function defaultMeasureSize(nMonths: number | null): boolean {
  return sizeBucketsForServiceMonths(nMonths).length > 0;
}

/**
 * Buckets de tamaño efectivos PARA LA CAPTURA, combinando la regla del rodeo con el override del operario
 * (RPSC.4.3): si el operario eligió "NO medir tamaño" (`measureSize === false`), no hay buckets aunque el
 * rodeo los admita; si eligió "SÍ" (`true`), valen los del rodeo (un rodeo de 1/12 meses igual no produce
 * buckets, así que "SÍ" sobre 1 mes da `[]` — degradar con gracia, RPSC.4.4). `measureSize === undefined`
 * (sin decisión explícita) cae al default del rodeo. `TactoStep` recibe el resultado de esta función.
 */
export function effectiveSizeBuckets(nMonths: number | null, measureSize: boolean | undefined): SizeBucket[] {
  if (measureSize === false) return [];
  return sizeBucketsForServiceMonths(nMonths);
}
