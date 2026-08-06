// Estado VACÍO de la asignación masiva de caravanas (`app/app/asignar-caravanas.tsx`, spec 09 chunk
// dedup opción B, RD5.2). PURO: solo strings + una decisión. Sin React, sin RN, sin I/O → testeable en
// node:test (mismo criterio que `maniobra-listen-state.ts` y que `readsEmptyHint` de spec 04).
//
// ── POR QUÉ EXISTE (bugfix 2026-07-29, misma clase que el chip del header) ────────────────────────────
// La `BulkTagAssignmentScreen` tiene UNA SOLA entrada de datos: `useBleStickListener`. No tiene entrada
// manual. Si por el bastón no puede llegar un tag, la cola nunca se llena y la pantalla queda congelada
// para siempre en su estado vacío… que decía *"Bastoneá para empezar / Pasá el bastón por la caravana del
// animal"*. Le pedía al operario lo único que no puede hacer.
//
// DECISIÓN (ver `progress/impl_baston-chip-sin-transporte.md` §1-bis): el vacío DICE LA VERDAD; la fila de
// la tab "Más" NO se oculta. No es la misma decisión que el chip a propósito: el chip es un *indicador de
// estado* cuyo estado no puede cambiar sin transporte (etiqueta fija = ruido, se oculta y no se pierde
// nada); esta pantalla es una *funcionalidad real* que existe y funciona con el bastón — ocultar su
// entrada la volvería indescubrible y haría que la app se vea distinta según el dispositivo. Es también
// lo que ya se hizo con `/baston` en este mismo bugfix: una pantalla que sin bastón no sirve NO se borró,
// se hizo honesta.
//
// ── LA DIMENSIÓN QUE FALTABA (🔴-3 del barrido de edge cases del Bluetooth, 2026-08-06) ───────────────
// El corte original era SOLO `hasTransport`, y la nota de esta cabecera decía que "cuando la Fase 4
// construya el adapter SPP el vacío vuelve solo a «Bastoneá para empezar»". La Fase 4 llegó (adapter SPP
// Android, 2026-07-29) — y por eso apareció un caso NUEVO que el corte viejo no ve: en Android
// `hasTransport` es `true` SIEMPRE, aunque el bastón esté apagado, sin emparejar o nunca conectado. La
// pantalla volvió entonces a decir "Bastoneá para empezar" en un teléfono donde bastonear no hace
// literalmente nada. Medido en device (A07 + ESP32): tras agotarse la cadena de reconexión de R6.4
// (~132 s) el peón puede bastonear 20 animales sin una sola señal — y esta es la ÚNICA pantalla BLE-only
// SIN entrada manual, el header no tiene chip, y el pill global se auto-oculta justo en `'off'`, que es
// donde termina esa cadena. Cero indicadores, cero mensajes, cero botones.
// El bug original se había cerrado contra la dimensión equivocada: preguntaba *"¿hay transporte?"* cuando
// la pregunta del peón es *"¿está conectado?"*. Ahora el corte usa las DOS, con el MISMO criterio que el
// hero adaptativo de `maniobra/identificar` y del `TagScanSheet` (`resolveListenConnState`) en vez de
// inventar una tercera forma de responder lo mismo:
//   - 'connected'   → el bastón lee → "Bastoneá para empezar" (el copy de siempre).
//   - 'connectable' → hay transporte pero NO está conectado → decilo, y DALE UNA SALIDA (CTA a `/baston`,
//                     que desde el 2026-08-05 es alcanzable desde la fila del tab "Más").
//   - 'manual'      → no hay transporte en este dispositivo → la frase canónica + la salida por la ficha.
//
// COPY: la frase "El bastón no está disponible en este dispositivo" es LITERALMENTE la misma que ya usan
// el hero de `maniobra/identificar` y el `ManualPromptHero` del `TagScanSheet`. Una sola redacción en
// toda la app para el mismo hecho; no se inventa una tercera.

import { resolveListenConnState } from './maniobra-listen-state';

/** Acción de salida del estado vacío: un CTA que lleva a una pantalla donde el problema SE PUEDE resolver. */
export interface BulkAssignEmptyAction {
  /** Texto del botón (es-AR, voseo, imperativo). El cuerpo lo nombra para que el peón sepa qué tocar. */
  label: string;
  /** Destino. Hoy solo `/baston` (la pantalla de conexión); tipado literal para que no se cuele una ruta suelta. */
  href: '/baston';
}

export interface BulkAssignEmptyView {
  /** Título del estado vacío. */
  title: string;
  /**
   * Segunda línea: la frase canónica de "sin bastón" (la MISMA que identificar/TagScanSheet), o `null`
   * cuando el bastón sí está disponible en este dispositivo (esté o no conectado).
   */
  notice: string | null;
  /** Copy de apoyo: qué va a pasar (con bastón) o qué hacer en su lugar (sin bastón / desconectado). */
  body: string;
  /** ¿El vacío está ESPERANDO un bastoneo? false = en este estado no puede llegar ninguno. */
  waiting: boolean;
  /** CTA de salida, o `null` cuando no hay ninguna pantalla que pueda arreglar la situación. */
  action: BulkAssignEmptyAction | null;
}

/** La frase canónica de "sin bastón" — UNA sola redacción en toda la app (ver §COPY de la cabecera). */
const SIN_BASTON = 'El bastón no está disponible en este dispositivo';

/** La salida REAL y verificada cuando el bastón no puede leer: el `TagScanSheet` de la ficha carga el EID a mano. */
const SALIDA_FICHA = 'cargar las caravanas de a una desde la ficha de cada animal';

export interface BulkAssignEmptyInput {
  /**
   * ¿Hay un transporte INSTANCIADO? (`useBleProviderApi()?.transport != null`). false en iOS y en un
   * build sin el módulo nativo SPP.
   */
  hasTransport: boolean;
  /**
   * ¿El transporte está CONECTADO ahora? (`useBleStickListener(...).isConnected`). En Android
   * `hasTransport` es true siempre: sin esto, el vacío pide bastonear con el bastón apagado.
   */
  isConnected: boolean;
}

/**
 * Copy del estado vacío de la asignación masiva (RD5.2 + 🔴-3).
 *
 * Recibe un OBJETO y no dos booleanos posicionales a propósito: `bulkAssignEmptyView(false, true)` no se
 * puede leer, y los dos campos son obligatorios —igual que en `connectionStatusView`/`deviceRowView`—
 * para que un call site nuevo tenga que decidirlos explícitamente en vez de heredar un default optimista
 * que vuelva a pedirle al operario un bastoneo imposible.
 */
export function bulkAssignEmptyView({ hasTransport, isConnected }: BulkAssignEmptyInput): BulkAssignEmptyView {
  // MISMO criterio que el hero adaptativo de la manga (no una cuarta forma de preguntar lo mismo).
  switch (resolveListenConnState({ isConnected, conectable: hasTransport })) {
    case 'connected':
      return {
        title: 'Bastoneá para empezar',
        notice: null,
        body:
          'Pasá el bastón por la caravana del animal. Acá vas a elegir a cuál de tus animales sin caravana ' +
          'se la asignás.',
        waiting: true,
        action: null,
      };
    case 'connectable':
      // Hay transporte pero el bastón NO está leyendo: apagado, fuera de rango, nunca emparejado, o la
      // cadena de reconexión se agotó. El peón necesita saber QUÉ pasa y QUÉ TOCAR — sin el CTA esto
      // sigue siendo un pozo mudo, porque esta pantalla no tiene entrada manual.
      return {
        title: 'El bastón no está conectado',
        notice: null,
        // Corto a propósito: se lee de un vistazo, con una mano y a pleno sol. Primero QUÉ TOCAR
        // (nombrando el botón, para no obligar a deducir cuál de los elementos es), después la otra salida.
        // "Fijate que esté prendido" y no "Prendé el bastón" (⚪-L del review): este estado también cubre
        // "fuera de rango" y "se agotó la cadena de reconexión", donde el bastón YA está prendido — decirle
        // al peón que lo prenda sería falso en dos de los tres casos, y el que ya lo tiene prendido
        // concluiría que la app no entiende nada.
        body: `Fijate que el bastón esté prendido y cerca, y tocá «Conectar el bastón». Si no, podés ${SALIDA_FICHA}.`,
        waiting: false,
        action: { label: 'Conectar el bastón', href: '/baston' },
      };
    case 'manual':
      // No hay transporte en este dispositivo: no hay nada que conectar, así que un CTA a `/baston` sería
      // otra promesa vacía. La salida real es la carga manual de la ficha.
      return {
        title: 'Necesitás el bastón',
        notice: SIN_BASTON,
        body: `Podés ${SALIDA_FICHA}.`,
        waiting: false,
        action: null,
      };
  }
}
