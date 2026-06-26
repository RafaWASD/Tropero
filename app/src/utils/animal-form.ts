// Validadores PUROS del form de alta de animal (spec 09 R4 / spec 02 design §"Validaciones
// locales offline-first"). Sin RN, sin red: testeable con node:test.
//
// Espejo de los constraints/triggers del server (NUNCA relajamos la validación cliente "porque
// el server enforce" — el operario necesita feedback inmediato sin round-trip, design.md §Notas):
//   - sex OBLIGATORIO (animals.sex NOT NULL check in ('male','female')).
//   - birth_date no futuro (no podés cargar un animal nacido mañana).
//   - entry_date ≥ birth_date si ambas presentes (no entró antes de nacer).
//   - entry_weight / birth_weight > 0 si presentes (numeric, peso positivo).
//   - identidad MÍNIMA: al menos uno de tag_electronic / idv / visual_id_alt (hasAtLeastOneIdentifier).
//
// IDENTIDAD MÍNIMA (animal_profiles_identity_check, 0021 / R6.2): el server EXIGE al menos un
// identificador. En el camino de find-or-create siempre hay uno PRECARGADO (R4.2) → se cumple solo.
// PERO el ALTA EN BLANCO (entrada "Dar de alta tu primer animal", sin precarga) puede llegar al submit
// con los tres vacíos: ahí create_animal rechaza con 23514 al subir y el alta se PIERDE en silencio
// (queda solo en el overlay local, nunca aterriza en Postgres). Por eso `hasAtLeastOneIdentifier`
// valida en el CLIENTE antes de encolar el intent — no encolamos un alta condenada (offline-first sin
// pérdida). Espeja el constraint del server; no relajamos la validación cliente.

import type { AnimalSex } from './animal-category';

// Tope EXCLUSIVO de peso de bovino: < 10000 (parte entera ≤ 4 cifras). Mismo valor que el
// WEIGHT_KG_LIMIT de event-input.ts; se define local porque los utils PUROS de la suite node:test no
// hacen value-import entre siblings (el runner los carga sin bundler — ver nota en event-input.ts).
const WEIGHT_KG_LIMIT = 10000;

/** Estado del form de alta (lo que el screen mantiene). Identificadores aparte (precargado + 2). */
export type AnimalCreateForm = {
  sex: AnimalSex | null;
  /** ISO 'YYYY-MM-DD' o ''. */
  birthDate: string;
  /** ISO 'YYYY-MM-DD' o '' (fecha de ingreso/entrada al campo). */
  entryDate: string;
  /** Peso de entrada en kg, como string del input (se valida numérico > 0 si no vacío). */
  entryWeight: string;
  breed: string;
  coatColor: string;
};

/** Errores por campo + flag agregado. null = sin error. */
export type AnimalCreateErrors = {
  sex: string | null;
  birthDate: string | null;
  entryDate: string | null;
  entryWeight: string | null;
  valid: boolean;
};

/**
 * Valida el form de alta. `today` inyectable para tests deterministas (default hoy).
 * Devuelve un error por campo (es-AR, voseo) + `valid`.
 */
export function validateAnimalCreate(
  form: AnimalCreateForm,
  today: Date = new Date(),
): AnimalCreateErrors {
  const errors: { sex: string | null; birthDate: string | null; entryDate: string | null; entryWeight: string | null } = {
    sex: null,
    birthDate: null,
    entryDate: null,
    entryWeight: null,
  };

  // sex obligatorio (R4.5: radio macho/hembra requerido).
  if (form.sex !== 'male' && form.sex !== 'female') {
    errors.sex = 'Elegí el sexo del animal.';
  }

  // birth_date: si está presente, formato válido y no futuro.
  const birth = parseDate(form.birthDate);
  if (form.birthDate.trim().length > 0) {
    if (!birth) {
      errors.birthDate = 'Fecha de nacimiento inválida.';
    } else if (birth.getTime() > startOfDay(today).getTime()) {
      errors.birthDate = 'La fecha de nacimiento no puede ser futura.';
    }
  }

  // entry_date: si está presente, formato válido y ≥ birth_date (si esta es válida).
  const entry = parseDate(form.entryDate);
  if (form.entryDate.trim().length > 0) {
    if (!entry) {
      errors.entryDate = 'Fecha de ingreso inválida.';
    } else if (entry.getTime() > startOfDay(today).getTime()) {
      errors.entryDate = 'La fecha de ingreso no puede ser futura.';
    } else if (birth && entry.getTime() < birth.getTime()) {
      errors.entryDate = 'El ingreso no puede ser anterior al nacimiento.';
    }
  }

  // entry_weight: si está presente (no vacío), numérico > 0 y parte entera ≤ 4 cifras (ningún bovino
  // llega a 5 cifras / 10.000 kg). El sanitizeWeightInput ya acota la parte entera en vivo; backstop.
  const w = form.entryWeight.trim();
  if (w.length > 0) {
    const n = parseWeight(w);
    if (n === null || n <= 0) {
      errors.entryWeight = 'El peso de entrada tiene que ser un número mayor a 0.';
    } else if (n >= WEIGHT_KG_LIMIT) {
      errors.entryWeight = 'El peso no puede tener más de 4 cifras.';
    }
  }

  const valid =
    !errors.sex && !errors.birthDate && !errors.entryDate && !errors.entryWeight;
  return { ...errors, valid };
}

/**
 * ¿El alta lleva al menos UN identificador? El server (animal_profiles_identity_check, 0021 / R6.2)
 * exige al menos uno de tag_electronic / idv / visual_id_alt; sin ninguno, create_animal rechaza con
 * 23514 al subir y el alta se PIERDE en silencio (queda solo en el overlay local). Validamos en el
 * cliente ANTES de encolar el intent (camino de ALTA EN BLANCO, sin identificador precargado). Trim
 * defensivo: un campo con solo espacios NO cuenta (el server hace nullif(trim(...)) → quedaría NULL).
 */
export function hasAtLeastOneIdentifier(
  tag: string | null | undefined,
  idv: string | null | undefined,
  visual: string | null | undefined,
): boolean {
  return (
    (tag ?? '').trim().length > 0 ||
    (idv ?? '').trim().length > 0 ||
    (visual ?? '').trim().length > 0
  );
}

/** Parsea el peso aceptando coma decimal (es-AR): "320,5" → 320.5. null si no es número. */
export function parseWeight(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Parsea 'YYYY-MM-DD' a Date UTC midnight. null si formato/valor inválido. */
function parseDate(iso: string): Date | null {
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

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
