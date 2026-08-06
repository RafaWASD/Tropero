// Preferencia de usuario para el sonido de lectura del bastón (R4.3): apagable, persistida
// localmente entre sesiones. La HÁPTICA (R4.1) NO es apagable y no tiene preferencia; solo
// el sonido se configura.
//
// Patrón de storage canónico del proyecto (igual que last-rodeo / establishment-store):
// web → localStorage; native → expo-secure-store. NO @react-native-async-storage. La lógica
// PURA (parseo del flag, default ON) vive en feedback-logic.ts (sin RN) y el CACHÉ en memoria
// en beep-pref-cache.ts (también puro); este módulo solo hace la I/O de plataforma y mantiene
// las dos puntas sincronizadas.
//
// ⚠️ El camino caliente de la lectura NO llama acá (🟡-11): lee `cachedBeepEnabled()`, que es
// síncrono y sin I/O. Este módulo se toca dos veces: en el warm-up del provider y cuando el
// operario mueve el switch de /baston.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseBeepPref, serializeBeepPref, BEEP_DEFAULT_ENABLED } from './feedback-logic';
import { beepWriteCount, rememberBeepEnabled, settleReadBeepEnabled } from './beep-pref-cache';

export { BEEP_DEFAULT_ENABLED, parseBeepPref } from './feedback-logic';
// UN SOLO nombre público para "el valor vigente sin tocar el storage" (⚪ del review): antes había dos
// —este re-export y un `currentBeepEnabled()` que solo lo llamaba—, y el provider usaba uno y la pantalla
// el otro. `docs/conventions.md §Imports`: sin re-exports innecesarios.
export { cachedBeepEnabled } from './beep-pref-cache';

const STORAGE_KEY = 'rafq.ble.beep_enabled';

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return hasLocalStorage() ? window.localStorage.getItem(STORAGE_KEY) : null;
  }
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (hasLocalStorage()) window.localStorage.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

/**
 * Cola de escrituras al storage. Dos toques rápidos del switch disparan dos `setItemAsync`; sin
 * serializarlos, nada garantiza que se asienten en el orden en que el operario los pidió y el disco
 * podría quedar con el valor del ANTEÚLTIMO toque (el caché en memoria sí queda bien, así que el
 * síntoma aparece recién en el próximo arranque — el peor tipo de bug: diferido y sin causa visible).
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Lee la preferencia persistida y la deja en el caché (R4.3). Default ON si no hay valor / falla la
 * lectura. Es el WARM-UP: lo llama el provider al montar y la pantalla de conexión al abrirse.
 *
 * Devuelve el valor VIGENTE, que no siempre es el que estaba en el disco: si el operario movió el
 * switch mientras esta lectura estaba en vuelo, GANA ÉL (ver `settleReadBeepEnabled`). El caller pinta
 * con el retorno, así que el switch no se "des-toca" solo.
 */
export async function readBeepEnabled(): Promise<boolean> {
  // Que no se lea el disco con una escritura del operario todavía en vuelo: devolvería el valor viejo.
  await writeQueue.catch(() => undefined);
  const writesAtStart = beepWriteCount();
  let value: boolean;
  try {
    value = parseBeepPref(await readRaw());
  } catch {
    // El storage no contestó. Se recuerda el DEFAULT igual: si no, cada lectura volvería a intentar
    // la I/O que acaba de fallar. Un storage roto no puede convertirse en un cruce por bastonazo.
    value = BEEP_DEFAULT_ENABLED;
  }
  return settleReadBeepEnabled(value, writesAtStart);
}

/**
 * Persiste la preferencia (R4.3). El caché se actualiza ANTES de persistir a propósito: la escritura es
 * best-effort (si falla, no rompe nada), pero lo que el operario acaba de pedir tiene que valer para el
 * próximo bastonazo aunque el storage no conteste nunca.
 */
export async function writeBeepEnabled(enabled: boolean): Promise<void> {
  rememberBeepEnabled(enabled);
  const raw = serializeBeepPref(enabled);
  // Encolada, no en paralelo: el orden de las escrituras al disco tiene que ser el de los toques.
  writeQueue = writeQueue.then(
    () => writeRaw(raw),
    () => writeRaw(raw),
  ).catch(() => {
    // Best-effort: la preferencia es un ajuste de comodidad; su persistencia no es crítica.
  });
  return writeQueue;
}
