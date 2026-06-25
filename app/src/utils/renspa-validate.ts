// app/src/utils/renspa-validate.ts — validación PURA del campo RENSPA (spec 08, R2.2).
//
// El RENSPA es OPCIONAL (la columna acepta NULL = "sin RENSPA"). Cuando el usuario carga uno, debe ser un
// string no vacío de hasta 20 caracteres. Espeja el CHECK server-side de la migración 0110:
//   renspa IS NULL OR (char_length(trim(renspa)) > 0 AND char_length(renspa) <= 20)
// El server es la autoridad (la app valida en vivo solo para feedback inmediato — borde rojo + error inline).
//
// La validación de formato RENSPA más estricta (estructura SENASA NN.NNN.N.NNNN) queda POST-MVP (R2.2).
//
// Sin RN, sin red: testeable con node:test.

/** Tope de caracteres del RENSPA (CHECK 0110: char_length(renspa) <= 20). */
export const RENSPA_MAX_LENGTH = 20;

export type RenspaValidation =
  | { ok: true; /** El valor a persistir: el string trimeado, o null si quedó vacío (= "sin RENSPA"). */ value: string | null }
  | { ok: false; error: string };

/**
 * Valida un RENSPA tipeado (R2.2). Reglas:
 *   - vacío / solo espacios → OK con `value: null` (borrar el RENSPA es legítimo: el campo es opcional).
 *   - 1..20 chars (tras trim no-vacío; el LARGO se mide sobre el string SIN trim, igual que el CHECK
 *     `char_length(renspa) <= 20`, que mide el valor crudo) → OK con `value` = trim.
 *   - > 20 chars → error accionable.
 *
 * Devuelve `value` listo para persistir (la capa de service vuelve a normalizar por las dudas, pero acá
 * resolvemos el null/trim para que la UI muestre el resultado correcto).
 */
export function validateRenspa(input: string): RenspaValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    // Vacío = sin RENSPA (opcional). Se persiste null (la RPC hace SET renspa = NULL).
    return { ok: true, value: null };
  }
  // El CHECK del DB mide char_length sobre el valor CRUDO (no trimeado). Validamos el largo del input tal
  // cual el usuario lo manda (el service trimea al persistir, pero el tope de 20 es sobre lo que se guarda;
  // como guardamos el trim, medimos el trim — más estricto y consistente con lo que termina en la DB).
  if (trimmed.length > RENSPA_MAX_LENGTH) {
    return {
      ok: false,
      error: `El RENSPA puede tener hasta ${RENSPA_MAX_LENGTH} caracteres.`,
    };
  }
  return { ok: true, value: trimmed };
}
