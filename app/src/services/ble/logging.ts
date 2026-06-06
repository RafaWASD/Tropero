// Logging diagnóstico NO bloqueante de eventos del ciclo de vida del transporte (R15).
// Conexión, desconexión, reintentos, lecturas malformadas, EIDs descartados (R1.4). NUNCA
// bloquea ni demora el flujo del operario (R15.1): es console.* best-effort, envuelto en
// try/catch para que ni siquiera un logger roto propague una excepción que rompa la UI (R15.2).
//
// PURO respecto de RN/I-O: no importa RN; usa console (disponible en RN y web). Testeable
// (la forma del evento) sin device.

export type TransportLogEvent =
  | { kind: 'connection_changed'; connected: boolean }
  | { kind: 'reconnect_attempt'; attempt: number }
  | { kind: 'eid_rejected'; reason: 'parse_failed' | 'invalid_eid' | 'empty' }
  | { kind: 'read_loop_error'; message: string }
  | { kind: 'connect_error'; message: string };

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
}
