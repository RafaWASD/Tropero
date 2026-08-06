// Caché en memoria de la preferencia de sonido del bastón (R4.3). PURO: sin RN, sin expo, sin I/O →
// node:test lo ejecuta de verdad (`beep-pref-cache.test.ts`), que es la única forma de verificar la
// semántica de invalidación por COMPORTAMIENTO y no por la forma del código.
//
// ── EL PROBLEMA QUE CIERRA (🟡-11 del barrido de edge cases del Bluetooth, 2026-08-06) ────────────────
// `readBeepEnabled()` se llamaba EN CADA LECTURA desde `handleReading` del provider: un cruce del puente
// nativo a `expo-secure-store` —que en Android es el KeyStore, no un `Map`— POR BASTONAZO, para alimentar
// un flag booleano que no cambia salvo que el operario toque un switch. Además obligaba a que el feedback
// colgara de una promesa: el pip de confirmación salía en el microtask siguiente, y en una ráfaga el
// orden de las promesas no está garantizado contra el orden de las lecturas.
//
// Con el caché, el camino caliente es SÍNCRONO y sin I/O: se lee un booleano de memoria.
//
// ── LA REGLA DE INVALIDACIÓN ─────────────────────────────────────────────────────────────────────────
// El caché lo escribe QUIEN CONOCE EL VALOR NUEVO, en las dos puntas:
//   · al leer del storage (arranque / warm-up del provider) → `rememberBeepEnabled(valorLeído)`;
//   · al ESCRIBIR la preferencia (el switch de /baston) → `rememberBeepEnabled(valorNuevo)` ANTES de
//     persistir. Es deliberado: la persistencia es best-effort (si el storage falla no rompe nada), pero
//     lo que el operario acaba de pedir tiene que valer para el próximo bastonazo SÍ O SÍ. Un caché que
//     se invalidara "cuando la escritura termine" dejaría una ventana en la que el peón apagó el sonido
//     y el teléfono le sigue sonando.
//
// ── QUÉ PASA ANTES DEL WARM-UP ───────────────────────────────────────────────────────────────────────
// Sin valor recordado todavía, devuelve `BEEP_DEFAULT_ENABLED` (ON). O sea: en la ventana entre montar
// el provider y que el storage conteste, un operario que había APAGADO el sonido podría escuchar un pip.
// Se acepta a propósito y es acotado: el warm-up se dispara al montar el provider, muchísimo antes del
// primer bastonazo real (hay que conectar el bastón y acercarlo a un animal). La alternativa —arrancar
// en OFF hasta saber— haría que el primer bastonazo de TODOS los usuarios (el default es ON) fuera mudo,
// que es el modo de falla peor: un peón que estrena el producto y no recibe confirmación.

import { BEEP_DEFAULT_ENABLED } from './feedback-logic';

/** null = todavía no se sabe (no se leyó el storage ni se escribió la preferencia en esta sesión). */
let remembered: boolean | null = null;
/** Cuántas veces el OPERARIO escribió la preferencia. Solo crece; es el árbitro de la carrera de abajo. */
let writes = 0;

/**
 * La preferencia de sonido, SIN I/O y SIN promesa. Es lo que consume el camino caliente de la lectura.
 * Sin valor recordado → el default (ON).
 */
export function cachedBeepEnabled(): boolean {
  return remembered ?? BEEP_DEFAULT_ENABLED;
}

/** ¿Ya se sabe el valor real (se leyó el storage o el operario tocó el switch)? Solo para diagnóstico. */
export function beepPrefIsKnown(): boolean {
  return remembered !== null;
}

/** Cuántas escrituras del operario van. Se toma ANTES de una lectura para poder dirimir la carrera. */
export function beepWriteCount(): number {
  return writes;
}

/** Fija el valor que ESCRIBIÓ el operario. Gana siempre: es lo último que pidió. */
export function rememberBeepEnabled(enabled: boolean): void {
  remembered = enabled;
  writes += 1;
}

/**
 * Asienta el valor que volvió del STORAGE, y devuelve el valor VIGENTE.
 *
 * ── LA CARRERA QUE CIERRA (encontrada en la autorrevisión, 2026-08-06) ──────────────────────────────
 * La lectura del storage es asíncrona y hay dos disparadores (el warm-up del provider al montar y la
 * pantalla `/baston` al abrirse). Si el operario mueve el switch MIENTRAS una de esas lecturas está en
 * vuelo, la lectura vuelve con el valor VIEJO y —sin este árbitro— pisaría tanto el caché como el
 * switch en pantalla: el peón apaga el sonido, ve el switch volver solo a encendido, y el próximo
 * bastonazo le suena. Un ajuste que se "des-toca" solo es peor que no tener el ajuste.
 *
 * La regla es simple y no depende de relojes: si hubo alguna escritura del operario desde que la
 * lectura arrancó, la lectura PERDIÓ y se descarta. El caller usa el retorno para pintar la UI, así que
 * el switch queda donde el operario lo dejó.
 */
export function settleReadBeepEnabled(readValue: boolean, writesAtReadStart: number): boolean {
  if (writes !== writesAtReadStart) return cachedBeepEnabled();
  remembered = readValue;
  return readValue;
}

/** Vuelve al estado "no se sabe". Solo para tests: en runtime no hay motivo para olvidar. */
export function forgetBeepEnabledForTest(): void {
  remembered = null;
  writes = 0;
}
