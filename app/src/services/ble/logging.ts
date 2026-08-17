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
import type { RejectReason } from './contract';
import type { MfiUnresolvedReason } from './ea-protocols';

export type TransportLogEvent =
  | { kind: 'connection_changed'; connected: boolean }
  | { kind: 'reconnect_attempt'; attempt: number }
  /**
   * Un EID entró y NO se ingirió. El motivo es el `RejectReason` DEL CONTRATO, importado y no
   * recopiado: los dos unions eran gemelos escritos a mano y un motivo nuevo (`parser_threw`, 🟡-2
   * del review de F1) se agregaba de un lado y se perdía del otro, sin que nada se pusiera rojo.
   * Es un `import type`: se borra en runtime y no crea dependencia real (`contract.ts` no importa
   * este módulo, así que tampoco hay ciclo).
   */
  | { kind: 'eid_rejected'; reason: RejectReason }
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
  | { kind: 'read_dropped_no_consumer'; subscribers: number }
  /**
   * FAIL-CLOSED del parser de trama (RBM1.4, delta ios-ble-mfi): un adaptador cuyo modo de ingesta
   * es `'raw-line'` no expone un `ReaderDriver` con `frameParser`, así que su línea NO se ingiere.
   *
   * Existe porque la alternativa —caer al parser del RS420— produciría lecturas para UN lector y
   * **silencio total** para todos los demás, y ese silencio es indistinguible de "el operario no
   * está bastoneando" (es literalmente el síntoma que costó el terminador equivocado del SPP:
   * `term cr` → 0 ingestas, 0 errores, en device). Un rechazo con log se diagnostica; un fallback
   * silencioso, no.
   *
   * `adapter` = el `AdapterKind` que quedó sin parser (`string` para no acoplar `logging.ts` al
   * union de `adapter-selection.ts`). `at` distingue los dos momentos, que tienen consecuencias
   * distintas:
   *   · `'mount'` → se montó un transporte que NO PUEDE parsear nada (error de cableado; aparece
   *     una vez, antes de cualquier bastonazo);
   *   · `'read'`  → se descartó UNA línea concreta (aparece por bastonazo y correlaciona con lo que
   *     el operario está haciendo, que es lo que hace diagnosticable el "bastoneo y no pasa nada").
   */
  | { kind: 'parser_unresolved'; adapter: string; at: 'mount' | 'read' }
  /**
   * El escaneo BLE se agotó sin encontrar un bastón que algún driver reconozca (RBM2.5, delta
   * ios-ble-mfi). `ms` es el presupuesto que se consumió y `seen` cuántos dispositivos aparecieron
   * ANUNCIANDO EL SERVICIO del driver — juntos separan tres causas que desde la UI se ven igual
   * ("no apareció nada"):
   *   · `seen: 0`  → no hay nada con ese servicio a la vista: el bastón está apagado, fuera de rango,
   *     o la radio del teléfono no está escaneando de verdad (permiso/ubicación en API ≤ 30);
   *   · `seen: >0` → SÍ hay dispositivos con ese servicio pero NINGUNO lo reconoce el `deviceMatch`
   *     del driver. Es el caso del bridge de la balanza Vesta, que anuncia los mismos UUID Nordic
   *     UART (ADR-003): la conducta correcta es no conectarse, y este contador es lo que hace visible
   *     que pasó eso y no lo otro.
   */
  | { kind: 'ble_scan_timeout'; ms: number; seen: number }
  /**
   * El transporte MFi (`adapter-mfi-ios`, RBM4.2) NO está resuelto, y por qué. Es el ÚNICO rastro que
   * deja el camino gateado: con la lista `UISupportedExternalAccessoryProtocols` vacía —el estado de hoy—
   * el adapter corta ANTES de tocar el módulo nativo, así que desde afuera se ve exactamente igual que
   * "el operario no está bastoneando" (nada). Los seis motivos mandan a lugares distintos:
   *   · `build-sin-protocolos`   → falta el dato del FABRICANTE (trámite MFi). El estado normal hoy.
   *   · `protocolo-no-declarado` → el driver declara una cadena que este build no tiene en el plist:
   *     falta la línea en `app.config.ts` (error de configuración NUESTRO, no del fabricante).
   *   · `driver-sin-mfi`         → ningún lector del registro habla MFi. Normal hasta que llegue el dato.
   *   · `delimitador-no-soportado` → el driver declara un fin de trama que la rama iOS no puede framear
   *     (vacío o multi-carácter): se corta ANTES de conectar en vez de partir mal cada trama.
   *   · `plataforma-no-ios`      → ExternalAccessory no existe fuera de iOS.
   *   · `modulo-nativo-ausente`  → el binario de la lib no está en este build (o es web/CI).
   * El tipo del motivo se **importa** de `ea-protocols.ts` (`import type`, se borra en runtime): la copia
   * a mano de un union es el bug que el review de F1 cazó con `RejectReason`.
   */
  | { kind: 'mfi_unavailable'; reason: MfiUnresolvedReason };

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
