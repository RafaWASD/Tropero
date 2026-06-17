// Captura de MANIOBRA / DATO CUSTOM append-only (spec 03 M5-C.1, R13.11 / R13.13).
//
// Service DELGADO y SWAPPABLE (espeja events.ts / maneuver-events.ts): mismo ServiceResult<T>/AppError. Una
// captura custom (`data_type='maniobra'`) = una fila append-only (time-series) en `custom_measurements`
// (0094) → una por captura, para seguimiento/gráficos (spec 07). CRUD-PLANO offline (spec 15): un INSERT
// LOCAL sobre la tabla SINCRONIZADA → PowerSync encola 1 CrudEntry → connector.uploadData() la sube al
// reconectar. La fila aparece LOCAL al instante; funciona SIN red.
//
// `value` es jsonb: el caller pasa el valor YA TIPADO según el `ui_component` del field_definition (number
// para numeric/numeric_stepped, boolean para boolean, string para text/date/enum_single, string[] para
// enum_multi). serializeCustomValue lo serializa a JSON TEXT (la columna value es jsonb→TEXT en el schema
// local). El número va como número JSON (no string), el bool como bool JSON, el enum_multi como array JSON.
//
// AUDIT FORZADO server-side (R13.23, 0094): `recorded_by` (=auth.uid()), `establishment_id` (=del PERFIL,
// anti-spoof) y `recorded_at` los FUERZA el trigger al SUBIR → NUNCA se mandan en el INSERT local (quedan
// NULL local; las lecturas no dependen de ellos). NUNCA se hardcodea establishment_id (multi-tenant).
//
// GATING capa 2 (M5-B.4 / 0096) re-valida server-side al SUBIR: si el field NO está enabled en el rodeo →
// rechazo (23514), y la validación de value por ui_component también (numeric con texto → 23514, etc.). El
// service NO replica el gating (capa 1 lo hace la UI de M5-C.2/C.3): solo escribe. Un rechazo lo maneja
// uploadData (descarta + superficia por el canal de R10.8) — NO el return de acá (que ya devolvió ok con la
// fila local). El client genera el `id` (crypto.randomUUID, columna id REAL de custom_measurements).

import {
  buildAddCustomMeasurementInsert,
  buildUpdateCustomMeasurement,
} from './powersync/local-reads';
import { runLocalWrite } from './powersync/local-query';
import { serializeCustomValue, type CustomValue } from '../utils/custom-value';

// ─── Error / Result uniforme (mismo shape que events.ts / maneuver-events.ts) ────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type { CustomValue } from '../utils/custom-value';

export type AddCustomMeasurementInput = {
  animalProfileId: string;
  fieldDefinitionId: string;
  /** Valor YA tipado según el ui_component (number/boolean/string/string[]). */
  value: CustomValue;
  /** Jornada de manga (R5.11) — opcional: la captura desde la ficha no la pasa. */
  sessionId?: string | null;
  notes?: string | null;
  /**
   * id de cliente OPCIONAL. Por default uno nuevo (append-only normal). Cuando el frame de carga rápida CORRIGE
   * la misma captura desde el resumen (R5.9), pasa el MISMO id + isCorrection:true → un UPDATE explícito de la
   * fila (no un 2do INSERT ni un upsert ON CONFLICT, que PowerSync no captura bien al exponer la tabla como view).
   */
  id?: string;
  /** true = corrección de una captura ya cargada (R5.9): UPDATE del value por id, no INSERT. Default false. */
  isCorrection?: boolean;
};

/**
 * Inserta una captura de maniobra/dato CUSTOM LOCAL (R13.11, offline) → upload queue. `id` de cliente
 * (crypto.randomUUID, columna id real). El `value` se serializa a jsonb TEXT (serializeCustomValue). El
 * gating capa 2 + la validación de value por ui_component (0096) re-validan al SUBIR; `recorded_by`/
 * `establishment_id`/`recorded_at` los fuerza el trigger (R13.23). Append-only: cada captura es una fila
 * nueva (NO se pisa el valor anterior — eso es custom_attributes/propiedad).
 */
export async function addCustomMeasurement(
  input: AddCustomMeasurementInput,
): Promise<ServiceResult<true>> {
  const serialized = serializeCustomValue(input.value);
  if (!serialized.ok) {
    return { ok: false, error: { kind: 'unknown', message: serialized.message } };
  }
  // Corrección desde el resumen (R5.9): UPDATE explícito del value por id (no INSERT/upsert). Requiere un id.
  const q =
    input.isCorrection && input.id
      ? buildUpdateCustomMeasurement(input.id, serialized.json)
      : buildAddCustomMeasurementInsert(
          input.id ?? randomUuid(),
          input.animalProfileId,
          input.fieldDefinitionId,
          serialized.json,
          input.sessionId ?? null,
          cleanStr(input.notes),
        );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Helpers (espejan events.ts) ──────────────────────────────────────────────────────────────

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** UUID v4 de cliente. crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
