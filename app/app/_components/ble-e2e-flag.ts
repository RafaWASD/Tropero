// Flag de E2E del bastón (spec 09 chunk BLE global, §7.2). Decide si el provider de la RAÍZ monta el
// MockAdapter (mode='mock') para que Playwright pueda inyectar bastonazos vía un handle en `window`.
// FUERA de la superficie de producción: en un build normal este flag SIEMPRE es false → el provider
// elige el transporte real (web-serial/manual) y NO existe ningún handle en `window`.
//
// Por qué un flag explícito (no NODE_ENV): el bundle web puede correr en modo dev (Metro) igual que el
// de E2E. El discriminador es una marca DELIBERADA que solo Playwright pone ANTES de cargar la app (vía
// `addInitScript` → setea `window.__RAFAQ_BLE_E2E__ = true` antes del bundle). Sin esa marca, `isBleE2E()`
// es false. La marca NO se puede setear desde la UI ni desde un input de usuario → no hay camino para que
// un usuario real la active. Gate 2 revisa esta superficie. Vive en _components/ (host-level), NO en
// services/ble/ (que es firma de spec 04, no se toca).
//
// PURO de RN (solo lee globalThis): seguro de importar desde el provider de la raíz y desde el bridge.

const E2E_GLOBAL_KEY = '__RAFAQ_BLE_E2E__';

/**
 * ¿Estamos en una corrida E2E del bastón? true SOLO si Playwright marcó `window.__RAFAQ_BLE_E2E__` antes
 * de cargar el bundle. En producción/dev normal: false (sin marca → transporte real, sin handle).
 */
export function isBleE2E(): boolean {
  try {
    return (
      typeof globalThis !== 'undefined' &&
      (globalThis as Record<string, unknown>)[E2E_GLOBAL_KEY] === true
    );
  } catch {
    return false;
  }
}

// Flag SECUNDARIO de E2E: fuerza el sub-estado "manual promovido" del hero adaptativo de la manga
// (spec 03 M2.1, transport==null) → el provider monta SIN transporte buildable (solo el piso manual). Es
// el ÚNICO modo en que el sub-estado manual-first es reproducible en web (el mock siempre tiene transporte).
// SOLO se honra si TAMBIÉN está `isBleE2E()` (doble gate): en producción/dev normal ninguna de las dos
// marcas existe → false → transporte real. NO se puede setear desde la UI ni desde un input → sin camino de
// usuario. Lo pone Playwright con addInitScript antes del bundle, igual que la marca principal.
const E2E_MANUAL_GLOBAL_KEY = '__RAFAQ_BLE_E2E_MANUAL__';

/** ¿Forzar el modo manual-first (sin transporte) en la corrida E2E? Solo si además isBleE2E(). */
export function isBleE2EManual(): boolean {
  try {
    return (
      isBleE2E() &&
      (globalThis as Record<string, unknown>)[E2E_MANUAL_GLOBAL_KEY] === true
    );
  } catch {
    return false;
  }
}

export const BLE_E2E_GLOBAL_KEY = E2E_GLOBAL_KEY;
export const BLE_E2E_MANUAL_GLOBAL_KEY = E2E_MANUAL_GLOBAL_KEY;
export const BLE_E2E_HANDLE_KEY = '__rafaqBle';
