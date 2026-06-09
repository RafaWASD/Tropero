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

export { syncStatusLabel };
export type { SyncUiState };
