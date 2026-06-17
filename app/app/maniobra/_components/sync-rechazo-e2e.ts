// sync-rechazo-e2e.ts — inyección de un RECHAZO DE SYNC SOLO para E2E (spec 03 R10.8 / M4.2).
//
// Razón de existir: el surfacing de rechazos (R10.8) se dispara desde `connector.uploadData` cuando el
// server RECHAZA de forma PERMANENTE un upload (gating capa 2 `23514` / RLS `42501` / tenant-check). Forzar
// un rechazo SERVER-SIDE real en un e2e sería frágil y lento (habría que romper la config de un rodeo entre
// el INSERT offline y el sync). Para tener una RED DE SEGURIDAD del camino de UI (banner → sheet → Entendido)
// inyectamos un rechazo determinístico en el store, sin tocar la DB ni el connector.
//
// FUERA de la superficie de producción (mismo patrón gated que `maneuver-e2e-fault.ts` / `ble-e2e-flag.ts`,
// vetado por Gate 2): la inyección SOLO ocurre si Playwright marcó `window.__RAFAQ_SYNC_REJECT_E2E__` ANTES
// de cargar el bundle (vía `addInitScript`). En un build normal — dev o prod — la marca NO existe (ningún
// input de usuario ni ruta de UI la puede setear) → `consumeSyncRejectE2E()` es SIEMPRE null → cero efecto.
// El consumidor (el landing de maniobra) chequea la marca UNA vez al enfocar y, si está armada, registra un
// rechazo de maniobra en el store (vía recordUploadRejection) y la desarma. NO toca la DB, NO persiste nada.
//
// PURO de RN (solo lee/escribe globalThis): seguro de importar desde el landing.

const REJECT_GLOBAL_KEY = '__RAFAQ_SYNC_REJECT_E2E__';

/** Forma de la marca E2E: la op rechazada (table/op/id) + el errcode. Default razonable si viene `true`. */
export type SyncRejectE2EPayload = {
  id: string;
  table: string;
  op: string;
  code: string;
};

/**
 * ¿Hay un rechazo de sync ARMADO para esta corrida E2E? Devuelve el payload (consumiéndolo: la marca se
 * desarma) SOLO si Playwright la puso antes del bundle. En producción/dev normal: null (sin marca).
 * Si la marca es `true` (no un objeto), se usa un rechazo de maniobra por defecto (gating `23514`).
 */
export function consumeSyncRejectE2E(): SyncRejectE2EPayload | null {
  try {
    const g = globalThis as Record<string, unknown>;
    if (typeof globalThis === 'undefined') return null;
    const mark = g[REJECT_GLOBAL_KEY];
    if (mark == null || mark === false) return null;
    // Desarmar (consumir-y-desarmar): no re-inyectar en cada focus.
    g[REJECT_GLOBAL_KEY] = false;
    if (mark === true) {
      return { id: 'e2e-reject-1', table: 'weight_events', op: 'PUT', code: '23514' };
    }
    const m = mark as Partial<SyncRejectE2EPayload>;
    return {
      id: typeof m.id === 'string' && m.id ? m.id : 'e2e-reject-1',
      table: typeof m.table === 'string' && m.table ? m.table : 'weight_events',
      op: typeof m.op === 'string' && m.op ? m.op : 'PUT',
      code: typeof m.code === 'string' && m.code ? m.code : '23514',
    };
  } catch {
    return null;
  }
}

export const SYNC_REJECT_E2E_GLOBAL_KEY = REJECT_GLOBAL_KEY;
