// Gate del MODO DEMO del bastón (RMV4.4/4.5, triple-guard 2; design §5 Guard 2). PURO respecto
// de RN/expo: solo lee el global + `__DEV__` + (perezosamente) el flag de build → importable
// desde node:test. Replica y ENDURECE el patrón del bridge E2E (`__MITROPERO_BLE_E2E__`): la marca la
// pone deliberadamente el operador ANTES del bundle (addInitScript en web / `extra.demoBuild` del
// perfil de demo en nativo); NO hay camino desde la UI ni desde ningún input de usuario.
//
// Integridad SENASA (RMV4.7): un build de PRODUCCIÓN/PREVIEW no tiene `__DEV__` ni el flag de
// demo → `isDemoMode()` es false → el simulador es imposible de instanciar (triple-guard). Un EID
// simulado NUNCA se declara como real.

const DEMO_GLOBAL_KEY = '__MITROPERO_BLE_DEMO__';
// Marca de E2E del bastón (la pone Playwright con addInitScript ANTES del bundle, análoga a la de
// producción-safe del bridge E2E). En un contexto E2E/captura (no-prod) habilitamos el "build allowed"
// del gate demo para poder ejercitar el simulador en la suite/captura. `__MITROPERO_BLE_DEMO_ALLOW_E2E__`
// es un override explícito (si es booleano, gana); si no está, se usa `__MITROPERO_BLE_E2E__ === true`.
const E2E_GLOBAL_KEY = '__MITROPERO_BLE_E2E__';
const E2E_DEMO_ALLOW_KEY = '__MITROPERO_BLE_DEMO_ALLOW_E2E__';

/**
 * ¿Estamos en entorno de dev? Lee el global `__DEV__` de RN de forma tolerante. En node:test
 * `__DEV__` no está declarado → `typeof` lo cubre sin ReferenceError (patrón feedback.ts /
 * ble-e2e-flag.ts). Los tests pueden simularlo seteando `globalThis.__DEV__`.
 */
function isDevEnv(): boolean {
  try {
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
  } catch {
    return false;
  }
}

/**
 * ¿Es un BUILD DE DEMO EXPLÍCITO? (design §5 Guard 2: "dev O build de demo explícito"). Lee un
 * flag de build dedicado (`Constants.expoConfig.extra.demoBuild === true`), seteado SOLO en un
 * perfil de build 'demo' — NUNCA en production/preview. Import PEREZOSO de expo-constants (patrón
 * feedback.ts: `require` guardado, no top-level) para que este módulo siga importable desde
 * node:test sin arrastrar expo. Cualquier falla / ausencia del flag → false (fail-closed).
 */
function isExplicitDemoBuild(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-constants') as {
      default?: { expoConfig?: { extra?: Record<string, unknown> } };
    };
    return mod?.default?.expoConfig?.extra?.demoBuild === true;
  } catch {
    return false;
  }
}

/**
 * ¿Estamos en un contexto de E2E/CAPTURA del bastón? (no-prod). Habilita el "build allowed" del gate
 * demo para ejercitar el simulador en la suite/captura. La marca la pone Playwright (addInitScript)
 * ANTES del bundle — NO hay camino desde la UI ni desde input de usuario, y NUNCA está en el bundle de
 * producción/preview → prod-safe. Override explícito `__MITROPERO_BLE_DEMO_ALLOW_E2E__` (si es booleano
 * gana); si no, se usa `__MITROPERO_BLE_E2E__ === true`. `typeof globalThis` guard (safe en node).
 */
function isE2eDemoAllowed(): boolean {
  try {
    if (typeof globalThis === 'undefined') return false;
    const g = globalThis as Record<string, unknown>;
    const override = g[E2E_DEMO_ALLOW_KEY];
    if (typeof override === 'boolean') return override;
    return g[E2E_GLOBAL_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * ¿El BUILD permite el modo demo? (design §5 Guard 2). true SOLO en dev O en un build de demo
 * explícito O en un contexto E2E/captura (no-prod); NUNCA en producción/preview. Es la mitad "de
 * build" del gate: aunque la marca global estuviera puesta, un build de prod no habilita la demo
 * (no tiene `__DEV__`, ni `extra.demoBuild`, ni `__MITROPERO_BLE_E2E__`).
 */
export function isDemoBuildAllowed(): boolean {
  return isDevEnv() || isExplicitDemoBuild() || isE2eDemoAllowed();
}

/**
 * ¿Estamos en MODO DEMO del bastón? (RMV4.4, triple-guard 2). true SOLO si:
 *   (1) la marca global `__MITROPERO_BLE_DEMO__` está puesta deliberadamente ANTES del bundle, Y
 *   (2) el build lo permite (dev o build de demo explícito, `isDemoBuildAllowed()`).
 * En producción/preview alguna de las dos falla → false → el simulador no se puede instanciar
 * (triple-guard 1/3 lo re-verifican). No seteable desde UI/input.
 */
export function isDemoMode(): boolean {
  try {
    return (
      typeof globalThis !== 'undefined' &&
      (globalThis as Record<string, unknown>)[DEMO_GLOBAL_KEY] === true &&
      isDemoBuildAllowed()
    );
  } catch {
    return false;
  }
}

/** Nombre de la marca global (para el host-level que la setea bajo el gate, análogo a E2E). */
export const BLE_DEMO_GLOBAL_KEY = DEMO_GLOBAL_KEY;
