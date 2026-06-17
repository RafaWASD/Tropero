// Serialización del `value` de un dato/maniobra CUSTOM (spec 03 M5-C.1, R13.16) — PURA, sin I/O.
//
// El `value` de custom_measurements / custom_attributes es jsonb. El caller (la UI genérica por
// ui_component) entrega el valor YA TIPADO; este módulo lo serializa a JSON TEXT (la columna value es
// jsonb→TEXT en el schema local de PowerSync). El punto CRÍTICO: el número se serializa como NÚMERO JSON
// (`385`, no `"385"`) — el gating server-side (assert_custom_value_valid, 0096) exige `jsonb_typeof = 'number'`
// para numeric/numeric_stepped; un string rompería la validación. PURA → testeable sin el SDK.

/**
 * Valor tipado de una captura/propiedad custom, según el `ui_component` del field_definition:
 *   - numeric / numeric_stepped → number
 *   - boolean                   → boolean
 *   - text / date / enum_single → string
 *   - enum_multi                → string[]
 * La UI genérica por ui_component entrega el valor en este tipo. El server re-valida la forma contra el
 * ui_component real (assert_custom_value_valid, 0096) al subir.
 */
export type CustomValue = number | boolean | string | string[];

export type SerializeResult = { ok: true; json: string } | { ok: false; message: string };

/**
 * Serializa el `value` tipado a JSON TEXT para la columna jsonb. PURA. El número va como número JSON (NO
 * string), el bool como bool JSON, el string como string JSON, el array como array JSON de strings. Un number
 * NO finito (NaN/Infinity) → error (JSON.stringify lo volvería `null`, que rompería la validación numérica
 * server-side). Un array con un elemento no-string también → error (enum_multi es siempre string[]). El
 * service NO infiere el tipo del ui_component (no lo conoce): confía en el tipo que entrega el caller y el
 * server re-valida.
 */
export function serializeCustomValue(value: CustomValue): SerializeResult {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ok: false, message: 'El valor numérico no es válido.' };
    }
    return { ok: true, json: JSON.stringify(value) };
  }
  if (typeof value === 'boolean') {
    return { ok: true, json: JSON.stringify(value) };
  }
  if (typeof value === 'string') {
    return { ok: true, json: JSON.stringify(value) };
  }
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === 'string')) {
      return { ok: false, message: 'Las opciones seleccionadas no son válidas.' };
    }
    return { ok: true, json: JSON.stringify(value) };
  }
  // Defensivo: TS ya acota CustomValue, pero un caller no tipado podría pasar otra cosa.
  return { ok: false, message: 'El tipo de valor no es válido.' };
}
