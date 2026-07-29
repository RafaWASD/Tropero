// Estado VACÍO de la asignación masiva de caravanas (`app/app/asignar-caravanas.tsx`, spec 09 chunk
// dedup opción B, RD5.2). PURO: solo strings + una decisión. Sin React, sin RN, sin I/O → testeable en
// node:test (mismo criterio que `maniobra-listen-state.ts` y que `readsEmptyHint` de spec 04).
//
// ── POR QUÉ EXISTE (bugfix 2026-07-29, misma clase que el chip del header) ────────────────────────────
// La `BulkTagAssignmentScreen` tiene UNA SOLA entrada de datos: `useBleStickListener`. No tiene entrada
// manual. Sin transporte instanciado (`provider.transport == null` — el Android de hoy: el adapter SPP es
// Fase 4) NUNCA puede llegar un tag, así que la cola nunca se llena y la pantalla queda congelada para
// siempre en su estado vacío… que decía *"Bastoneá para empezar / Pasá el bastón por la caravana del
// animal"*. Le pedía al operario lo único que ese dispositivo no puede hacer.
//
// DECISIÓN (ver `progress/impl_baston-chip-sin-transporte.md` §1-bis): el vacío DICE LA VERDAD; la fila de
// la tab "Más" NO se oculta. No es la misma decisión que el chip a propósito: el chip es un *indicador de
// estado* cuyo estado no puede cambiar sin transporte (etiqueta fija = ruido, se oculta y no se pierde
// nada); esta pantalla es una *funcionalidad real* que existe y funciona con el bastón — ocultar su
// entrada la volvería indescubrible y haría que la app se vea distinta según el dispositivo. Es también
// lo que ya se hizo con `/baston` en este mismo bugfix: una pantalla que sin bastón no sirve NO se borró,
// se hizo honesta.
//
// La condición es "NO HAY TRANSPORTE", **no** "es Android": cuando la Fase 4 construya el adapter SPP el
// vacío vuelve solo a "Bastoneá para empezar", sin tocar este archivo. En WEB el transporte siempre
// existe (web-serial) → nada cambia ahí.
//
// COPY: la frase "El bastón no está disponible en este dispositivo" es LITERALMENTE la misma que ya usan
// el hero de `maniobra/identificar` y el `ManualPromptHero` del `TagScanSheet`. Una sola redacción en
// toda la app para el mismo hecho; no se inventa una tercera.

export interface BulkAssignEmptyView {
  /** Título del estado vacío. */
  title: string;
  /**
   * Segunda línea: la frase canónica de "sin bastón" (la MISMA que identificar/TagScanSheet), o `null`
   * cuando el bastón sí está disponible (ahí el vacío es la espera normal de un bastoneo).
   */
  notice: string | null;
  /** Copy de apoyo: qué va a pasar (con bastón) o qué hacer en su lugar (sin bastón). */
  body: string;
  /** ¿El vacío está ESPERANDO un bastoneo? false = en este dispositivo no puede llegar ninguno. */
  waiting: boolean;
}

/**
 * Copy del estado vacío de la asignación masiva (RD5.2).
 *
 * @param hasTransport ¿Hay un transporte INSTANCIADO? (`useBleProviderApi()?.transport != null`).
 *   Parámetro OBLIGATORIO a propósito, igual que en `connectionStatusView`/`deviceRowView`: un call site
 *   nuevo tiene que decidirlo explícitamente, no heredar un default optimista que vuelva a pedirle al
 *   operario un bastoneo imposible.
 */
export function bulkAssignEmptyView(hasTransport: boolean): BulkAssignEmptyView {
  if (!hasTransport) {
    return {
      title: 'Necesitás el bastón',
      notice: 'El bastón no está disponible en este dispositivo',
      // La salida es REAL y verificada: el `TagScanSheet` de la ficha del animal trae la carga manual
      // del EID (ManualTagEntry, 15 dígitos) y funciona sin transporte. No prometemos nada que no exista.
      body: 'Podés cargar las caravanas de a una desde la ficha de cada animal.',
      waiting: false,
    };
  }
  return {
    title: 'Bastoneá para empezar',
    notice: null,
    body:
      'Pasá el bastón por la caravana del animal. Acá vas a elegir a cuál de tus animales sin caravana ' +
      'se la asignás.',
    waiting: true,
  };
}
