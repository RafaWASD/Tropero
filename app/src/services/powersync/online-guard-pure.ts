// online-guard-pure.ts — parte PURA del fast-fail de writes ONLINE-only offline (spec 15, fix
// UX/robustez). SIN imports del SDK/RN → testeable con node:test (mismo patrón que status-derive.ts
// vs status.ts: lo PURO en su propio módulo para que el unit test NO arrastre el grafo nativo).
//
// La parte de I/O (`assertOnline`, que lee `currentStatus.connected` del SDK) vive en online-guard.ts,
// que importa este módulo + el SDK. Los tests importan SOLO de acá.

/** Error de "necesitás conexión" con el shape `kind:'network'` que ya consumen los services/pantallas. */
export type NetworkError = { kind: 'network'; message: string };

/**
 * PURO (sin SDK, testeable): si NO está conectado (`connected !== true`, cubre false/undefined),
 * devuelve un `NetworkError` con el `message` dado; si está conectado, devuelve `null`.
 *
 * `connected !== true` (en vez de `=== false`) es deliberado: `currentStatus.connected` es
 * `boolean | undefined` en el SDK; undefined (status aún sin poblar) se trata como OFFLINE
 * (fail-closed: ante la duda, no colgamos la pantalla — fallamos rápido y el usuario reintenta).
 */
export function offlineError(
  connected: boolean | undefined,
  message: string,
): NetworkError | null {
  if (connected !== true) {
    return { kind: 'network', message };
  }
  return null;
}
