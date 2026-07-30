// bridge-timeout — TODO await que cruza el puente nativo tiene que vencer. Módulo PURO (sin RN, sin
// la lib nativa) → testeable bajo node:test.
//
// ── POR QUÉ EXISTE (🔴-1 del review de `dad711f`, CONFIRMADO en device) ───────────────────────────
// `adapter-spp-android.ts` no tenía UN SOLO timeout. Un await del puente que no resuelve dejaba el
// latch `connectInFlight` tomado PARA SIEMPRE: todo `connect()` posterior —del operario, del chip, del
// sheet, del timer de backoff— pasaba a ser un no-op mudo, y la única recuperación era matar la app
// (el adapter se construye una vez por vida del proceso). No es teórico:
//
//   · `RNBluetoothClassicModule.requestBluetoothEnabled()` guarda la promesa en UN SOLO slot
//     (`mEnabledPromise`) y solo la resuelve desde `onActivityResult`. Si el operario prende el
//     Bluetooth desde el PANEL RÁPIDO en vez de contestarle al diálogo del sistema —lo natural—, ese
//     callback NO llega nunca. Medido en el A07 el 2026-07-30: **2 min 40 s sin un solo evento**, con
//     el Bluetooth prendido y el bastón disponible (`progress/bench_baston-spp-emulador.md` §4.2).
//   · Dos llamadas solapadas a `requestBluetoothEnabled` **pisan** ese slot y dejan la primera
//     huérfana para siempre (por eso el adapter, además del timeout, COALESCE ese pedido).
//   · `BluetoothSocket.connect()` (`RfcommConnectorThreadImpl`) no tiene timeout propio: con la radio
//     abajo bloquea hasta que el SO se rinda, y no hay contrato de cuándo es eso.
//
// El fix del bug 2 de `dad711f` (`pairDevice()` que colgaba) sacó LA LLAMADA pero no escribió el guard
// sobre LA AUSENCIA del mecanismo. Este módulo ES ese mecanismo, y `spp-bridge-timeout-guard.test.ts`
// es el guard: falla si aparece en el adapter un await del puente sin envolver.

/** Error de vencimiento de un await del puente. `label` identifica QUÉ venció (va al log). */
export class BridgeTimeoutError extends Error {
  readonly label: string;
  readonly ms: number;

  constructor(label: string, ms: number) {
    super(`bridge_timeout:${label}:${ms}ms`);
    this.name = 'BridgeTimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

export function isBridgeTimeout(e: unknown): e is BridgeTimeoutError {
  return e instanceof BridgeTimeoutError;
}

/**
 * Los tiempos del transporte SPP, en un solo lugar (y en un solo punto de inyección para los tests).
 * OJO: los tres primeros son PRESUPUESTOS de un await; los dos últimos son PERÍODOS de un timer.
 *
 * Presupuestos (si se vencen, la llamada se abandona):
 *   - `call`    → llamadas que solo cruzan el puente y vuelven (`isBluetoothEnabled`,
 *                 `getBondedDevices`, `isDeviceConnected`, `disconnect`). Si tardan 10 s, el puente
 *                 está roto.
 *   - `prompt`  → llamadas que esperan a UNA PERSONA frente a un diálogo del SO (permiso de runtime,
 *                 "¿activar Bluetooth?"). El presupuesto no mide latencia: mide cuánto tiempo estamos
 *                 dispuestos a quedarnos rehenes de un diálogo que el operario puede resolver por
 *                 otro lado (o ignorar). Al vencer, la pantalla vuelve a ofrecer "Volver a conectar".
 *   - `connect` → apertura del RFCOMM. Con el bastón apagado, Android tarda ~10-12 s en rendirse;
 *                 20 s deja margen sin dejar la UI clavada en "Conectando…".
 *
 * Períodos (cada cuánto corre un timer mientras hay link):
 *   - `livenessPoll` → cada cuánto se le pregunta al nativo si el socket sigue vivo (BENCH-1). Es un
 *                 `containsKey` de un HashMap del otro lado del puente: 15 s es gratis al lado de
 *                 tener un RFCOMM abierto, y es el techo de cuánto puede durar un "Bastón conectado"
 *                 mentiroso. NO depende de ningún evento ni de AppState — esa es toda la gracia.
 *   - `silence`  → cuánto silencio en un link conectado amerita dejarlo escrito en el log (🟠-5). No
 *                 dispara ninguna acción: el silencio es normal cuando el operario no bastonea.
 */
export interface BridgeTimings {
  call: number;
  prompt: number;
  connect: number;
  livenessPoll: number;
  silence: number;
  /**
   * `storage` (SecureStore / localStorage) — también cruza el puente. Su presupuesto es **mucho más
   * chico** que el de una llamada genérica y no es un descuido: los call sites nuevos de esta unidad
   * están en caminos donde colgarse es inaceptable (el `signOut()`, la baja de cuenta, el arranque de
   * la app). Un logout que tarda 10 s es un logout roto; 2 s ya es un storage que no va a contestar.
   */
  storage: number;
}

export const DEFAULT_BRIDGE_TIMINGS: BridgeTimings = {
  call: 10_000,
  prompt: 30_000,
  connect: 20_000,
  livenessPoll: 15_000,
  silence: 45_000,
  storage: 2_000,
};

/**
 * Corre `promise` con un presupuesto de `ms`. Al vencer RECHAZA con `BridgeTimeoutError` y:
 *   (a) le adosa un handler vacío a la promesa original, para que un rechazo TARDÍO del nativo no
 *       explote como `unhandledRejection` (el await ya nadie lo espera);
 *   (b) llama a `onTimeout`, que es donde el caller limpia lo que la llamada abandonada pueda haber
 *       abierto igual (caso real: un `connectToDevice` que vence y DESPUÉS resuelve con un socket
 *       abierto — si no se cierra, el nativo lo retiene en `mConnections` y la sonda de liveness
 *       diría "vivo" sobre un socket que nadie lee).
 *
 * `ms` no finito o ≤ 0 = SIN timeout (devuelve la promesa tal cual). Es la puerta para tests que no
 * quieren ejercitar el vencimiento; en producción los tres presupuestos son positivos.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      promise.then(
        () => undefined,
        () => undefined,
      );
      try {
        onTimeout?.();
      } catch {
        // La limpieza es best-effort: nunca puede convertir un timeout en otra excepción.
      }
      reject(new BridgeTimeoutError(label, ms));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * `withTimeout` + caída a un valor conocido. Para los tramos del camino de conexión donde una falla
 * NO es un error de conexión (no debe disparar el backoff) sino un estado: sin permiso, sin device
 * recordado, Bluetooth que no sabemos si está prendido. `onFail` recibe el error para loguearlo con
 * su motivo — nunca se traga en silencio.
 */
export async function withTimeoutOr<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  fallback: T,
  onFail?: (error: unknown) => void,
): Promise<T> {
  try {
    return await withTimeout(promise, ms, label);
  } catch (error) {
    onFail?.(error);
    return fallback;
  }
}
