// Lógica PURA de la EDAD legible de un animal (spec 10, T-UI.3 / R11.9: la fila compacta de
// AnimalRow muestra "categoría · edad"). SIN RN, SIN red: testeable con node:test (mismo patrón que
// animal-birth-year.ts / management-group.ts).
//
// La edad sale de `animal_birth_date` (animals.birth_date denormalizado en animal_profiles, b1 —
// ISO 'YYYY-MM-DD' o null). En el campo casi siempre se sabe solo el AÑO de nacimiento, que el alta
// guiada convierte a 'AAAA-07-01' (animal-birth-year.ts) → la precisión real es ~año. Por eso el
// label es GRUESO: años a partir del año, meses solo en el primer año, "—" si no se sabe la fecha.
//
// Convención de redondeo (manga-friendly, una lectura de un vistazo):
//   - sin birthDate            → null (el caller muestra "—" o lo omite).
//   - < 1 mes                  → "menos de 1 mes".
//   - 1–11 meses               → "N meses" ("1 mes" singular).
//   - ≥ 1 año                  → "N años" ("1 año" singular), años COMPLETOS (floor).
// El cálculo es por fecha de calendario (años/meses completos transcurridos), `now` inyectable para
// tests deterministas. Una fecha de nacimiento futura (dato inconsistente) → null (no inventamos edad).

/**
 * Edad legible es-AR de un animal a partir de su `birthDate` ('YYYY-MM-DD' o null). Devuelve null si
 * no hay fecha o la fecha es inválida/futura → el caller decide cómo mostrar la ausencia ("—").
 *
 * `now` inyectable (default `new Date()`) para tests deterministas.
 */
export function formatAnimalAge(birthDate: string | null | undefined, now: Date = new Date()): string | null {
  const totalMonths = monthsBetween(birthDate, now);
  if (totalMonths == null) return null;

  if (totalMonths < 1) return 'menos de 1 mes';
  if (totalMonths < 12) {
    return totalMonths === 1 ? '1 mes' : `${totalMonths} meses`;
  }
  const years = Math.floor(totalMonths / 12);
  return years === 1 ? '1 año' : `${years} años`;
}

/**
 * Meses COMPLETOS transcurridos entre `birthDate` y `now` (≥0), o null si la fecha es nula/inválida/
 * futura. PURA (sin red). Cálculo por calendario: (años·12 + meses) y se descuenta 1 si el día del
 * mes actual todavía no alcanzó el día de nacimiento (mes incompleto).
 */
export function monthsBetween(birthDate: string | null | undefined, now: Date): number | null {
  if (!birthDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!m) return null;
  const by = Number(m[1]);
  const bmonth = Number(m[2]);
  const bday = Number(m[3]);
  // Validación básica de rango (un mes 13 / día 40 = dato corrupto → sin edad).
  if (bmonth < 1 || bmonth > 12 || bday < 1 || bday > 31) return null;

  const ny = now.getFullYear();
  const nmonth = now.getMonth() + 1; // getMonth es 0-based
  const nday = now.getDate();

  let months = (ny - by) * 12 + (nmonth - bmonth);
  // Mes en curso aún incompleto (no llegó el día de nacimiento de este mes) → descontar 1.
  if (nday < bday) months -= 1;
  if (months < 0) return null; // fecha futura / inconsistente → sin edad
  return months;
}
