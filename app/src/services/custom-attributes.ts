// CURRENT-VALUE de una PROPIEDAD CUSTOM (spec 03 M5-C.1, R13.12 / R13.13).
//
// Service DELGADO y SWAPPABLE (espeja events.ts / custom-measurements.ts). Una propiedad custom
// (`data_type='propiedad'`) NO tiene historial: una fila por `(animal_profile_id, field_definition_id)` con
// el VALOR ACTUAL, editable en cualquier momento (R13.12) — patrón `teeth_state` pero en una tabla genérica.
// UPSERT por la PK compuesta: re-editar el mismo par PISA el valor (no agrega historial).
//
// ⚠️ GOTCHA de upsert offline de PowerSync (resuelto). `custom_attributes` (0095) tiene PK COMPUESTA
// `(animal_profile_id, field_definition_id)` y NO tiene columna `id` real; la stream le da un `id` SINTÉTICO
// (`animal_profile_id || ':' || field_definition_id`) para el DOWN. El write LOCAL usa ese mismo id sintético
// como PK local + `INSERT ... ON CONFLICT(id) DO UPDATE` (buildSetCustomAttributeUpsert) → actualiza EN EL
// LUGAR (LWW), sin duplicar. El UPLOAD lo special-casea el connector (buildCrudUpsert en upload-classify.ts):
// strip del id sintético + upsert por la PK natural (`onConflict:'animal_profile_id,field_definition_id'`).
// Esto es lo que M2.2 aprendió con los maneuver-events: el `ON CONFLICT` correcto NO es el del UP (PostgREST
// con un id inexistente = 42703) sino el del UP por la PK natural; el local sí puede `ON CONFLICT(id)`.
//
// AUDIT FORZADO server-side (R13.23, 0095): `updated_by` (=auth.uid()), `establishment_id` (=del PERFIL,
// anti-spoof) y `updated_at` los FUERZA el trigger en INSERT *Y* UPDATE → NUNCA se mandan en el write local.
// NUNCA se hardcodea establishment_id (multi-tenant). El gating capa 2 (0096, BEFORE INSERT OR UPDATE) +
// validación de value re-validan al SUBIR; un rechazo lo maneja uploadData (descarta + R10.8) — NO el return.

import { buildSetCustomAttributeUpsert } from './powersync/local-reads';
import { runLocalWrite } from './powersync/local-query';
import { serializeCustomValue, type CustomValue } from '../utils/custom-value';

// ─── Error / Result uniforme (mismo shape que events.ts) ─────────────────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type { CustomValue } from '../utils/custom-value';

export type SetCustomAttributeInput = {
  animalProfileId: string;
  fieldDefinitionId: string;
  /** Valor YA tipado según el ui_component (number/boolean/string/string[]). */
  value: CustomValue;
};

/**
 * UPSERT del current-value de una propiedad custom LOCAL (R13.12, offline, editable anytime) → upload queue.
 * UPSERT por la PK compuesta `(animal_profile_id, field_definition_id)`: re-llamar con el mismo par actualiza
 * el valor EN EL LUGAR (LWW), NO crea una 2da fila (sin historial). El `value` se serializa a jsonb TEXT
 * (serializeCustomValue, mismo helper que las measurements — número como número JSON, etc.). El gating capa 2
 * + la validación de value (0096) re-validan al SUBIR; `updated_by`/`establishment_id`/`updated_at` los fuerza
 * el trigger (R13.23). NO lleva `id` propio (PK compuesta → el id local es sintético; ver el banner).
 */
export async function setCustomAttribute(
  input: SetCustomAttributeInput,
): Promise<ServiceResult<true>> {
  const serialized = serializeCustomValue(input.value);
  if (!serialized.ok) {
    return { ok: false, error: { kind: 'unknown', message: serialized.message } };
  }
  const q = buildSetCustomAttributeUpsert(
    input.animalProfileId,
    input.fieldDefinitionId,
    serialized.json,
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}
