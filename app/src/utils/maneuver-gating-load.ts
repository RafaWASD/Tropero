// Lógica PURA del ciclo de vida de carga del gating de un rodeo (stale-while-revalidate).
// Sin RN, sin red, sin React: testeable con node:test (mismo patrón que maneuver-gating.ts).
//
// PROBLEMA QUE RESUELVE (bug s27, Raf en `pnpm web`): `useManeuverGating` re-carga el config del rodeo al
// ENFOCAR y en CADA avance de sync de PowerSync. Si cada carga flipea `loading=true`, la pantalla de carga
// rápida (carga.tsx) cae a su spinner full-screen, DESMONTA el paso en curso (PesajeStep) y PIERDE lo
// tecleado. Un sync de fondo no debería blanquear la UI ni borrar datos en curso.
//
// PATRÓN (stale-while-revalidate):
//   - Carga INICIAL del rodeo (todavía no tenemos config para ESE rodeo) → mostramos `loading` (no hay nada
//     que mostrar todavía).
//   - Revalidación en BACKGROUND del MISMO rodeo (focus / sync) → NO flipear `loading`: mantenemos el config
//     previo visible y refrescamos en silencio. La UI no parpadea, el paso en curso NO se desmonta.
//   - CAMBIO de rodeo (rodeoId distinto al que ya cargamos) → SÍ `loading` (el config viejo no aplica al
//     rodeo nuevo; mostrar el stale de otro rodeo sería incorrecto).
//
// El "rodeo para el que ya tenemos config" lo lleva el hook en un useRef (`loadedRodeoRef`); este módulo solo
// decide, sin estado propio.

/**
 * ¿Debe `loading` flipear a `true` ANTES de disparar este fetch del gating del rodeo?
 *
 * @param targetRodeoId  El rodeo para el que vamos a cargar el config ahora (null = no hay rodeo).
 * @param loadedRodeoId  El rodeo para el que YA tenemos config cargado (null = ninguno todavía).
 * @returns `true` solo si es la carga INICIAL para `targetRodeoId` (no tenemos su config aún) → mostrar
 *          loading. `false` si es una revalidación en background del MISMO rodeo (config ya visible) →
 *          refrescar en silencio sin parpadear.
 *
 * Nota: con `targetRodeoId === null` (no hay rodeo) no hay fetch que disparar; el caller cortocircuita antes.
 * Por consistencia devolvemos `false` (no hay nada que cargar → no mostramos loading).
 */
export function shouldShowLoadingForLoad(
  targetRodeoId: string | null,
  loadedRodeoId: string | null,
): boolean {
  if (targetRodeoId === null) return false;
  // Carga inicial para este rodeo (incluye el caso loadedRodeoId === null): mostrar loading.
  // Revalidación del mismo rodeo (loadedRodeoId === targetRodeoId): silenciosa.
  return loadedRodeoId !== targetRodeoId;
}

/**
 * El valor INICIAL de `loading` al montar el hook con `rodeoId`. Si hay rodeo, arrancamos cargando (aún no
 * tenemos config); si no hay rodeo, no hay nada que cargar. Espeja la regla de arriba con loadedRodeoId=null.
 */
export function initialLoadingFor(rodeoId: string | null): boolean {
  return shouldShowLoadingForLoad(rodeoId, null);
}
