// Persistencia local del "bastón recordado" (R6.3). La usa adapter-spp-android (Fase 4, dev
// build, fuera de este run) para reconectar al device elegido sin volver a la pantalla de
// conexión. Para web-serial, "recordar" lo provee navigator.serial.getPorts() (R5.4), así
// que este módulo NO es su mecanismo; queda como infraestructura del SPP.
//
// Patrón de storage canónico del proyecto: web → localStorage; native → expo-secure-store.
//
// ── LAS TRES FUNCIONES TIENEN TECHO (2026-07-30, ⚪-L del review de los bloqueantes) ─────────────
// `SecureStore` cruza el puente nativo, así que **puede no contestar**. Y desde esta unidad este módulo
// se llama desde caminos donde colgarse es inaceptable: el `signOut()` (un logout que espera al storage
// es un logout que NO SE PUEDE HACER), la baja de cuenta, y el arranque de la app (R6.4). Un `.catch()`
// en el caller cubre el RECHAZO y **no el COLGADO** — que es exactamente el 🔴-1 de esta misma unidad
// (`connectInFlight` sin timeout) entrando por otra puerta, y la ironía de que el tema de la unidad haya
// sido "todo await del puente necesita techo" mientras los dos awaits nuevos quedaban afuera del
// archivo donde el guard enumeraba.
//
// El techo va ACÁ, en el borde que hace la llamada nativa, y NO en cada call site: así el que llama
// desde un contexto crítico no tiene que acordarse, y un call site nuevo nace protegido en vez de nacer
// roto. Las tres funciones ya eran best-effort (devuelven `null` / no tiran), así que vencer es
// simplemente otra forma de "no se pudo". `spp-bridge-timeout-guard.test.ts` lo verifica en las dos
// direcciones: que acá se envuelva, y que los call sites puedan confiar en ese techo.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { DEFAULT_BRIDGE_TIMINGS, withTimeout } from './bridge-timeout';
import {
  parseRememberedValue,
  serializeRememberedValue,
  type RememberedDevice,
  type RememberedMeta,
} from './remembered-format';

// ⚠️ La clave NO se renombra (auditoría de `rafq.*`, `e0a32ad`): renombrarla le borra el bastón
// recordado a todo teléfono instalado → re-emparejar en la manga. El FORMATO del valor sí cambia en
// este delta, y por eso `parseRememberedValue` lee el viejo (RBM5.7).
const STORAGE_KEY = 'rafq.ble.remembered_device';

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Lee el bastón recordado (R6.3), o `null` si no hay. Devuelve el REGISTRO
 * (`{deviceId, vendorId?, adapterKind?}`), no el id pelado: además de reconectar al device, el
 * `adapterKind` es la preferencia de TRANSPORTE que `selectTransportAdapter` honra (RBM5.6).
 *
 * Un valor en el formato VIEJO (string pelado) se lee como "sin preferencia" (RBM5.7): el `deviceId`
 * sale intacto y la app cae al piso por plataforma, exactamente como antes.
 *
 * ⚠️ El tipo de retorno cambió a propósito y **el typecheck enumera los call sites** (misma técnica que
 * la cirugía de firma de T1/RBM1.2): un consumidor que solo quiera el id escribe `?.deviceId`, y así no
 * hay dos lectores del mismo registro que puedan divergir.
 */
export async function readRememberedDevice(): Promise<RememberedDevice | null> {
  try {
    if (Platform.OS === 'web') {
      return parseRememberedValue(hasLocalStorage() ? window.localStorage.getItem(STORAGE_KEY) : null);
    }
    return parseRememberedValue(
      await withTimeout(
        SecureStore.getItemAsync(STORAGE_KEY),
        DEFAULT_BRIDGE_TIMINGS.storage,
        'remembered_read',
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Persiste el bastón elegido (R6.3, sobrevive reinicios). Best-effort.
 *
 * `meta` es OPCIONAL y quien lo pasa es el borde de cada adapter (`defaultSppEnv` / `defaultBleEnv`),
 * que es el único que sabe con qué transporte se abrió el link. Sin `adapterKind` el registro queda
 * "sin preferencia" (piso por plataforma), que es lo correcto para un escritor que no lo sabe.
 */
export async function writeRememberedDevice(deviceId: string, meta?: RememberedMeta): Promise<void> {
  try {
    const value = serializeRememberedValue(deviceId, meta);
    if (value === null) return; // nada que guardar (el id no sobrevive el saneado)
    if (Platform.OS === 'web') {
      if (hasLocalStorage()) window.localStorage.setItem(STORAGE_KEY, value);
      return;
    }
    await withTimeout(
      SecureStore.setItemAsync(STORAGE_KEY, value),
      DEFAULT_BRIDGE_TIMINGS.storage,
      'remembered_write',
    );
  } catch {
    // Best-effort: si falla, la próxima vez se pide elegir el bastón de nuevo.
  }
}

/** Olvida el bastón recordado (R6.6, acción "olvidar"). Best-effort. */
export async function forgetRememberedDevice(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (hasLocalStorage()) window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    await withTimeout(
      SecureStore.deleteItemAsync(STORAGE_KEY),
      DEFAULT_BRIDGE_TIMINGS.storage,
      'remembered_forget',
    );
  } catch {
    // Best-effort.
  }
}
