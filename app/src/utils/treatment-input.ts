// Lógica PURA de los inputs del ciclo de TRATAMIENTOS (spec 02 delta tratamientos, RTR.1/2/3). Sin RN, sin
// red: testeable con node:test (mismo patrón que event-input.ts / animal-input.ts).
//
// Filosofía: PREVENIR, no errorear (memoria de input pro). El sanitizer del cliente CORTA en vivo al tope; el
// server es la BARRERA DURA (CHECK). Las constantes de tope son las MISMAS que los CHECKs server-side de la
// migración 0123 (SEC-TRT-02 / RTR.1.9/RTR.1.10) — así el cliente corta antes y el server re-valida al subir.

// ─── Topes de texto libre (LAS MISMAS que los CHECKs server-side, 0123 / SEC-TRT-02) ──────────────
/** Tope de `product_name` (RTR.1.9). CHECK server: char_length(product_name) <= 120. */
export const TREATMENT_PRODUCT_MAX_LENGTH = 120;
/** Tope de `notes` (RTR.1.10). CHECK server: notes IS NULL OR char_length(notes) <= 1000. */
export const TREATMENT_NOTES_MAX_LENGTH = 1000;

// ─── Tipos del tratamiento (D-3 / RTR.1.3): enum cerrado + labels es-AR ────────────────────────────
export type TreatmentKind = 'antibiotico' | 'antiparasitario' | 'otro';

/** Opciones del selector CERRADO de tipo de tratamiento (RTR.1.3). value = enum treatment_kind (0123). */
export const TREATMENT_KIND_OPTIONS: readonly { value: TreatmentKind; label: string }[] = [
  { value: 'antibiotico', label: 'Antibiótico' },
  { value: 'antiparasitario', label: 'Antiparasitario' },
  { value: 'otro', label: 'Otro' },
];

/** Label es-AR de un `kind` (para la card de la ficha). Fallback al propio valor si no matchea. */
export function treatmentKindLabel(kind: string): string {
  return TREATMENT_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

/**
 * Mapea el `kind` del tratamiento al `event_type` (enum sanitary_event_type de 0027) de sus aplicaciones
 * (RTR.2.2, requirements § Decisión de criterio 4): antibiotico→treatment, antiparasitario→deworming,
 * otro→other. Mantiene coherente el render del timeline existente. La aplicación queda EXENTA del gating de
 * maniobra (RTR.2.7, treatment_id no nulo + event_type≠vaccination) — ninguno de estos 3 es 'vaccination'.
 */
export function treatmentEventType(kind: string): 'treatment' | 'deworming' | 'other' {
  switch (kind) {
    case 'antibiotico':
      return 'treatment';
    case 'antiparasitario':
      return 'deworming';
    default:
      return 'other';
  }
}

// ─── Vía de aplicación (route): selector cerrado opcional, es-AR ────────────────────────────────────
export type TreatmentRoute = 'intramuscular' | 'subcutaneous' | 'oral' | 'intravenous' | 'topical';

/** Opciones OPCIONALES de vía de aplicación (RTR.2.3). value = string guardado en sanitary_events.route. */
export const TREATMENT_ROUTE_OPTIONS: readonly { value: TreatmentRoute; label: string }[] = [
  { value: 'intramuscular', label: 'Intramuscular' },
  { value: 'subcutaneous', label: 'Subcutánea' },
  { value: 'oral', label: 'Oral' },
  { value: 'intravenous', label: 'Intravenosa' },
  { value: 'topical', label: 'Tópica' },
];

/** Label es-AR de una `route` guardada (para la card de la aplicación). Fallback al propio valor. */
export function treatmentRouteLabel(route: string): string {
  return TREATMENT_ROUTE_OPTIONS.find((o) => o.value === route)?.label ?? route;
}

// ─── Sanitizers (cortan en vivo al tope; NO filtran caracteres: es texto libre) ─────────────────────
/** Acota `product_name` al tope server (RTR.1.9). El form lo aplica en vivo → el submit ya viene ≤ 120. */
export function sanitizeTreatmentProductInput(raw: string): string {
  return raw.slice(0, TREATMENT_PRODUCT_MAX_LENGTH);
}

/** Acota `notes` al tope server (RTR.1.10). */
export function sanitizeTreatmentNotesInput(raw: string): string {
  return raw.slice(0, TREATMENT_NOTES_MAX_LENGTH);
}

// ─── Validaciones de submit ─────────────────────────────────────────────────────────────────────────
export type TreatmentProductValidation = { ok: true; value: string } | { ok: false; error: string };

/**
 * Valida `product_name` al submit (RTR.1.4 no vacío + RTR.1.9 tope). REQUERIDO. Trim + no vacío + ≤ 120. El
 * server re-valida (CHECK not_empty + product_len) al subir. Devuelve el valor TRIMEADO listo para el INSERT.
 */
export function validateTreatmentProduct(raw: string): TreatmentProductValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Ingresá qué producto se aplicó.' };
  }
  if (trimmed.length > TREATMENT_PRODUCT_MAX_LENGTH) {
    return { ok: false, error: `El nombre del producto es muy largo (máx ${TREATMENT_PRODUCT_MAX_LENGTH} caracteres).` };
  }
  return { ok: true, value: trimmed };
}

export type TreatmentNotesValidation = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Valida `notes` al submit (RTR.1.5 opcional + RTR.1.10 tope). OPCIONAL: vacío → ok con value null. Si hay
 * texto, ≤ 1000. Devuelve el valor TRIMEADO o null (columna nullable).
 */
export function validateTreatmentNotes(raw: string): TreatmentNotesValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > TREATMENT_NOTES_MAX_LENGTH) {
    return { ok: false, error: `El comentario es muy largo (máx ${TREATMENT_NOTES_MAX_LENGTH} caracteres).` };
  }
  return { ok: true, value: trimmed };
}

export type OptionalDateValidation = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Valida la PRÓXIMA DOSIS (`next_dose_date`, RTR.2.3) al submit. OPCIONAL: vacío → ok con value null. A
 * diferencia de la fecha de la aplicación (validateEventDate, NO-futura), la próxima dosis es NATURALMENTE
 * FUTURA (el peón anota "la próxima en X días") → solo se valida el FORMATO completo AAAA-MM-DD (no la
 * no-futuridad). Devuelve la fecha ISO o null. TZ-safe: valida por componentes (no `new Date`).
 */
export function validateNextDose(raw: string): OptionalDateValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) {
    return { ok: false, error: 'Fecha inválida (usá AAAA-MM-DD).' };
  }
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, error: 'Fecha inválida (usá AAAA-MM-DD).' };
  }
  return { ok: true, value: trimmed };
}

export type DoseValidation = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Valida la dosis (`dose_ml`) de una aplicación al submit (RTR.2.3). OPCIONAL: vacío → ok con value null. Si
 * hay texto, debe ser un número > 0 (acepta coma decimal es-AR, ej. "5,5"). Sin tope duro de dominio (una
 * dosis puede ser grande); el server la guarda como numeric. Devuelve el número o null.
 */
export function validateDose(raw: string): DoseValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, error: 'La dosis tiene que ser un número.' };
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'La dosis tiene que ser mayor a 0.' };
  }
  return { ok: true, value: n };
}
