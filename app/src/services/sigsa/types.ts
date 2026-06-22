// Tipos de soporte de la capa pura de exportación SIGSA (spec 08, T8).
//
// Sin I/O, sin imports de dominio (PowerSync/Supabase/expo). Estos tipos son el contrato
// entre la query de pendientes (que NO vive acá), el validador pre-export (sigsa-validator.ts)
// y el generador del TXT (sigsa-txt-generator.ts).
//
// Ver design.md §"Módulo generador de TXT" y §"Flujo de datos — Export".

/**
 * Registro LIMPIO y ya validado, input del generador de TXT (R5.2, design §generador).
 *
 * Forma EXACTA del design: los 4 campos posicionales del registro SIGSA, normalizados.
 * Lo produce el validador (`validateForExport`) a partir de un `PendingAnimalInfo` que pasa
 * todos los controles. El generador asume que estos campos ya están bien (pero igual revalida
 * defensivamente la forma del RFID y el código de raza, R6.5 / R8.6 — fail-closed).
 */
export interface AnimalExportRecord {
  /** RFID de 15 dígitos numéricos (ya validado). `animals.tag_electronic`. */
  rfid: string;
  /** Sexo en código SIGSA: 'M' (macho) / 'H' (hembra). Mapeado desde `animals.sex`. */
  sex: 'M' | 'H';
  /** Código SENASA exacto del catálogo (ej. 'AA', 'H', 'BG'). `breed_catalog.senasa_code`. */
  breedCode: string;
  /** Fecha de nacimiento como 'MM/AAAA' (ej. '08/2025'). Derivado de `animals.birth_date`. */
  birthMonthYear: string;
}

/**
 * Opciones de formato del generador de TXT (R6.3 — GATE DURO).
 *
 * El comportamiento del `;` final NO está confirmado con upload real a SIGSA: por eso es
 * configurable y arranca en `false` hasta confirmar. Mantenerlo en una sola opción aislada
 * permite absorber el ajuste sin tocar el resto del módulo.
 */
export interface SigsaTxtOptions {
  /** Si el string termina con `;` después del último registro. GATE DURO: default `false`. */
  trailingSemicolon?: boolean;
}

/**
 * Razón por la que un animal NO es exportable (R8.2, R8.3).
 *
 * Se coleccionan TODAS las aplicables por animal (R8.3: "el o los datos faltantes", plural),
 * no solo la primera. Orden de declaración = orden de chequeo en el validador.
 */
export type ExportValidationReason =
  | 'missing_rfid' // tag_electronic es null/vacío
  | 'invalid_rfid' // tag_electronic presente pero no son 15 dígitos numéricos
  | 'missing_birth_date' // birth_date es null
  | 'missing_breed'; // breed_id null → sin senasa_code del catálogo

/**
 * Datos CRUDOS de un animal candidato a exportar, tal como los devuelve la query de pendientes
 * (design §"Flujo de datos — Export"). El validador los recibe y separa en exportables vs. a-completar.
 *
 * Campos nullables porque vienen directo de la DB sin validar todavía. La query (que NO vive en
 * esta capa pura) hace el JOIN animals + animal_profiles + breed_catalog y mapea acá.
 *
 * Mínimo pero extensible: si la UI necesita más campos para mostrar la fila "a completar"
 * (categoría, rodeo, tag legible), se agregan acá sin romper el contrato del validador.
 */
export interface PendingAnimalInfo {
  /** `animal_profiles.id` — identidad del perfil dentro del establecimiento (para el reporte). */
  animalProfileId: string;
  /** `animals.tag_electronic` — RFID crudo; null si el animal aún no tiene dispositivo. */
  rfid: string | null;
  /** `animals.sex` — sexo crudo de la DB; null defensivo (el schema spec 02 lo garantiza NOT NULL). */
  sex: 'male' | 'female' | null;
  /** `animals.birth_date` — fecha ISO ('YYYY-MM-DD' o ISO completo); null si falta. */
  birthDate: string | null;
  /** `animal_profiles.breed_id` — FK al catálogo; null si no se asignó raza. */
  breedId: string | null;
  /** `breed_catalog.senasa_code` resuelto por el JOIN; null cuando `breedId` es null. */
  breedCode: string | null;
}

/**
 * Resultado de la validación pre-export (R8.1): los animales seleccionados separados en dos
 * conjuntos — los exportables (ya como `AnimalExportRecord` limpio, listos para el generador)
 * y los incompletos (con el/los motivos por animal para que el usuario los complete y reintente).
 */
export interface ExportValidationResult {
  /** Animales que pasan TODOS los controles, ya normalizados al formato del TXT. */
  exportable: AnimalExportRecord[];
  /** Animales que fallan ≥1 control, con su id y la lista completa de razones (R8.3). */
  incomplete: Array<{
    animalProfileId: string;
    reasons: ExportValidationReason[];
  }>;
}
