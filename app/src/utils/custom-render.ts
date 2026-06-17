// Lógica PURA del RENDER GENÉRICO de un dato/maniobra CUSTOM por `ui_component` (spec 03 M5-C.3, R13.8/R13.10).
// Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón que custom-value.ts / custom-field.ts).
//
// El renderer genérico (CustomFieldInput / CustomManeuverStep) dibuja un input por `ui_component` reusando
// los idioms de manga LOCKEADOS (keypad, stepper, bloques, multi-select, input de texto, sí/no, fecha). Este
// módulo concentra lo PURO de ese render, que NO depende de la UI:
//   (a) `parseCustomOptions`: las opciones de un enum desde `config_schema` (jsonb pass-through, TOLERANTE).
//   (b) `parseCustomValueJson`: el `value` jsonb (TEXT o nativo) → CustomCaptureValue tipado por ui_component
//       (lectura del current-value de la ficha, R13.12, o de una corrección del resumen).
//   (c) `describeCustomValue`: texto legible es-AR del valor capturado (para el resumen R5.9 y la ficha).
//   (d) `isCustomValueComplete`: ¿hay un valor capturable para este ui_component? (gate del CTA / completitud).
//
// El `value` se SERIALIZA a jsonb con `serializeCustomValue` (custom-value.ts, único origen del lado escritura);
// acá vive el lado LECTURA + presentación. El server (assert_custom_value_valid, 0096) re-valida la forma del
// value contra el ui_component real al subir — esto es UX/capa-1, no la barrera de seguridad.

import type { CustomUiComponent } from './custom-field';
import type { CustomValue } from './custom-value';

/**
 * El valor capturado de un dato custom en el cliente, unión discriminada por su `ui_component`:
 *   - numeric / numeric_stepped → { kind:'number'; value:number }
 *   - boolean                   → { kind:'boolean'; value:boolean }
 *   - text / date / enum_single → { kind:'string'; value:string }
 *   - enum_multi                → { kind:'multi'; value:string[] }
 * Se mapea 1:1 a `CustomValue` (custom-value.ts) al serializar; acá lleva el `kind` para que la UI y el
 * resumen no tengan que re-inferir el tipo del ui_component en cada uso.
 */
export type CustomCaptureValue =
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'multi'; value: string[] };

/** El `kind` de CustomCaptureValue que corresponde a un ui_component (la forma del input/value). */
export function captureKindFor(uiComponent: CustomUiComponent): CustomCaptureValue['kind'] {
  switch (uiComponent) {
    case 'numeric':
    case 'numeric_stepped':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum_multi':
      return 'multi';
    case 'text':
    case 'date':
    case 'enum_single':
    default:
      return 'string';
  }
}

/** Convierte un CustomCaptureValue al CustomValue plano que serializeCustomValue espera (lado escritura). */
export function toCustomValue(v: CustomCaptureValue): CustomValue {
  return v.value;
}

// ─── (a) Opciones de un enum desde config_schema (TOLERANTE) ──────────────────────────────────────────

/**
 * Extrae las opciones de un enum de `config_schema` (jsonb pass-through), TOLERANTE al shape:
 *   - objeto `{options:[...]}` (el que arma buildCreateCustomFieldPayload) → la lista de strings no-vacíos;
 *   - string JSON de ese objeto (config_schema como TEXT local) → se parsea (1 o 2 niveles, doble-encoding);
 *   - cualquier otra cosa (null/array/number) → [].
 * Dedup case-insensitive (preserva orden + casing del primero). NUNCA tira. Es la fuente de los bloques de un
 * enum_single y de los chips de un enum_multi en el renderer genérico.
 */
export function parseCustomOptions(configSchema: unknown): string[] {
  let obj: unknown = configSchema;
  // config_schema puede venir como TEXT (SQLite local) — string JSON (posiblemente doble-encodeado).
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
      if (typeof obj === 'string') obj = JSON.parse(obj);
    } catch {
      return [];
    }
  }
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const raw = (obj as Record<string, unknown>).options;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== 'string') continue;
    const v = o.trim();
    if (v.length === 0) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// ─── (b) Lectura del value jsonb → CustomCaptureValue tipado por ui_component ──────────────────────────

/**
 * Parsea el `value` jsonb de un custom_attributes/custom_measurement (current-value de la ficha R13.12, o una
 * corrección del resumen R5.9) al CustomCaptureValue del `ui_component`. El value puede venir:
 *   - NATIVO (PowerSync materializó el jsonb como JS) — number/boolean/string/array;
 *   - TEXT JSON (el INSERT local guarda JSON-TEXT en la columna jsonb-as-TEXT) — se parsea (1 o 2 niveles).
 * Devuelve null si no hay un valor coherente con el ui_component (la ficha muestra "—" / el input arranca
 * vacío). TOLERANTE: un value corrupto/incompatible NO rompe (cae a null). Para enum_multi, filtra a strings.
 */
export function parseCustomValueJson(
  raw: unknown,
  uiComponent: CustomUiComponent,
): CustomCaptureValue | null {
  if (raw == null) return null;
  let v: unknown = raw;
  if (typeof v === 'string') {
    // Puede ser un string JSON (number/bool/array serializados) o un string es DE VERDAD (text/date/enum).
    // Intentamos parsear; si falla, lo tratamos como string literal (solo válido para los kinds string).
    try {
      let parsed: unknown = JSON.parse(v);
      if (typeof parsed === 'string') {
        // doble-encoding posible (jsonb sincronizado) → un nivel más.
        try {
          parsed = JSON.parse(parsed);
        } catch {
          /* parsed ya es un string literal de un nivel — se usa tal cual abajo */
        }
      }
      v = parsed;
    } catch {
      // No es JSON parseable → es un string literal (ej. el operario guardó "overo" como texto plano local).
      v = v;
    }
  }
  const kind = captureKindFor(uiComponent);
  switch (kind) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? { kind: 'number', value: v } : null;
    case 'boolean':
      return typeof v === 'boolean' ? { kind: 'boolean', value: v } : null;
    case 'multi': {
      if (!Array.isArray(v)) return null;
      const arr = v.filter((x): x is string => typeof x === 'string');
      return { kind: 'multi', value: arr };
    }
    case 'string':
    default:
      return typeof v === 'string' ? { kind: 'string', value: v } : null;
  }
}

// ─── (c) Texto legible es-AR del valor (resumen R5.9 + ficha) ─────────────────────────────────────────

/**
 * Texto legible es-AR de un CustomCaptureValue, para el resumen por animal (R5.9) y la ficha (R13.10/R13.12).
 *   - number → coma decimal es-AR (385 → "385", 4.5 → "4,5"); sin unidad (el dato custom no la trae).
 *   - boolean → "Sí" / "No".
 *   - string vacío → "—" (sin cargar); si no, el texto tal cual.
 *   - multi vacío → "—"; si no, coma-join.
 * `null`/ausente → "Sin cargar" (consistente con describeStepValue de las de fábrica).
 */
export function describeCustomValue(value: CustomCaptureValue | null | undefined): string {
  if (!value) return 'Sin cargar';
  switch (value.kind) {
    case 'number':
      return value.value.toLocaleString('es-AR');
    case 'boolean':
      return value.value ? 'Sí' : 'No';
    case 'string': {
      const t = value.value.trim();
      return t.length > 0 ? t : '—';
    }
    case 'multi':
      return value.value.length > 0 ? value.value.join(', ') : '—';
    default:
      return 'Sin cargar';
  }
}

// ─── (d) ¿Hay un valor capturable? (gate del CTA / completitud del paso) ───────────────────────────────

/**
 * ¿El valor capturado es "completo" (persistible) para su ui_component? Reglas alineadas con el server
 * (assert_custom_value_valid, 0096) PERO en clave UX (capa 1, gate del CTA):
 *   - number → un número finito (cualquiera; no se exige > 0: un ángulo/score puede ser 0 o negativo).
 *   - boolean → siempre completo (Sí o No es un valor).
 *   - string (text/date/enum_single) → no vacío (trim). Un enum_single requiere una opción elegida (string).
 *   - multi (enum_multi) → ≥1 opción.
 * Un null/ausente → false. El server re-valida la FORMA + (para enum) la pertenencia a config_schema.
 */
export function isCustomValueComplete(value: CustomCaptureValue | null | undefined): boolean {
  if (!value) return false;
  switch (value.kind) {
    case 'number':
      return Number.isFinite(value.value);
    case 'boolean':
      return true;
    case 'string':
      return value.value.trim().length > 0;
    case 'multi':
      return value.value.length > 0;
    default:
      return false;
  }
}
