// Lógica PURA de los inputs de carga de evento (spec 02 C3.1). Sin RN, sin red: testeable con
// node:test (mismo patrón que animal-input.ts / animal-form.ts).
//
// Filosofía: PREVENIR, no errorear (memoria de input pro). El peso reusa sanitizeWeightInput +
// parseWeight (ya existen); la fecha reusa maskDateInput (ya existe). Acá agregamos:
//   - la lista cerrada de los 17 scores válidos de condición corporal (1.00→5.00, paso 0.25),
//   - la validación de submit del peso (numérico > 0, parte entera ≤ 4 cifras / < 10000; dominio bovino),
//   - el tope de largo + validación (no vacío) del texto de observación.
// NO duplicamos sanitizeWeightInput / maskDateInput / parseWeight (viven en animal-input/animal-form).

// NOTA: NO importamos parseWeight de animal-form como valor a propósito. Los utils PUROS de la
// suite de tests (node:test) son self-contained — ninguno hace value-import de un sibling (solo
// `import type`), porque el runner los carga sin bundler y la resolución de extensiones difiere de
// Metro. `parseNumberArAr` de abajo es el mismo parser de coma-decimal que parseWeight (3 líneas):
// no es el SANITIZER de input (ese sí vive una sola vez en animal-input.ts y NO lo duplicamos), es
// el parser de submit. La intención de "no dupliques" del brief apunta a sanitizeWeightInput /
// maskDateInput (el sanitizado en vivo), que el campo del form reusa de animal-input.ts.

// ─── Condición corporal: 17 valores cerrados (R6.4, CHECK del server 0028) ────────────────
// 1.00, 1.25, 1.50, ..., 5.00 — paso 0.25. El selector es CERRADO (nunca texto libre) → el valor
// elegido SIEMPRE cumple el CHECK del DB. Generamos la lista para no tipear 17 literales a mano.

export const CONDITION_SCORE_MIN = 1;
export const CONDITION_SCORE_MAX = 5;
export const CONDITION_SCORE_STEP = 0.25;

/** Los 17 scores válidos como números (1.00 → 5.00, paso 0.25). */
export const CONDITION_SCORES: readonly number[] = (() => {
  const out: number[] = [];
  // Iteramos en cuartos enteros para evitar acumular error de punto flotante.
  const minQuarters = CONDITION_SCORE_MIN / CONDITION_SCORE_STEP; // 4
  const maxQuarters = CONDITION_SCORE_MAX / CONDITION_SCORE_STEP; // 20
  for (let q = minQuarters; q <= maxQuarters; q++) {
    out.push(q * CONDITION_SCORE_STEP);
  }
  return out;
})();

/** ¿Es `n` uno de los 17 scores válidos? (defensa: el selector cerrado ya lo garantiza). */
export function isValidConditionScore(n: number): boolean {
  return CONDITION_SCORES.some((s) => Math.abs(s - n) < 1e-9);
}

/** Formatea un score para mostrar en es-AR: "3.00" → "3", "3.25" → "3,25" (coma decimal). */
export function formatConditionScore(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0$/, '').replace('.', ',');
}

// ─── Peso: validación de submit (dominio bovino: > 0, parte entera ≤ 4 cifras) ────────────
// El bovino más pesado registrado pesó 1.740 kg; ninguno llegó a 5 cifras (10.000 kg). El cap de
// dominio es 4 cifras ENTERAS → el valor debe ser < 10000 (los decimales siguen permitidos, ej.
// 9999,99). Es MÁS estricto que el CHECK del server (numeric(7,2) > 0 = ≤ 99999.99): este backstop
// caza cualquier 5+ cifras que se escape del sanitizer (paste raro, edición). El sanitizeWeightInput
// (animal-input.ts) ya acota la parte entera a 4 dígitos EN VIVO; acá lo re-validamos al submit.

/** Tope EXCLUSIVO: el peso debe ser estrictamente menor a esto (parte entera ≤ 4 cifras). */
export const WEIGHT_KG_LIMIT = 10000;

export type WeightValidation = { ok: true; value: number } | { ok: false; error: string };

/** Parsea un decimal aceptando coma es-AR ("320,5" → 320.5). null si no es número. */
function parseNumberArAr(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Valida el peso al submit. `raw` es el string del campo (ya sanitizado en vivo). Requerido
 * (un evento de peso sin peso no tiene sentido): vacío → error. Acepta coma decimal (es-AR).
 */
export function validateWeight(raw: string): WeightValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Ingresá el peso en kilos.' };
  }
  const n = parseNumberArAr(trimmed);
  if (n === null || n <= 0) {
    return { ok: false, error: 'El peso tiene que ser un número mayor a 0.' };
  }
  if (n >= WEIGHT_KG_LIMIT) {
    return { ok: false, error: 'El peso no puede tener más de 4 cifras.' };
  }
  return { ok: true, value: n };
}

// ─── Fecha del evento: validación de submit (formato + no-futura razonable) ───────────────
// El campo usa maskDateInput EN VIVO (animal-input.ts), así que solo puede contener AAAA-MM-DD
// parcial/completo. Validamos al submit: formato completo + no-futura (avisamos, no es absurda).

export type EventDateValidation =
  | { ok: true; value: string } // ISO 'YYYY-MM-DD'
  | { ok: false; error: string };

/** Parsea 'YYYY-MM-DD' a Date UTC midnight, validando rango. null si formato/valor inválido. */
function parseIsoDate(iso: string): Date | null {
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

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Valida la fecha del evento (peso / condición). REQUERIDA (todo evento tiene una fecha): vacío →
 * error. Formato completo AAAA-MM-DD. No futura (no podés cargar un pesaje de mañana). `today`
 * inyectable para tests deterministas.
 */
export function validateEventDate(raw: string, today: Date = new Date()): EventDateValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Ingresá la fecha del evento.' };
  }
  const d = parseIsoDate(trimmed);
  if (!d) {
    return { ok: false, error: 'Fecha inválida (usá AAAA-MM-DD).' };
  }
  if (d.getTime() > startOfUtcDay(today).getTime()) {
    return { ok: false, error: 'La fecha no puede ser futura.' };
  }
  return { ok: true, value: trimmed };
}

// ─── Observación libre: tope de largo + validación (no vacío) ─────────────────────────────

export const OBSERVATION_MAX_LENGTH = 1000;

/** Acota el texto de la observación al tope (no filtra caracteres: es texto libre). */
export function sanitizeObservationInput(raw: string): string {
  return raw.slice(0, OBSERVATION_MAX_LENGTH);
}

// ─── Reproductivo: listas cerradas de opciones (R6.2) ─────────────────────────────────────
// Estas son la FUENTE DE VERDAD de los selectores cerrados de tacto/servicio: garantizan que solo
// se manda un valor válido del enum del DB (igual que el ScoreSelector de condición corporal). NO
// hace falta validador extra de "elegiste algo": el screen chequea `!= null` antes de submitear.

/**
 * Opciones del selector de resultado de TACTO (pregnancy_status). Labels es-AR.
 *
 * B1 (decisión de dominio Facundo, 2026-06-03 §4): el selector muestra SOLO el término de campo
 * (Cabeza / Cuerpo / Cola), nunca "preñez chica/media/grande". Equivalencia (sabida, no mostrada):
 * cabeza = grande, cuerpo = mediana, cola = chica. Mapeo al enum DB: small=cola, medium=cuerpo,
 * large=cabeza. (`empty` = "Vacía".)
 */
export const PREGNANCY_OPTIONS: readonly {
  value: 'empty' | 'small' | 'medium' | 'large';
  label: string;
}[] = [
  { value: 'empty', label: 'Vacía' },
  { value: 'small', label: 'Cola' },
  { value: 'medium', label: 'Cuerpo' },
  { value: 'large', label: 'Cabeza' },
];

/** Opciones del selector de tipo de SERVICIO (service_type). Labels es-AR. */
export const SERVICE_TYPE_OPTIONS: readonly { value: 'natural' | 'ai' | 'te'; label: string }[] = [
  { value: 'natural', label: 'Monta natural' },
  { value: 'ai', label: 'Inseminación (IA)' },
  { value: 'te', label: 'Transferencia embrionaria (TE)' },
];

// ─── Parto: opciones de sexo del ternero + validación de la lista de terneros (R9/R9.5) ────
// El parto crea 1..N terneros (mellizos, R9.5). Cada ternero necesita SEXO (requerido, selector
// cerrado → enum válido), peso al nacer (opcional, kg) y caravana (opcional, FDX-B 15 díg). El sexo
// determina la categoría inicial del ternero server-side (ternero/ternera). La lista vive en el
// screen como un array; validateCalves la chequea al submit (puro, testeable).

/** Opciones del selector de SEXO del ternero (R9.5). Labels es-AR. value = enum de animals.sex. */
export const SEX_OPTIONS: readonly { value: 'male' | 'female'; label: string }[] = [
  { value: 'male', label: 'Macho' },
  { value: 'female', label: 'Hembra' },
];

/** Un ternero tal como lo arma el form: sexo (o null si aún no se eligió) + peso/tag crudos. */
export type CalfDraft = {
  /** null hasta que el operario elige el sexo (requerido). */
  sex: 'male' | 'female' | null;
  /** String crudo del campo de peso (ya sanitizado en vivo). Vacío = sin peso (opcional). */
  weightRaw: string;
  /** String crudo del campo de caravana (ya sanitizado en vivo). Vacío = sin tag (opcional). */
  tagRaw: string;
};

/** Un ternero ya validado, listo para registerBirth. */
export type ValidatedCalf = {
  sex: 'male' | 'female';
  /** kg parseado, o null si el campo estaba vacío (opcional). */
  weightKg: number | null;
  /** tag limpio, o null si estaba vacío (opcional). */
  tag: string | null;
};

export type CalvesValidation =
  | { ok: true; value: ValidatedCalf[] }
  | { ok: false; error: string };

/**
 * Valida la lista de terneros del parto al submit (R9/R9.5). Reglas:
 *   - al menos 1 ternero (la RPC también lo exige; el form mantiene mínimo 1).
 *   - CADA ternero debe tener sexo elegido (requerido). Si falta alguno → error claro.
 *   - peso OPCIONAL: vacío es válido; si hay texto, debe ser un peso válido (reusa el parser de
 *     validateWeight: > 0, parte entera ≤ 4 cifras). El tag opcional NO se valida acá (15 díg lo
 *     valida el campo en vivo / lo rechaza el server por duplicado).
 *
 * Devuelve la lista de terneros normalizados (sexo + peso parseado + tag limpio) o el primer error.
 */
export function validateCalves(calves: readonly CalfDraft[]): CalvesValidation {
  if (calves.length === 0) {
    return { ok: false, error: 'Agregá al menos un ternero.' };
  }
  const out: ValidatedCalf[] = [];
  for (const c of calves) {
    if (c.sex == null) {
      return { ok: false, error: 'Elegí el sexo de cada ternero.' };
    }
    let weightKg: number | null = null;
    const rawWeight = c.weightRaw.trim();
    if (rawWeight.length > 0) {
      const w = validateWeight(rawWeight);
      if (!w.ok) {
        // Reusa el mismo copy de peso (> 0 / ≤ 4 cifras). El operario sabe qué corregir.
        return { ok: false, error: w.error };
      }
      weightKg = w.value;
    }
    const tag = c.tagRaw.trim();
    out.push({ sex: c.sex, weightKg, tag: tag.length > 0 ? tag : null });
  }
  return { ok: true, value: out };
}

// ─── Avisos suaves de eventos reproductivos vs. el estado de preñez (C3.2 gating) ──────────
//
// Algunos eventos reproductivos son INCOHERENTES con el estado de preñez que figura en NUESTROS
// registros. NO los bloqueamos (los registros pueden estar desactualizados: una preñez vieja por un
// tacto que en realidad se perdió, o una preñez real sin el tacto cargado). En su lugar mostramos un
// AVISO SUAVE (confirmación "¿registrar igual?", no error terracota) para que el operario confirme
// conscientemente. Casos:
//   - PARTO o ABORTO sobre una hembra que NO figura preñada → "no figura preñada, ¿registrar igual?".
//     (El parto/aborto ya son prueba de que estuvo preñada; puede faltar el tacto en la app.)
//   - SERVICIO sobre una hembra que SÍ figura preñada → "figura preñada, ¿registrar el servicio igual?".
//     (No se da servicio a una hembra preñada; pero puede figurar preñada por un tacto viejo y haberlo
//     perdido sin registrarlo.)
//   - cualquier otro caso (tacto; o el caso COHERENTE de cada evento) → sin aviso.
//
// `reproductiveWarning` es PURO y testeable: depende solo del tipo de evento y de si figura preñada.
// `pregnant` lo computa la ficha desde deriveCurrentState (pregnancy?.kind === 'pregnant'); null/undefined
// (no se pudo determinar) se trata como NO-preñada (conservador: ante la duda, que el operario confirme
// en birth/abortion; en service un estado indeterminado NO es "figura preñada" → sin aviso).

/** Copy del aviso suave de parto/aborto en hembra no preñada (es-AR voseo). Informativo + confirmable. */
export const UNCONFIRMED_BIRTH_WARNING =
  'Esta hembra no figura preñada en tus registros. ¿Registrar el parto igual?';

/** Copy del aviso suave de aborto en hembra no preñada (es-AR voseo). */
export const UNCONFIRMED_ABORTION_WARNING =
  'Esta hembra no figura preñada en tus registros. ¿Registrar el aborto igual?';

/** Copy del aviso suave de servicio en hembra que figura preñada (es-AR voseo). */
export const SERVICE_ON_PREGNANT_WARNING =
  'Esta hembra figura preñada en tus registros. ¿Registrar el servicio igual?';

/** Label del botón de confirmación de los avisos suaves reproductivos (procede con el evento). */
export const REPRODUCTIVE_WARNING_CONFIRM_LABEL = 'Registrar igual';

/** Compat: label histórico del aviso de parto (mismo texto). Lo usa el submit del parto. */
export const UNCONFIRMED_BIRTH_CONFIRM_LABEL = REPRODUCTIVE_WARNING_CONFIRM_LABEL;

export type ReproductiveWarning = { message: string; confirmLabel: string };

/**
 * ¿Hay que mostrar un aviso suave antes de registrar este evento reproductivo, dado el estado de preñez
 * que figura en nuestros registros? Devuelve el copy del aviso ({ message, confirmLabel }) o null (sin
 * aviso). Ramas (las únicas que avisan):
 *   - 'birth' | 'abortion' + NO preñada (`pregnant !== true`) → aviso "no figura preñada, ¿registrar igual?".
 *   - 'service' + SÍ preñada (`pregnant === true`) → aviso "figura preñada, ¿registrar el servicio igual?".
 *   - cualquier otro evento o estado coherente → null.
 * NO bloquea: es solo el copy de una confirmación. El caller decide cómo presentarla (confirmAction).
 */
export function reproductiveWarning(
  eventType: string,
  pregnant: boolean | null | undefined,
): ReproductiveWarning | null {
  if (eventType === 'birth') {
    if (pregnant !== true) {
      return { message: UNCONFIRMED_BIRTH_WARNING, confirmLabel: REPRODUCTIVE_WARNING_CONFIRM_LABEL };
    }
    return null;
  }
  if (eventType === 'abortion') {
    if (pregnant !== true) {
      return { message: UNCONFIRMED_ABORTION_WARNING, confirmLabel: REPRODUCTIVE_WARNING_CONFIRM_LABEL };
    }
    return null;
  }
  if (eventType === 'service') {
    if (pregnant === true) {
      return { message: SERVICE_ON_PREGNANT_WARNING, confirmLabel: REPRODUCTIVE_WARNING_CONFIRM_LABEL };
    }
    return null;
  }
  return null;
}

/**
 * Compat fina: ¿avisar antes de un PARTO sobre una hembra no preñada? Delega en reproductiveWarning
 * (el parto sigue andando idéntico). Conservada por si algún caller la usa; el submit ya migró a
 * reproductiveWarning para cubrir birth/abortion/service de forma uniforme.
 */
export function shouldWarnUnconfirmedBirth(
  eventType: string,
  pregnant: boolean | null | undefined,
): boolean {
  if (eventType !== 'birth') return false;
  return reproductiveWarning('birth', pregnant) !== null;
}

export type ObservationValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Valida la observación al submit: no vacía (trim) y dentro del tope. */
export function validateObservation(raw: string): ObservationValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Escribí la observación.' };
  }
  if (trimmed.length > OBSERVATION_MAX_LENGTH) {
    return { ok: false, error: `La observación es muy larga (máx ${OBSERVATION_MAX_LENGTH} caracteres).` };
  }
  return { ok: true, value: trimmed };
}
