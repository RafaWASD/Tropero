// stick-status-surface — QUIÉN está mostrando el estado del bastón en la pantalla que se ve AHORA.
//
// ── EL DEFECTO QUE CIERRA (pedido de Raf, 2026-08-06) ───────────────────────────────────────────────
// El indicador GLOBAL del chrome (`StickStatusIndicator`, RMV3.5) se monta sobre TODA la app, así que en
// las pantallas que YA muestran el estado del bastón el mismo dato aparece DOS VECES: el chip del header
// de `(tabs)/animales` y el de `maniobra/identificar` dicen "Bastón conectado" y el indicador global
// repite lo mismo en la misma pantalla. Repetir un dato no lo hace más visible: lo vuelve ruido, y en la
// manga el ruido cuesta tiempo.
//
// ── POR QUÉ UN RECLAMO Y NO UNA LISTA DE RUTAS ──────────────────────────────────────────────────────
// La forma obvia sería una lista de literales (`['/animales', '/maniobra/identificar']`) adentro del
// indicador. Ya nos mordió esa forma: es la misma clase de bug que `BLE_OWNED_ROUTES` (ver la
// reconciliación de RMV3.1 en `requirements-multivendor.md`) — **la propiedad la declara el DUEÑO, no una
// lista de strings que vive en otro archivo**. Mover el archivo de ruta, renombrarla o montar el chip en
// una pantalla nueva rompe la lista EN SILENCIO: el indicador global vuelve a duplicar y nadie se entera.
// El indicador tenía ADEMÁS un literal propio (`pathname === '/baston'`), que esta unidad borra: ahora la
// pantalla de conexión reclama como cualquier otra superficie.
//
// Acá la señal la emite la superficie que muestra el estado: mientras está enfocada, RECLAMA el lugar y
// el indicador global se calla. Una pantalla nueva que muestre el estado hereda el comportamiento con una
// línea, y el guard `stick-status-surface-guard.test.ts` la obliga a decidir (todo call site de
// `useBleConnectionStatus()` tiene que reclamar o estar registrado con su motivo).
//
// ── POR QUÉ ESTE ARCHIVO NO IMPORTA `expo-router` (y el hook de reclamo vive en otro) ───────────────
// `import('expo-router')` NO carga en node puro (`SyntaxError: Unexpected token 'typeof'` — el paquete se
// publica sin transpilar). Un módulo que lo importe queda FUERA de `node:test`, que es donde se verifican
// las reglas de este store (N reclamos simultáneos, liberación en cualquier orden, idempotencia). Por eso
// acá está el store + el hook de LECTURA (solo `react`, que sí carga), y el hook de RECLAMO —el único que
// necesita `useFocusEffect`— vive en `src/hooks/useStickStatusSurface.ts`.
//
// El store es un módulo (no un contexto de React) a propósito: el reclamo viaja HACIA ARRIBA del árbol
// —de una pantalla hacia el chrome que la contiene— y un contexto solo viaja hacia abajo. Mismo patrón
// observable que `services/powersync/upload-rejections.ts`.

import { useSyncExternalStore } from 'react';

/**
 * Qué clase de superficie reclama el lugar. NO cambia el comportamiento (cualquier reclamo calla al
 * indicador global): existe para que el reclamo diga QUÉ lo está reemplazando, en el store y en el guard.
 */
export type StickStatusSurfaceKind =
  /** Chip de estado en el header de una pantalla (`BleConnectionChip`: animales · maniobra/identificar). */
  | 'header-chip'
  /** Card de estado a pantalla completa (`StickConnectionScreen`, la propia `/baston`). */
  | 'screen-card'
  /**
   * La pantalla NO muestra el estado, pero **ya usa la banda donde vive el indicador global** (debajo de
   * la fila del header, a la derecha): un buscador a ancho completo pegado al header, un header de
   * identidad con su propio chip a la derecha. Reclamar acá evita que el chrome se dibuje ENCIMA de algo
   * legible — es el mismo mecanismo, con el otro motivo, y por eso viaja con su propia clase: en el
   * registro del guard se distingue "ya lo digo yo" de "acá no entra".
   */
  | 'screen-band';

/** Reclamos vivos. La clave es el token del llamador: N superficies pueden reclamar sin pisarse. */
const claims = new Map<object, StickStatusSurfaceKind>();
const listeners = new Set<() => void>();

/**
 * Snapshot INMUTABLE y estable: `useSyncExternalStore` compara por identidad, así que devolver un array
 * nuevo en cada lectura provocaría un re-render infinito. Se recalcula solo cuando el Map cambia.
 */
let snapshot: readonly StickStatusSurfaceKind[] = Object.freeze([]);

function refreshSnapshot(): void {
  snapshot = Object.freeze([...claims.values()]);
  // Copia defensiva: un listener puede desuscribirse durante la iteración.
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly StickStatusSurfaceKind[] {
  return snapshot;
}

/**
 * Reclama el lugar del indicador global. Devuelve la función que lo LIBERA (idempotente: liberar dos
 * veces no rompe ni deja el store desbalanceado).
 *
 * Imperativa a propósito: así el store se ejercita entero en `node:test` sin React ni navegación — que es
 * lo que permite verificar las reglas (N reclamos, liberación en cualquier orden, idempotencia) en vez de
 * confiar en que el hook "hace lo correcto".
 */
export function claimStickStatusSurface(kind: StickStatusSurfaceKind): () => void {
  const token = {};
  claims.set(token, kind);
  refreshSnapshot();
  return () => {
    if (!claims.delete(token)) return; // ya liberado: no re-emitir
    refreshSnapshot();
  };
}

/** Los reclamos vivos, en orden de llegada. Sin React (lo usan el hook, el test y el diagnóstico). */
export function getStickStatusSurfaceClaims(): readonly StickStatusSurfaceKind[] {
  return getSnapshot();
}

/** ¿Hay alguna superficie mostrando el estado del bastón ahora mismo? */
export function isStickStatusSurfaceClaimed(): boolean {
  return getSnapshot().length > 0;
}

/** Suscripción cruda al store (la usa el hook de lectura; expuesta para tests y diagnóstico). */
export function subscribeStickStatusSurfaces(listener: () => void): () => void {
  return subscribe(listener);
}

/** SOLO PARA TESTS: vacía el store (los reclamos son globales al proceso). */
export function _resetStickStatusSurfacesForTest(): void {
  claims.clear();
  refreshSnapshot();
}

/** Hook del INDICADOR GLOBAL: ¿alguien más está mostrando el estado en la pantalla enfocada? */
export function useStickStatusSurfaceClaimed(): boolean {
  // getServerSnapshot = getSnapshot: no hay SSR (el export web es client-only, `output: single`).
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).length > 0;
}
