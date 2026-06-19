// Circunferencia escrotal (CE) del toro — write-path + lectura del histórico (spec 03 M6, US-14).
//
// Service DELGADO y SWAPPABLE (espeja events.ts addWeight/addConditionScore + custom-measurements.ts):
// mismo ServiceResult<T>/AppError. Una CE = una medición puntual append-only (time-series) en la tabla
// TIPADA `scrotal_measurements` (0098) → una fila por captura, para el seguimiento longitudinal (tarjeta
// de tendencia de la ficha, R14.14, M6-C.2). CRUD-PLANO offline (spec 15, R14.10): un INSERT LOCAL sobre la
// tabla SINCRONIZADA → PowerSync encola 1 CrudEntry → connector.uploadData() la sube al reconectar. La fila
// aparece LOCAL al instante; funciona SIN red.
//
// AUDIT FORZADO server-side (R14.9, 0098): `recorded_by` (=auth.uid()), `establishment_id` (=del PERFIL,
// anti-spoof, reusa tg_force_establishment_id_from_profile 0077) y `source` (default 'manual') los pone el
// trigger/default al SUBIR → NUNCA se mandan en el INSERT local (quedan NULL local; las lecturas no dependen
// de ellos). NUNCA se hardcodea establishment_id (multi-tenant desde día 1).
//
// GATING capa 2 (0100 `tg_scrotal_gating` → assert_data_keys_enabled 'circunferencia_escrotal') + el
// tenant-check del `session_id` (tg_event_session_tenant_check, 0052) re-validan server-side al SUBIR
// (fail-closed). El service NO replica el gating (capa 1 = la aplicabilidad/UI). Un rechazo lo maneja
// uploadData (descarta + superficia por R10.8, scrotal_measurements está en MANEUVER_TABLE_LABELS) — NO el
// return de acá (que ya devolvió ok con la fila local). El client genera el `id` (crypto.randomUUID).
//
// NOTA: en el FRAME de carga rápida (carga.tsx) la CE se persiste por el ORQUESTADOR (maneuver-events.ts →
// buildManeuverEventQueries case 'scrotal' → buildAddScrotalInsert), igual que las otras maniobras tipadas.
// Este service expone `addScrotalMeasurement` como API directa (write-path R14.10 documentado + el camino de
// la ficha en M6-C.2) y la lectura `fetchScrotalHistory`/`fetchLastScrotalCm` (valor inicial de la rueda,
// R14.5 + tarjeta de tendencia, R14.14).

import {
  buildAddScrotalInsert,
  buildScrotalHistoryQuery,
} from './powersync/local-reads';
import { runLocalQuery, runLocalWrite } from './powersync/local-query';

// ─── Error / Result uniforme (mismo shape que events.ts / custom-measurements.ts) ────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type AddScrotalMeasurementInput = {
  profileId: string;
  /** CE en cm ∈ [20,50] paso 0,5 (la rueda lo snapea/clampa; el CHECK del DB re-valida al subir). */
  circumferenceCm: number;
  /** Edad snapshot confirmada en meses, o null si quedó desconocida (R14.7/R14.8). */
  ageMonths: number | null;
  /** ISO 'YYYY-MM-DD' (measured_at NOT NULL). */
  measuredAt: string;
  /** Jornada de manga (R14.10/R5.11) — opcional: la captura desde la ficha (M6-C.2) no la pasa. */
  sessionId?: string | null;
  /** id de cliente OPCIONAL (crypto.randomUUID por default). Un id estable permite re-confirmar sin duplicar. */
  id?: string;
};

/** Una fila del histórico de CE (lectura local). circumference_cm float, age_months snapshot nullable. */
export type ScrotalMeasurementRow = {
  id: string;
  circumferenceCm: number;
  ageMonths: number | null;
  measuredAt: string;
  sessionId: string | null;
  createdAt: string | null;
};

/**
 * Inserta una CE LOCAL (R14.10, offline) → upload queue. `id` de cliente (crypto.randomUUID, columna id
 * real). `establishment_id`/`recorded_by`/`source` los fuerza el trigger/default server-side (R14.9). El
 * gating capa 2 + el tenant-check (0100/0052) re-validan al SUBIR. Append-only: cada captura es una fila
 * nueva (NO se pisa la anterior — el seguimiento longitudinal las quiere todas).
 */
export async function addScrotalMeasurement(
  input: AddScrotalMeasurementInput,
): Promise<ServiceResult<true>> {
  const q = buildAddScrotalInsert(
    input.id ?? randomUuid(),
    input.profileId,
    input.circumferenceCm,
    input.ageMonths,
    input.measuredAt,
    input.sessionId ?? null,
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

/**
 * Histórico de CE de un animal (lectura LOCAL, offline), más reciente primero (R14.14 tarjeta de tendencia;
 * R14.5 valor inicial de la rueda = la 1ra fila). `emptyIsSyncing:false`: un animal sin CE es un caso de
 * negocio legítimo (la 1ra medición), no falta de sync → devolvemos [] sin degradar a "sincronizando".
 */
export async function fetchScrotalHistory(
  profileId: string,
): Promise<ServiceResult<ScrotalMeasurementRow[]>> {
  const r = await runLocalQuery<ScrotalRowRaw>(buildScrotalHistoryQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value.map(mapRow) };
}

/**
 * La ÚLTIMA CE medida del animal en cm (R14.5 — valor inicial de la rueda), o `null` si es la primera
 * medición. El frame usa `?? CE_DEFAULT_CM` (36) cuando es null. Lectura LOCAL (offline). Un error de
 * lectura → null (la rueda arranca en el default, no se rompe la carga).
 */
export async function fetchLastScrotalCm(profileId: string): Promise<number | null> {
  const r = await fetchScrotalHistory(profileId);
  if (!r.ok || r.value.length === 0) return null;
  return r.value[0].circumferenceCm;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

/** Forma cruda de la fila tal como la devuelve SQLite (REAL/INTEGER/TEXT). */
type ScrotalRowRaw = {
  id: string;
  circumference_cm: number | string | null;
  age_months: number | string | null;
  measured_at: string | null;
  session_id: string | null;
  created_at: string | null;
};

function mapRow(r: ScrotalRowRaw): ScrotalMeasurementRow {
  return {
    id: r.id,
    circumferenceCm: toNum(r.circumference_cm) ?? 0,
    ageMonths: toNum(r.age_months),
    measuredAt: r.measured_at ?? '',
    sessionId: r.session_id,
    createdAt: r.created_at,
  };
}

/** SQLite puede devolver REAL/INTEGER como number o, según el driver, como string → normalizamos a number. */
function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** UUID v4 de cliente. crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
