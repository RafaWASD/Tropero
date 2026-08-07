// indicator-geometry — el tamaño y el LUGAR que ocupa el indicador global del bastón en el chrome.
//
// Vive aparte del componente porque tiene DOS consumidores, y el segundo es el que importa: una pantalla
// que comparte esa banda necesita saber **cuánto ancho reservarle** — y ese número no puede ser una copia.
//
// ── EL DEFECTO QUE ESTO CIERRA (2026-08-07) ─────────────────────────────────────────────────────────
// El sondeo de la banda dio LIBRE la home… midiendo un fixture cuyo usuario se llama "E2E". El saludo
// (`¡Hola {nombre}! 👋`, `$9` = 30 px, bold, **sin `numberOfLines`**) crece con el nombre del usuario, que
// el producto acepta hasta `NAME_MAX_LENGTH`. Medido después con nombres reales: con uno de 14 caracteres
// el primer renglón llega a **x=355** y la banda del círculo arranca en **x=354** → el saludo pasa POR
// DEBAJO del indicador. Se había medido la instancia, no el rango.
//
// El arreglo NO es truncar el nombre (el saludo es la bienvenida; un nombre propio cortado a 30 px es
// peor que un renglón más) ni que la home reclame la banda (perderíamos el indicador justo en la pantalla
// donde el operario abre la app y ve "Conectando…"): es que el texto RESERVE el lugar y envuelva antes.
// Reservar es lo que haría cualquier layout honesto con un flotante encima.

import { getTokenValue } from 'tamagui';

/** Grosor del borde del indicador. Único número suelto: el DS no tiene token de borderWidth. */
export const INDICATOR_BORDER = 1;

export interface IndicatorGeometry {
  /** Tamaño del ícono lucide (`$navIcon`), que es el canal de estado. */
  icon: number;
  /** Aire a cada lado del ícono (`$2`). Con el indicador colapsado, centra el ícono en el círculo. */
  pad: number;
  /** Diámetro del círculo = la forma PERMANENTE. */
  circle: number;
  /** Alto del contenido (el círculo menos sus bordes). */
  content: number;
}

/**
 * Geometría del indicador, derivada de TOKENS (ADR-023 §4: cero hardcode).
 *
 * El círculo es el ícono más su aire y nada más: `$navIcon` (24) + `$2` (7) a cada lado + el borde → 40.
 * Coincide con el bar de target compacto de la app, pero está DERIVADO del contenido y no puesto a mano:
 * el indicador **no es un target** (no se toca), así que su tamaño no puede salir de `$chipMin`.
 *
 * Se resuelve en tiempo de RENDER y no en el módulo: `getTokenValue` a nivel de módulo corre en el import,
 * antes de que exista el `TamaguiProvider`, y en este repo no hay un solo precedente de eso.
 */
export function indicatorGeometry(): IndicatorGeometry {
  const icon = getTokenValue('$navIcon', 'size');
  const pad = getTokenValue('$2', 'space');
  const circle = icon + pad * 2 + INDICATOR_BORDER * 2;
  return { icon, pad, circle, content: circle - INDICATOR_BORDER * 2 };
}

/**
 * **Cuánto ancho tiene que reservarle una pantalla al indicador** si su contenido puede crecer hasta la
 * banda (arriba a la derecha, debajo de la fila del header). Es el círculo —la forma PERMANENTE— más un
 * respiro, y se pide por función para que nadie lo copie: si el círculo cambia de tamaño, la reserva lo
 * sigue sola.
 *
 * Hoy lo usa el saludo de la home (`(tabs)/index.tsx`), que es el único texto de ancho variable que
 * comparte la banda con el indicador. Las pantallas cuyo contenido ocupa esa banda SIEMPRE (un buscador a
 * ancho completo, un header de identidad) no reservan: **reclaman** el lugar con
 * `useStickStatusSurface('screen-band')` y el indicador no se dibuja.
 *
 * ⚠️ La reserva cubre el CÍRCULO, no la pill estirada (que vive 4 s cuando el estado cambia y puede rozar
 * un nombre largo en ese rato). Es deliberado: reservar ~115 px permanentes para un aviso transitorio le
 * cobraría a todas las pantallas el ancho del peor momento.
 */
export function stickIndicatorBandReserve(): number {
  return indicatorGeometry().circle + getTokenValue('$2', 'space');
}
