// CURRENT-VALUE de una PROPIEDAD CUSTOM (spec 03 M5-C.1, R13.12 / R13.13).
//
// Service DELGADO y SWAPPABLE (espeja events.ts / custom-measurements.ts). Una propiedad custom
// (`data_type='propiedad'`) NO tiene historial: una fila por `(animal_profile_id, field_definition_id)` con
// el VALOR ACTUAL, editable en cualquier momento (R13.12) — patrón `teeth_state` pero en una tabla genérica.
// UPSERT por la PK compuesta: re-editar el mismo par PISA el valor (no agrega historial).
//
// ⚠️ GOTCHA de current-value offline de PowerSync (resuelto). `custom_attributes` (0095) tiene PK COMPUESTA
// `(animal_profile_id, field_definition_id)` y NO tiene columna `id` real; la stream le da un `id` SINTÉTICO
// (`animal_profile_id || ':' || field_definition_id`) para el DOWN. El write LOCAL NO puede usar
// `INSERT ... ON CONFLICT(id) DO UPDATE`: PowerSync expone la tabla como VIEW → el upsert falla con "cannot
// UPSERT a view". El primer intento (UPDATE-luego-INSERT-si-rowsAffected==0) tenía un bug: el `rowsAffected` de
// un UPDATE sobre la VIEW vía INSTEAD OF trigger NO es confiable (SQLite no cuenta los cambios de un trigger
// program; en la web wa-sqlite un UPDATE de fila SINCRONIZADA reporta 0 aunque matchee) → caía a un INSERT
// plano que COLISIONABA con la PK sintética de una fila creada en el ALTA (UNIQUE constraint failed —
// testeo en vivo 2026-06-29). Por eso el service decide UPDATE vs INSERT por un SELECT DETERMINISTA del id
// sintético (buildCustomAttributeExistsQuery), NO por rowsAffected → current-value EN EL LUGAR (LWW), sin
// duplicar. El UPLOAD lo special-casea el connector (buildCrudUpsert/buildCrudPatch en upload-classify.ts):
// strip del id sintético + upsert/filtro por la PK natural (`onConflict:'animal_profile_id,field_definition_id'`).
//
// AUDIT FORZADO server-side (R13.23, 0095): `updated_by` (=auth.uid()), `establishment_id` (=del PERFIL,
// anti-spoof) y `updated_at` los FUERZA el trigger en INSERT *Y* UPDATE → NUNCA se mandan en el write local.
// NUNCA se hardcodea establishment_id (multi-tenant). El gating capa 2 (0096, BEFORE INSERT OR UPDATE) +
// validación de value re-validan al SUBIR; un rechazo lo maneja uploadData (descarta + R10.8) — NO el return.

import {
  buildCustomAttributesQuery,
  buildCustomAttributeExistsQuery,
  buildInsertCustomAttribute,
  buildUpdateCustomAttribute,
} from './powersync/local-reads';
import { runLocalQuery, runLocalWrite } from './powersync/local-query';
import { serializeCustomValue, type CustomValue } from '../utils/custom-value';
import { parseCustomOptions, parseCustomValueJson, type CustomCaptureValue } from '../utils/custom-render';
import type { CustomUiComponent } from '../utils/custom-field';

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
  // SELECT-existencia-luego-UPDATE-o-INSERT (NO upsert ON CONFLICT, NO rowsAffected): PowerSync expone
  // custom_attributes como VIEW → un `ON CONFLICT … DO UPDATE` falla con "cannot UPSERT a view", Y el
  // `rowsAffected` de un UPDATE sobre la view vía INSTEAD OF trigger NO es confiable — SQLite no cuenta los
  // cambios de un trigger program (`sqlite3_changes()`) y en la web (wa-sqlite) un UPDATE de fila SINCRONIZADA
  // reporta 0 aunque matchee. Confiar en él hacía caer a un INSERT plano que COLISIONABA con la PK sintética de
  // una fila creada en el ALTA (UNIQUE constraint failed: ps_data__custom_attributes.id — bug del testeo en
  // vivo 2026-06-29). Por eso decidimos UPDATE vs INSERT por un SELECT DETERMINISTA del id sintético. La
  // semántica LWW se mantiene (existe → pisar; no existe → crear). En un único device la carrera read/write es
  // inocua (el operario edita una propiedad de a una).
  const exists = await runLocalQuery<{ one: number }>(
    buildCustomAttributeExistsQuery(input.animalProfileId, input.fieldDefinitionId),
    { emptyIsSyncing: false },
  );
  if (!exists.ok) return { ok: false, error: { kind: exists.error.kind, message: exists.error.message } };
  if (exists.value.length > 0) {
    // Ya hay un current-value para ese (animal, field) → UPDATE (pisa el valor, sin historial).
    const upd = await runLocalWrite(
      buildUpdateCustomAttribute(input.animalProfileId, input.fieldDefinitionId, serialized.json),
    );
    if (!upd.ok) return { ok: false, error: { kind: upd.error.kind, message: upd.error.message } };
    return { ok: true, value: true };
  }
  // No existía la fila → INSERT (1ra captura del par animal+field).
  const ins = await runLocalWrite(
    buildInsertCustomAttribute(input.animalProfileId, input.fieldDefinitionId, serialized.json),
  );
  if (!ins.ok) return { ok: false, error: { kind: ins.error.kind, message: ins.error.message } };
  return { ok: true, value: true };
}

// ─── Lectura: current-values de las propiedades custom de un animal (R13.10/R13.12, ficha) ──────

const UI_COMPONENTS = new Set<string>([
  'numeric',
  'numeric_stepped',
  'enum_single',
  'enum_multi',
  'text',
  'boolean',
  'date',
]);

/** Un current-value de propiedad custom de un animal, ya parseado por su ui_component (para la ficha). */
export type CustomAttributeValue = {
  fieldDefinitionId: string;
  dataKey: string;
  label: string;
  uiComponent: CustomUiComponent;
  /** Opciones del enum (enum_single/enum_multi); [] para los demás (para precargar el editor). */
  options: string[];
  /** El valor actual ya tipado (null si el value es incoherente con el ui_component — la ficha muestra "—"). */
  value: CustomCaptureValue | null;
};

type AttributeRow = {
  field_definition_id: string;
  value: unknown;
  ui_component: string;
  config_schema: unknown;
  label: string;
  data_key: string;
};

/**
 * Lee los CURRENT-VALUES de las propiedades custom VIVAS de un animal (R13.10/R13.12), para MOSTRARLOS en la
 * ficha y precargar el editor. Usa `buildCustomAttributesQuery` (INNER JOIN a field_definitions, que filtra
 * `deleted_at IS NULL AND active = 1`).
 *
 * R13.30 bajo OPCIÓN B (MVP, Raf 2026-06-20): tras borrar un dato custom, su definición se prunea del device →
 * el INNER JOIN no devuelve fila → la propiedad DEJA DE VERSE en la ficha (desaparición prolija, sin crash). La
 * confirmación de borrado lo ADVIERTE (R13.31). La Opción A (preservar el histórico quitando el filtro de la
 * stream) queda como fast-follow/backlog. El value jsonb se parsea por el ui_component (TOLERANTE; un value
 * incompatible cae a null = "—"). Read-only, local (offline). Vacío legítimo NO degrada a "Sincronizando…".
 */
export async function fetchCustomAttributes(
  profileId: string,
): Promise<ServiceResult<CustomAttributeValue[]>> {
  const r = await runLocalQuery<AttributeRow>(buildCustomAttributesQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return {
    ok: true,
    value: r.value.map((row) => {
      const uiComponent = UI_COMPONENTS.has(row.ui_component)
        ? (row.ui_component as CustomUiComponent)
        : 'text';
      return {
        fieldDefinitionId: row.field_definition_id,
        dataKey: row.data_key,
        label: row.label,
        uiComponent,
        options: parseCustomOptions(row.config_schema),
        value: parseCustomValueJson(row.value, uiComponent),
      };
    }),
  };
}
