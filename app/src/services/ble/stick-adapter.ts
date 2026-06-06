// Interfaz StickAdapter — el contrato de proveedor común detrás del cual viven los 5
// adaptadores de transporte (R11, ADR-024 §2). El contrato de ingesta (R1–R3) y el
// provider (R10) hablan con todos los adaptadores SOLO a través de esta interfaz; ninguno
// conoce el transporte concreto (SPP / web-serial / HID / manual / mock).
//
// Puro (solo tipos): sin imports de RN ni I/O → importable desde código y node:test.
//
// NO redefine BleStickEvent de spec 09: lo declara con la forma EXACTA que el design.md
// de spec 09 publicó (specs/active/09-buscar-animal/design.md líneas 168-175). 04
// implementa esa interfaz; cuando spec 09 Fase 4 tenga código, reexporta estos tipos.

/**
 * Evento que el contrato emite hacia el consumidor de spec 09. Forma idéntica para todos
 * los adaptadores (R1.6, R9.4). Declarado por spec 09; 04 lo implementa sin redefinirlo.
 */
export type BleStickEvent =
  | { kind: 'tag_read'; tag: string; timestamp: number }
  | { kind: 'connection_changed'; connected: boolean };

/**
 * Estados de conexión expuestos al chrome de la app (R9.2). Todos NO bloqueantes: la carga
 * manual funciona en cualquiera de ellos (R7.2, R9.6).
 */
export type ConnectionStatus =
  | 'off'
  | 'permission_denied'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected';

/** Función de baja de un listener (patrón unsubscribe). */
export type Unsubscribe = () => void;

/**
 * Interfaz transport-agnóstica de un adaptador de bastón (R11.1). Los adaptadores de
 * stream (spp-android, web-serial) entregan la LÍNEA CRUDA del lector por onTagRead (la
 * desframea parser-rs420.ts en el contrato); manual/mock entregan el EID/identificador ya
 * limpio; hid-wedge (GATED) entregaría los dígitos tipeados. El contrato decide cómo
 * ingerir cada uno (ver contract.ingestFromAdapter).
 */
export interface StickAdapter {
  /** Identificador del transporte, para logging/diagnóstico (R15) y selección en el provider. */
  readonly kind: 'manual' | 'mock' | 'web-serial' | 'spp-android' | 'hid-wedge';

  /** Conecta (opcionalmente a un device recordado). No bloquea la carga manual si falla (R7.4). */
  connect(deviceId?: string): Promise<void>;

  /** Desconecta el transporte físico (no afecta el listener lógico: ver enable/disable). */
  disconnect(): Promise<void>;

  /**
   * Suscribe a las lecturas crudas del adaptador. El callback recibe lo que el transporte
   * produce (línea cruda para streams; EID limpio para manual/mock). Devuelve unsubscribe.
   */
  onTagRead(cb: (rawOrEid: string) => void): Unsubscribe;

  /** Suscribe a los cambios de estado de conexión del transporte. Devuelve unsubscribe. */
  onStatus(cb: (status: ConnectionStatus) => void): Unsubscribe;

  /**
   * Activa la escucha lógica (R10.5). enable/disable NO desconectan físicamente: solo
   * dejan de propagar lecturas (MODO MANIOBRAS usa disable para procesar TAGs por su cuenta).
   */
  enable(): void;

  /** Desactiva la escucha lógica sin desconectar el transporte físico (R10.5). */
  disable(): void;
}
