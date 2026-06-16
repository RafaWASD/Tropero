// maneuver-e2e-fault.ts — inyección de FALLA de persistencia SOLO para E2E (spec 03 bugfix tacto).
//
// Razón de existir: el fix del bug "no avanza" (carga.tsx) es que un fallo del write LOCAL de una maniobra
// NO se traga — se superficia un banner accionable y NO se avanza (R5.7/R10.8). Para tener una RED DE
// SEGURIDAD (e2e) de ese camino de error necesitamos forzar un fallo de persistencia de forma
// determinística, sin depender de romper el SQLite local (frágil) ni de un estado de DB real.
//
// FUERA de la superficie de producción (mismo patrón que `_components/ble-e2e-flag.ts`, vetado por Gate 2):
// la falla SOLO se arma si Playwright marcó `window.__RAFAQ_MANEUVER_FAULT__ = true` ANTES de cargar el
// bundle (vía `addInitScript`). En un build normal — dev o prod — la marca NO existe (ningún input de
// usuario ni ruta de UI la puede setear) → `maneuverPersistFaultArmed()` es SIEMPRE false → cero efecto.
// El consumidor (carga.tsx) chequea la marca y, si está armada, trata la captura como un fallo de write
// local (mismo path que un fallo real) UNA vez y la desarma. NO toca la DB, NO persiste nada.
//
// PURO de RN (solo lee/escribe globalThis): seguro de importar desde el frame.

const FAULT_GLOBAL_KEY = '__RAFAQ_MANEUVER_FAULT__';

/**
 * ¿Hay una falla de persistencia ARMADA para esta corrida E2E? true SOLO si Playwright marcó
 * `window.__RAFAQ_MANEUVER_FAULT__` antes de cargar el bundle. En producción/dev normal: false.
 * Consumir-y-desarmar: la 1ra captura tras armarla falla; la marca se borra → el reintento del operario
 * (o de la siguiente captura) procede normal (espeja "tocá de nuevo para reintentar").
 */
export function consumeManeuverPersistFault(): boolean {
  try {
    const g = globalThis as Record<string, unknown>;
    if (typeof globalThis === 'undefined' || g[FAULT_GLOBAL_KEY] !== true) return false;
    // Desarmar: la falla es de UN intento (el reintento debe pasar) → modela un fallo transitorio.
    g[FAULT_GLOBAL_KEY] = false;
    return true;
  } catch {
    return false;
  }
}

export const MANEUVER_FAULT_GLOBAL_KEY = FAULT_GLOBAL_KEY;
