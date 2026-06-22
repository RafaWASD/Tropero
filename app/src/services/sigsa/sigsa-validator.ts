// Validación pre-export PURA para SIGSA (spec 08, T10).
//
// Sin I/O, sin efectos, sin imports de dominio. Recibe los datos CRUDOS de la query de
// pendientes (PendingAnimalInfo[], campos nullables) y los separa en (a) exportables —ya
// normalizados al AnimalExportRecord que consume el generador— y (b) "a completar", con el o
// los motivos por animal (R8.1, R8.3). Corre bajo node:test (patrón src/utils/*).
//
// Reglas de bloqueo (R8.2 / R8.6):
//   - tag_electronic null/vacío            → 'missing_rfid'
//   - tag_electronic ≠ 15 dígitos numéricos → 'invalid_rfid'
//   - birth_date null                       → 'missing_birth_date'
//   - breed_id null (sin senasa_code)       → 'missing_breed'
// Se coleccionan TODAS las razones aplicables por animal (R8.3: "el o los datos faltantes",
// plural), no solo la primera, para que el usuario complete todo de una.
//
// Mapeo a AnimalExportRecord (solo para los exportables):
//   sex 'male'→'M' / 'female'→'H'; birthDate (ISO) → 'MM/AAAA'; breedCode tal cual del catálogo.
//
// El RFID se valida con el MISMO criterio genérico que parse-sigsa-txt.ts (15 dígitos), NO con
// el isValidTag del RS420 (que exige prefijo 982 y rechazaría los TAG argentinos con prefijo 032).

import type {
  AnimalExportRecord,
  ExportValidationReason,
  ExportValidationResult,
  PendingAnimalInfo,
} from './types';

/** RFID = 15 dígitos numéricos genéricos (igual que RFID_RE en parse-sigsa-txt.ts / el generador). */
const RFID_RE = /^\d{15}$/;

/** Fecha ISO con al menos 'YYYY-MM-DD' al inicio (acepta 'YYYY-MM-DD' o ISO completo con 'T...'). */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Separa los animales crudos en exportables vs. incompletos (R8.1).
 *
 * Para cada animal junta TODAS las razones de bloqueo aplicables (R8.3). Si no tiene ninguna,
 * lo normaliza a AnimalExportRecord (sex→M/H, birthDate→MM/AAAA) y lo agrega a `exportable`.
 *
 * Puro, no muta el input, nunca lanza (los datos malos terminan en `incomplete`, no en una
 * excepción: la UI necesita la lista de faltantes, no un crash).
 */
export function validateForExport(animals: PendingAnimalInfo[]): ExportValidationResult {
  const exportable: AnimalExportRecord[] = [];
  const incomplete: ExportValidationResult['incomplete'] = [];

  if (!Array.isArray(animals)) {
    return { exportable, incomplete };
  }

  for (const animal of animals) {
    if (animal == null) continue; // defensivo: fila nula en el array no rompe el lote

    const reasons: ExportValidationReason[] = [];

    // --- RFID (R8.2 / R8.6) ---
    const rfid = typeof animal.rfid === 'string' ? animal.rfid.trim() : '';
    if (rfid.length === 0) {
      reasons.push('missing_rfid');
    } else if (!RFID_RE.test(rfid)) {
      // presente pero mal formado (14 dígitos, con letras, espacios internos, etc.)
      reasons.push('invalid_rfid');
    }

    // --- birth_date (R8.2) ---
    const birthMonthYear = monthYearFromIso(animal.birthDate);
    if (birthMonthYear === null) {
      reasons.push('missing_birth_date');
    }

    // --- raza / breed_id (R8.2) ---
    // Bloquea por breed_id null (R8.2). Si breed_id está pero el JOIN no resolvió senasa_code
    // (breedCode null/vacío), también bloqueamos: sin código no se puede exportar la raza.
    const breedCode = typeof animal.breedCode === 'string' ? animal.breedCode.trim() : '';
    if (animal.breedId == null || breedCode.length === 0) {
      reasons.push('missing_breed');
    }

    if (reasons.length > 0) {
      incomplete.push({ animalProfileId: animal.animalProfileId, reasons });
      continue;
    }

    // Todos los controles pasaron → normalizar al record limpio del generador.
    // birthMonthYear no es null acá (si lo fuera, habría una razón). El non-null assertion
    // es seguro por la guarda de reasons.length de arriba.
    exportable.push({
      rfid,
      sex: sexToSigsa(animal.sex),
      breedCode,
      birthMonthYear: birthMonthYear as string,
    });
  }

  return { exportable, incomplete };
}

/**
 * Mapea el sexo de la DB al código SIGSA: 'male'→'M', 'female'→'H' (R5.2).
 *
 * `sex` NO es condición bloqueante en R8.2 (el schema spec 02 lo garantiza NOT NULL). Si llega
 * un valor inesperado (null u otra cosa), lo tratamos defensivamente como 'H' (hembra) para no
 * lanzar acá — pero esto NO debería pasar en datos reales. Decisión documentada: preferimos no
 * convertir un caso imposible-por-schema en un bloqueo de export; si apareciera, el dato malo se
 * detectaría aguas arriba. (Un animal que llega hasta acá ya pasó RFID+fecha+raza.)
 */
function sexToSigsa(sex: PendingAnimalInfo['sex']): 'M' | 'H' {
  return sex === 'male' ? 'M' : 'H';
}

/**
 * Convierte una fecha ISO ('YYYY-MM-DD' o ISO completo) a 'MM/AAAA' (R5.2, R6.4), o null si la
 * fecha es null/vacía/no parseable. Trabaja sobre los componentes de fecha del string (sin
 * construir Date, para evitar corrimientos por zona horaria): toma MM y AAAA tal cual aparecen.
 */
function monthYearFromIso(iso: string | null): string | null {
  if (typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  if (trimmed.length === 0) return null;
  const m = ISO_DATE_RE.exec(trimmed);
  if (!m) return null;
  const year = m[1];
  const month = m[2];
  // El regex ya garantiza 2 dígitos de mes; validamos rango 01-12 para no emitir un mes inválido.
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return null;
  return `${month}/${year}`;
}
