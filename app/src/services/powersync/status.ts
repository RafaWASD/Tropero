// status.ts — estado de conexión/sync del DB local consultable por la UI (T1.8 / R10.1).
//
// Lee el SyncStatus + la cola de upload de PowerSync y los traduce (vía status-derive, PURO) a un
// SyncUiState simple. Expone una lectura one-shot + una suscripción para que la UI muestre
// "sin conexión, se subirá después" / "sincronizando…" / "al día". El connector ya superficia los
// rechazos permanentes por separado (connector.ts::surfaceUploadRejection, R10.2).

import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { getPowerSync } from './database';
import { deriveSyncUiState, syncStatusLabel, type SyncUiState } from './status-derive';

/** Lee el estado de sync actual (one-shot) para la UI. */
export async function getSyncUiState(
  db: AbstractPowerSyncDatabase = getPowerSync(),
): Promise<SyncUiState> {
  const stats = await db.getUploadQueueStats(false);
  return deriveSyncUiState(db.currentStatus, stats.count);
}

/**
 * Se suscribe a los cambios de estado de sync. Llama a `onChange` con el SyncUiState cada vez que el
 * SyncStatus de PowerSync cambia. Devuelve un dispose para desuscribir. La cuenta de cola se relee en
 * cada cambio (best-effort: si falla, se reporta con la última cuenta conocida = 0).
 */
export function subscribeSyncUiState(
  onChange: (state: SyncUiState) => void,
  db: AbstractPowerSyncDatabase = getPowerSync(),
): () => void {
  const emit = () => {
    db.getUploadQueueStats(false)
      .then((stats) => onChange(deriveSyncUiState(db.currentStatus, stats.count)))
      .catch(() => onChange(deriveSyncUiState(db.currentStatus, 0)));
  };
  emit();
  return db.registerListener({ statusChanged: () => emit() });
}

// ─── Instrumentación de diagnóstico (spec 22, R22.23/R22.24) ─────────────────────────────
//
// Telemetría de DIAGNÓSTICO (no UI de usuario): loguea, en cada statusChanged de PowerSync, los flags de
// liveness de la conexión de descarga — `connected`, `dataFlowStatus.downloading`, `dataFlowStatus.uploading`
// y `lastSyncedAt`. En DEVICE es lo que confirma RC-1 cerrada: tras el trigger de reconexión (NetInfo
// offline→online / AppState background→active), `downloading` reengancha y `lastSyncedAt` avanza.
//
// ⚠️ VETO DEL LEADER (V2, 2026-07-22): NO gatear por `__DEV__`. El build de device de Raf es `preview-dev`
// (EAS), que puede compilar en release-mode → `__DEV__ === false` → la traza quedaría MUDA justo en el device
// donde la necesitamos para confirmar RC-1. Se gatea por una CONST DE MÓDULO en `true` AHORA (el diagnóstico
// debe correr en el build de device), y se APAGA (`false`) antes de dar la feature por cerrada para prod
// (reconciliación de cierre, design §11). No es UI de usuario; solo flags booleanos + timestamp → sin PII
// (R22.24), misma disciplina que logFirstSyncCounts.
const SYNC_DIAGNOSTICS_ENABLED = true; // ⚠️ flip a false antes de cerrar para prod (V2)

/**
 * Registra un listener de `statusChanged` que loguea los flags de liveness de la conexión de sync
 * (sin PII: solo booleanos + timestamp ISO). Devuelve un dispose para desuscribir. Con la const de módulo
 * en `false` es un no-op que devuelve un dispose inerte (R22.24: desactivable). Emite una vez al registrarse
 * para dejar el estado inicial en la traza.
 */
export function subscribeSyncDiagnostics(
  db: AbstractPowerSyncDatabase = getPowerSync(),
): () => void {
  if (!SYNC_DIAGNOSTICS_ENABLED) return () => {};
  const log = () => {
    const s = db.currentStatus;
    // eslint-disable-next-line no-console
    console.log('[powersync][diag]', {
      connected: s.connected,
      downloading: s.dataFlowStatus?.downloading,
      uploading: s.dataFlowStatus?.uploading,
      lastSyncedAt: s.lastSyncedAt?.toISOString(), // timestamp, NO PII (R22.24)
    });
  };
  log();
  return db.registerListener({ statusChanged: () => log() });
}

export { syncStatusLabel };
export type { SyncUiState };
