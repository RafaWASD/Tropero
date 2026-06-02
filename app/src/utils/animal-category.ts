// Lógica PURA de categoría inicial al alta (spec 02 R4.7) — espejo cliente de compute_category.
// Sin RN, sin red, sin supabase-js: testeable con node:test.
//
// POR QUÉ existe (no llamamos compute_category(profile_id) en el alta):
//   La RPC compute_category(profile_id) del server (migration 0031) recibe un perfil que YA
//   EXISTE. En el alta el perfil todavía no existe (lo estamos por insertar) y category_id es
//   NOT NULL en animal_profiles → necesitamos la categoría ANTES del insert. Replicamos acá la
//   rama "sin eventos" de compute_category (un animal recién creado no tiene partos ni tactos),
//   que depende SOLO de sex + birth_date. Es exactamente lo que hace el helper createAnimal de
//   la suite backend (supabase/tests/animal/run.cjs): default por sexo, ternero/ternera si <1 año.
//
// Las transiciones posteriores (preñez, parto) las maneja el server vía triggers (spec 02 R7);
// el cliente NO recomputa categoría tras eventos (eso es C3 + server). Acá solo el alta.

/** Códigos de categoría de (bovino, cría) que puede arrojar el alta (sin eventos previos). */
export type InitialCategoryCode = 'ternero' | 'torito' | 'ternera' | 'vaquillona';

export type AnimalSex = 'male' | 'female';

const ONE_YEAR_DAYS = 365;

/**
 * Calcula el código de categoría inicial de un animal de cría recién creado (R4.7), espejo de la
 * rama sin-eventos de compute_category (0031):
 *   - macho  + nacimiento < 1 año (conocido) → 'ternero'
 *   - macho  + sin fecha o ≥ 1 año           → 'torito'  (conservador; el owner puede pasar a 'toro')
 *   - hembra + nacimiento < 1 año (conocido) → 'ternera'
 *   - hembra + sin fecha o ≥ 1 año           → 'vaquillona'
 *
 * `birthDate` en formato ISO 'YYYY-MM-DD' o null. `today` inyectable para tests deterministas
 * (default: hoy). Si la fecha es futura/ inválida, se trata como desconocida (cae al default por
 * sexo) — la validación del form ya rechaza fechas futuras antes de llegar acá, esto es defensivo.
 */
export function computeInitialCategoryCode(
  sex: AnimalSex,
  birthDate: string | null,
  today: Date = new Date(),
): InitialCategoryCode {
  const ageDays = birthDate ? ageInDays(birthDate, today) : null;
  const isCalf = ageDays !== null && ageDays >= 0 && ageDays < ONE_YEAR_DAYS;
  if (sex === 'male') {
    return isCalf ? 'ternero' : 'torito';
  }
  return isCalf ? 'ternera' : 'vaquillona';
}

/** Diferencia en días entre `today` y una fecha ISO 'YYYY-MM-DD'. NaN-safe (null si inválida). */
function ageInDays(birthDateIso: string, today: Date): number | null {
  const birth = parseIsoDate(birthDateIso);
  if (!birth) return null;
  const ms = startOfDay(today).getTime() - birth.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Parsea 'YYYY-MM-DD' a Date en UTC midnight. null si no matchea el formato o es inválida. */
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rechaza fechas que "se desbordaron" (ej. 2026-02-31 → marzo).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** Medianoche UTC del día de `d` (para comparar con fechas ISO normalizadas a UTC midnight). */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
