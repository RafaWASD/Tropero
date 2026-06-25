// app/src/utils/sigsa-filters.ts — validación PURA del rango de fechas de nacimiento del filtro de la
// pantalla de exportación SIGSA (spec 08, R9.3). Sin RN, sin red: testeable con node:test.
//
// El filtro acota los pendientes por birth_date BETWEEN dateFrom AND dateTo (ambos OPCIONALES, inclusive).
// Las fechas son ISO 'YYYY-MM-DD' (el input las masca con maskDateInput). La única regla a chequear en la UI
// es la COHERENCIA del rango: si AMBAS están completas y válidas, `desde` no puede ser posterior a `hasta`.
// (No hay regla de "no futura" — una fecha de nacimiento futura no tiene sentido pero el filtro es laxo; si
// no matchea nada, la lista queda vacía, no es un error de validación.)

/** Una fecha ISO 'YYYY-MM-DD' COMPLETA y válida (10 chars, partes numéricas, mes 1-12, día 1-31). */
function isCompleteIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map((p) => Number(p));
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 9999) return false;
  return true;
}

export type BirthDateRangeValidation =
  | { ok: true }
  /** El rango es incoherente (desde > hasta). El campo a marcar es 'to' (el "hasta", el que cierra mal). */
  | { ok: false; error: string; field: 'to' };

/**
 * Valida el rango de fechas del filtro (R9.3). Reglas:
 *   - Cualquiera (o ambas) VACÍA o PARCIAL (el usuario todavía tipeando) → OK (no se valida hasta completar;
 *     la query trata una fecha parcial como "sin filtro" en ese borde — el caller solo aplica filtros completos).
 *   - Ambas completas y válidas con `desde` <= `hasta` → OK.
 *   - Ambas completas y válidas con `desde` > `hasta` → error (rango imposible), apuntando al "hasta".
 *
 * Comparación por STRING ISO (chronológica-correcta para 'YYYY-MM-DD', igual que el filtro de la query).
 */
export function isValidBirthDateRange(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): BirthDateRangeValidation {
  const from = (dateFrom ?? '').trim();
  const to = (dateTo ?? '').trim();
  // Solo validamos cuando AMBAS están completas (parcial = el usuario sigue tipeando → no molestar).
  if (!isCompleteIsoDate(from) || !isCompleteIsoDate(to)) return { ok: true };
  if (from > to) {
    return { ok: false, error: 'La fecha "desde" no puede ser posterior a "hasta".', field: 'to' };
  }
  return { ok: true };
}

/**
 * Normaliza una fecha ISO de filtro a lo que la query debe recibir: el string SOLO si está COMPLETO y válido;
 * si está vacío o parcial → null (= "sin este límite"). Evita pasar 'YYYY-MM' (parcial) a la query, que
 * compararía mal por string. Pura.
 */
export function normalizeFilterDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  return isCompleteIsoDate(s) ? s : null;
}
