// Logging diagnóstico NO bloqueante de eventos del ciclo de vida del transporte (R15).
// Conexión, desconexión, reintentos, lecturas malformadas, EIDs descartados (R1.4). NUNCA
// bloquea ni demora el flujo del operario (R15.1): es console.* best-effort, envuelto en
// try/catch para que ni siquiera un logger roto propague una excepción que rompa la UI (R15.2).
//
// PURO respecto de RN/I-O: no importa RN; usa console (disponible en RN y web). Testeable
// (la forma del evento) sin device.
//
// Spec 17 (R4.4/R4.5): además del console, agrega un BREADCRUMB de Sentry con el kind + los campos
// diagnósticos del evento (sin opData/PII — el TransportLogEvent nunca lleva el EID crudo). Sink en su
// PROPIO try/catch, sin tocar call sites; no-op en web/E2E (wrapper platform-split).

import { addBleBreadcrumb } from '../observability/sentry';

export type TransportLogEvent =
  | { kind: 'connection_changed'; connected: boolean }
  | { kind: 'reconnect_attempt'; attempt: number }
  | { kind: 'eid_rejected'; reason: 'parse_failed' | 'invalid_eid' | 'empty' }
  | { kind: 'read_loop_error'; message: string }
  | { kind: 'connect_error'; message: string }
  // ── Diagnóstico de los bloqueantes cerrados el 2026-07-30 (review + banco del ESP32) ──────────
  // Los cuatro existen para que el MISMO síntoma en logcat distinga causas que hoy son idénticas
  // desde afuera (§4 del banco: "conectado y mudo" da igual con el terminador equivocado, con el
  // bastón mudo, y con el socket muerto que la app todavía cree vivo).
  /** Un await del puente nativo venció (🔴-1). `label` dice cuál. */
  | { kind: 'bridge_timeout'; label: string; ms: number }
  /** Un `connect()` a OTRO bastón llegó con un intento en curso: se encola, no se descarta (🟠-2). */
  | { kind: 'connect_superseded'; deviceId: string }
  /** La sonda de liveness encontró el socket muerto creyéndolo vivo (🔴 BENCH-1). */
  | { kind: 'liveness_lost'; reason: 'foreground' | 'poll'; message: string }
  /** Conectado y sin recibir un byte hace `ms` (🟠-5): deja rastro, no dispara ninguna acción. */
  | { kind: 'connected_silent'; ms: number }
  /**
   * La reconexión automática al abrir la app (R6.4) decidió NO arrancar, y por qué. Es un SKIP, no un
   * error: el arranque en frío no toca la radio ni pide nada. Existe para que "no se conectó solo" sea
   * diagnosticable sin adivinar — hoy los cinco motivos se ven exactamente igual desde la UI (nada).
   */
  | {
      kind: 'autoconnect_skipped';
      reason: 'no_remembered' | 'permission' | 'bluetooth_off' | 'background' | 'unavailable' | 'busy';
    }
  /**
   * Se agotó el tope de la cadena de reintentos que NADIE pidió (R6.4): se deja de reintentar. `ms` es
   * cuánto duró la cadena y `attempts` cuántos intentos entraron — juntos dicen si el tope se consumió
   * reintentando de verdad o esperando (p. ej. un connect nativo que bloqueó 10 s por intento).
   */
  | { kind: 'autoconnect_exhausted'; ms: number; attempts: number }
  /**
   * Llegó un `connect()` con un intento ya en vuelo y NO había otro bastón que encolar (mismo target, o
   * sin target — el camino del chip del header). Antes era un no-op mudo; ahora deja rastro, porque si
   * el trigger es `operator` **destopa la cadena** y eso es un cambio de política que hay que poder ver.
   */
  | { kind: 'connect_reasserted'; trigger: 'operator' | 'autoconnect' | 'retry' }
  /**
   * Un intento vencido resolvió tarde con el socket abierto y NO se lo cerró, porque la dirección ya es
   * de un intento más nuevo: `device.disconnect()` cierra el socket de esa DIRECCIÓN, no el del intento,
   * así que cerrarlo le mataría la conexión al que sí está conectado (MEDIUM-1 del Gate 2).
   */
  | { kind: 'orphan_socket_kept'; reason: 'address_owned_by_newer' }
  /**
   * Entró una lectura con la escucha ACTIVA y NINGÚN consumidor que fuera a actuar sobre ella (🔴-2 del
   * barrido de edge cases del 2026-08-06): se descarta ANTES del feedback sensorial y ANTES de la ventana
   * de dedup (ver `read-dispatch.ts`). No es un estado esperado: es un agujero de producto —una pantalla
   * que recibe bastonazos y no los usa— y este evento es la única forma de verlo desde afuera, porque el
   * síntoma correcto (silencio total) es indistinguible de "el bastón no leyó".
   *
   * `subscribers` = cuántos había REGISTRADOS cuando todos declinaron. 0 = ninguna superficie suscripta;
   * ≥1 = suscriptas pero todas censurando (el caso de `maniobra/carga`: el overlay global está montado y
   * suprimido por ruta, y la pantalla no tiene listener propio).
   */
  | { kind: 'read_dropped_no_consumer'; subscribers: number };

/**
 * Registra un evento de transporte sin bloquear (R15.1). Best-effort: si el logger falla, se
 * traga el error (R15.2) — el diagnóstico nunca es crítico para el flujo del operario.
 */
export function logTransportEvent(event: TransportLogEvent): void {
  try {
    // Un solo canal (console.info) con prefijo para filtrar; los rechazos/errores no son
    // fallos del operario, son diagnóstico → no se muestran como error de UI.
    // eslint-disable-next-line no-console
    console.info('[ble]', event.kind, JSON.stringify(event));
  } catch {
    // Logger roto → ignorar. El logging jamás propaga (R15.2).
  }
  // Spec 17 (R4.4/R4.5) — breadcrumb de Sentry en su PROPIO try/catch (separado del console: si el
  // primero tira, éste igual corre). Sin opData/PII; no-op en web/E2E. Best-effort: jamás propaga.
  try {
    addBleBreadcrumb(event);
  } catch {
    // El sink de observabilidad jamás propaga (R15.2 / R4.5).
  }
}
