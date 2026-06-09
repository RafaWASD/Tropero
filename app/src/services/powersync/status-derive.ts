// Lógica PURA de derivación del estado de sync para la UI (T1.8 / R10.1). SIN imports de RN/SDK →
// testeable con node:test. status.ts (I/O) lee el SyncStatus + la cola de PowerSync y delega acá la
// traducción a un estado simple que la UI consume ("sin conexión, se subirá después", etc.).

/** Estado de sync simplificado para la UI (R10.1). */
export type SyncUiState = {
  /** Conectado a la instancia PowerSync. */
  connected: boolean;
  /** Sincronizando activamente (subiendo o bajando cambios). */
  syncing: boolean;
  /** Cantidad de operaciones pendientes en la cola de upload (0 = todo subido). */
  pendingCount: number;
  /** ¿Ya hubo al menos un sync completo? (false en primer arranque sin red — R5.4). */
  hasSynced: boolean;
};

/** Subset del SyncStatus de PowerSync que precisamos (evita acoplar el tipo del SDK acá). */
export type SyncStatusLike = {
  connected?: boolean;
  connecting?: boolean;
  hasSynced?: boolean;
  dataFlowStatus?: { downloading?: boolean; uploading?: boolean };
};

/**
 * Deriva el estado de UI a partir del SyncStatus de PowerSync + la cantidad de ops en cola. PURA
 * (testeable). `syncing` = subiendo O bajando (cualquier flujo activo). `pendingCount` se clampa a
 * ≥ 0 (defensivo). Tolera campos ausentes (defaults seguros: desconectado, sin sync, 0 en cola).
 */
export function deriveSyncUiState(
  status: SyncStatusLike | null | undefined,
  uploadQueueCount: number,
): SyncUiState {
  const s = status ?? {};
  const flow = s.dataFlowStatus ?? {};
  const count = Number.isFinite(uploadQueueCount) ? Math.max(0, Math.trunc(uploadQueueCount)) : 0;
  return {
    connected: s.connected === true,
    syncing: flow.downloading === true || flow.uploading === true,
    pendingCount: count,
    hasSynced: s.hasSynced === true,
  };
}

/**
 * Copy es-AR de una sola línea para la UI a partir del estado derivado. PURA. Cubre los casos que la
 * UI necesita mostrar en el camino de campo:
 *   - offline con cola pendiente → "se subirá después";
 *   - offline sin cola → "sin conexión";
 *   - sincronizando → "sincronizando…";
 *   - conectado y al día → "al día".
 */
export function syncStatusLabel(state: SyncUiState): string {
  if (!state.connected) {
    return state.pendingCount > 0
      ? `Sin conexión: ${state.pendingCount} cambio(s) se subirán cuando vuelva la red.`
      : 'Sin conexión.';
  }
  if (state.syncing) return 'Sincronizando…';
  if (state.pendingCount > 0) return `Subiendo ${state.pendingCount} cambio(s)…`;
  return 'Al día.';
}
