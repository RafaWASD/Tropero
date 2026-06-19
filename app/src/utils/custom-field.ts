// Derivación + validación de un dato/maniobra CUSTOM en su CREACIÓN (spec 03 M5-C.2, R13.5–R13.9).
// PURA, sin I/O, sin RN, sin SDK — testeable con node:test (mismo patrón que custom-value.ts).
//
// Resuelve, dado lo que el usuario tipea en el form de creación (label + tipo de input + opciones), el
// PAYLOAD del INSERT a field_definitions que el backend 0093 espera (CRUD-plano, owner-only RLS + guard
// tg_field_definitions_custom_guard). El `data_key` se DERIVA del label como slug (`^[a-z0-9_]+$`, ≤64,
// único por establishment) — agregando un sufijo corto si ya existe; nunca lo tipea el usuario.
//
// Los caps client-side son UX (no autoritativos): el server re-valida TODO (0093: slug, ≤64, ≤80/≤500,
// ui_component ∈ los 7, data_type ∈ (maniobra,propiedad), options 1..50 / ≤60, inmutabilidad). Acá
// validamos para feedback inmediato + para no mandar payloads que el server rechazaría de seguro.

// ─── Los 7 tipos de input ofrecidos (R13.8) ─────────────────────────────────────────────────────────

/** Los 7 `ui_component` que el alta de cliente puede crear (R13.8). El server los restringe por CHECK. */
export type CustomUiComponent =
  | 'numeric'
  | 'numeric_stepped'
  | 'enum_single'
  | 'enum_multi'
  | 'text'
  | 'boolean'
  | 'date';

/** La clasificación del dato custom (R13.6): propiedad (se carga una vez) o maniobra (se mide y se sigue). */
export type CustomDataType = 'propiedad' | 'maniobra';

/** Un tipo de input ofrecido en el picker: su `ui_component`, su label es-AR y si requiere opciones (enum). */
export type UiComponentOption = {
  uiComponent: CustomUiComponent;
  /** Label es-AR claro para el picker (R13.8). */
  label: string;
  /** Sub-línea explicativa breve (es-AR). */
  hint: string;
  /** True para enum_single/enum_multi: necesita el editor de opciones. */
  needsOptions: boolean;
};

/**
 * Catálogo de los 7 tipos de input, EN ORDEN de presentación, con labels es-AR (voseo). Single source of
 * truth del picker. Orden: numéricos primero (lo más común para "medir algo"), luego listas, luego los simples.
 */
export const UI_COMPONENT_OPTIONS: readonly UiComponentOption[] = [
  { uiComponent: 'numeric', label: 'Numérico', hint: 'Un número (ej. ángulo, score).', needsOptions: false },
  { uiComponent: 'numeric_stepped', label: 'Numérico con +/−', hint: 'Un número con botones de subir y bajar.', needsOptions: false },
  { uiComponent: 'enum_single', label: 'Lista (una opción)', hint: 'Elegís una de varias opciones.', needsOptions: true },
  { uiComponent: 'enum_multi', label: 'Lista (varias opciones)', hint: 'Podés elegir más de una.', needsOptions: true },
  { uiComponent: 'text', label: 'Texto', hint: 'Texto libre.', needsOptions: false },
  { uiComponent: 'boolean', label: 'Sí / No', hint: 'Una marca de sí o no.', needsOptions: false },
  { uiComponent: 'date', label: 'Fecha', hint: 'Una fecha.', needsOptions: false },
];

/** ¿Este ui_component necesita el editor de opciones (es un enum)? */
export function uiComponentNeedsOptions(c: CustomUiComponent): boolean {
  return c === 'enum_single' || c === 'enum_multi';
}

// ─── Caps client-side (UX; el server re-valida) ──────────────────────────────────────────────────────

/** Cap de largo del label (UX; el server no tiene CHECK de label pero sí ≤80 es razonable de manga). */
export const LABEL_MAX = 80;
/** Cap de largo del data_key derivado (server: CHECK ≤64). */
export const DATA_KEY_MAX = 64;
/** Cardinalidad máxima de opciones de un enum (server: 1..50). */
export const OPTIONS_MAX = 50;
/** Largo máximo de cada opción (server: ≤60). */
export const OPTION_LABEL_MAX = 60;

// ─── Slug del data_key (derivado del label, único por establishment) ──────────────────────────────────

/**
 * Convierte un texto libre a un slug base `^[a-z0-9_]*$`: minúsculas, sin acentos (NFD + strip de marcas),
 * los no-alfanuméricos → `_`, colapsa `_` repetidos y recorta los de los extremos. NO garantiza no-vacío ni
 * largo (eso lo hace slugifyDataKey). PURA.
 */
export function baseSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca los diacríticos combinados de NFD (á→a, ñ→n)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // todo lo que no es [a-z0-9] → _
    .replace(/_+/g, '_') // colapsa _ repetidos
    .replace(/^_+|_+$/g, ''); // recorta _ de los extremos
}

/** Sufijo corto base36 a partir de un número (para desambiguar slugs colisionados). PURO. */
function shortSuffix(n: number): string {
  return n.toString(36);
}

/**
 * Deriva un `data_key` VÁLIDO (`^[a-z0-9_]+$`, 1..DATA_KEY_MAX) y ÚNICO contra `existing` (los data_keys
 * custom YA usados en el establishment). PURA.
 *
 * - Si el label no produce ningún carácter alfanumérico (ej. "🐄" o "  "), cae a un base genérico `dato`.
 * - Recorta a DATA_KEY_MAX. Si ya existe, prueba sufijos `_2`, `_3`, … (recortando la base para que el slug
 *   + sufijo entren en DATA_KEY_MAX). El conjunto `existing` debe traer los data_keys EN MINÚSCULA (como los
 *   guarda el server). El resultado nunca colisiona con `existing` ni excede DATA_KEY_MAX.
 */
export function slugifyDataKey(label: string, existing: readonly string[] = []): string {
  const taken = new Set(existing.map((s) => s.toLowerCase()));
  let base = baseSlug(label);
  if (base.length === 0) base = 'dato';
  if (base.length > DATA_KEY_MAX) base = base.slice(0, DATA_KEY_MAX).replace(/_+$/g, '');
  if (base.length === 0) base = 'dato'; // por si el recorte dejó solo _

  if (!taken.has(base)) return base;

  // Colisión: probamos base_2, base_3, … recortando la base para que base + '_' + sufijo entren en el cap.
  for (let i = 2; i < 100000; i += 1) {
    const suffix = `_${shortSuffix(i)}`;
    const maxBaseLen = DATA_KEY_MAX - suffix.length;
    const trimmed = base.slice(0, Math.max(1, maxBaseLen)).replace(/_+$/g, '') || 'dato';
    const candidate = `${trimmed}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback (improbable): timestamp en base36 (siempre [a-z0-9], cabe en 64).
  return `dato_${Date.now().toString(36)}`;
}

// ─── Validación del form (feedback inmediato; el server es la barrera autoritativa) ────────────────────

export type CustomFieldDraft = {
  label: string;
  dataType: CustomDataType;
  uiComponent: CustomUiComponent;
  /** Opciones del enum (solo enum_single/enum_multi). Para los demás se ignoran. */
  options?: string[];
};

export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Valida un draft de dato custom contra los caps client-side (UX). PURA. NO deriva el slug (eso lo hace el
 * service con la lista de data_keys existentes). El server re-valida TODO al subir (0093).
 *
 * Reglas:
 *   - label: no vacío (trim) y ≤ LABEL_MAX.
 *   - enum (single/multi): ≥1 opción, ≤ OPTIONS_MAX, cada una no-vacía y ≤ OPTION_LABEL_MAX, sin duplicados
 *     (case-insensitive). El editor de opciones ya impide vacías/duplicadas, pero re-validamos por las dudas.
 */
export function validateCustomFieldDraft(draft: CustomFieldDraft): ValidationResult {
  const label = draft.label.trim();
  if (label.length === 0) return { ok: false, message: 'Poné un nombre para el dato.' };
  if (label.length > LABEL_MAX) return { ok: false, message: `El nombre no puede superar los ${LABEL_MAX} caracteres.` };

  if (uiComponentNeedsOptions(draft.uiComponent)) {
    const opts = (draft.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
    if (opts.length < 1) return { ok: false, message: 'Agregá al menos una opción.' };
    if (opts.length > OPTIONS_MAX) return { ok: false, message: `No podés tener más de ${OPTIONS_MAX} opciones.` };
    if (opts.some((o) => o.length > OPTION_LABEL_MAX)) {
      return { ok: false, message: `Cada opción puede tener hasta ${OPTION_LABEL_MAX} caracteres.` };
    }
    const lower = opts.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) return { ok: false, message: 'Hay opciones repetidas.' };
  }
  return { ok: true };
}

// ─── A qué CAMPO del form pertenece un error de validación (presentación: scroll + resalte inline) ─────

/** El campo del form al que apunta un error de validación (para resaltar + scrollear). */
export type CustomFieldErrorTarget = 'label' | 'options';

/**
 * Dado un draft inválido, devuelve QUÉ campo del form es el culpable (para resaltarlo con borde de alerta +
 * scrollear hasta él + mostrar el mensaje inline). PURA y PRESENTACIONAL: NO re-valida ni re-decide el mensaje
 * (eso lo hace `validateCustomFieldDraft`, único origen de verdad). Solo MAPEA, con la MISMA precedencia que la
 * validación, la falla → su campo, así el resalte y el mensaje quedan siempre consistentes:
 *   - label vacío / demasiado largo            → 'label'
 *   - enum sin opciones / opciones inválidas    → 'options'
 *
 * Devuelve null si el draft es válido (o si la falla no mapea a un campo visible — no debería pasar dado el
 * conjunto actual de reglas). El caller llama a `validateCustomFieldDraft` para el MENSAJE y a esta para el
 * TARGET; comparten precedencia (label antes que options) y por eso nunca se contradicen.
 */
export function customFieldErrorTarget(draft: CustomFieldDraft): CustomFieldErrorTarget | null {
  const label = draft.label.trim();
  if (label.length === 0 || label.length > LABEL_MAX) return 'label';

  if (uiComponentNeedsOptions(draft.uiComponent)) {
    const opts = (draft.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
    if (opts.length < 1) return 'options';
    if (opts.length > OPTIONS_MAX) return 'options';
    if (opts.some((o) => o.length > OPTION_LABEL_MAX)) return 'options';
    const lower = opts.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) return 'options';
  }
  return null;
}

// ─── Payload del INSERT (shape EXACTO de field_definitions, 0093) ──────────────────────────────────────

/** El payload del INSERT a field_definitions (las columnas que el cliente manda; el server fuerza el resto). */
export type CreateCustomFieldPayload = {
  id: string;
  establishment_id: string;
  data_key: string;
  label: string;
  data_type: CustomDataType;
  ui_component: CustomUiComponent;
  category: string;
  /** {options:[...]} solo para enums; null para los demás (la columna es jsonb nullable). */
  config_schema: { options: string[] } | null;
};

/** Categoría de una fila custom (≤32, set libre — usamos una marca clara para distinguirlas en el catálogo). */
export const CUSTOM_FIELD_CATEGORY = 'personalizado';

/**
 * Arma el payload del INSERT de un dato custom (R13.5–R13.9). PURA. NO genera el `id` (lo provee el service,
 * uuid de cliente) ni resuelve el establishment (el service lo toma del contexto activo) ni la unicidad del
 * data_key (el service pasa `existingDataKeys`). Las opciones se trimean + se filtran las vacías; un enum sin
 * opciones produce config_schema={options:[]} (el server lo rechazaría — la validación previa lo impide).
 *
 * NUNCA incluye establishment_id forzado por trigger ni columnas inmutables que el cliente no setea
 * (created_at/updated_at/active/schema_version los maneja el default/trigger del server).
 */
export function buildCreateCustomFieldPayload(args: {
  id: string;
  establishmentId: string;
  draft: CustomFieldDraft;
  existingDataKeys: readonly string[];
}): CreateCustomFieldPayload {
  const { id, establishmentId, draft, existingDataKeys } = args;
  const label = draft.label.trim();
  const dataKey = slugifyDataKey(label, existingDataKeys);
  const isEnum = uiComponentNeedsOptions(draft.uiComponent);
  const configSchema = isEnum
    ? { options: (draft.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0) }
    : null;
  return {
    id,
    establishment_id: establishmentId,
    data_key: dataKey,
    label,
    data_type: draft.dataType,
    ui_component: draft.uiComponent,
    category: CUSTOM_FIELD_CATEGORY,
    config_schema: configSchema,
  };
}
