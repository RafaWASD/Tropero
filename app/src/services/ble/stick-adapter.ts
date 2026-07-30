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
  /**
   * Identificador del transporte, para logging/diagnóstico (R15) y selección en el provider.
   * `'simulator'` (delta multivendor, RMV4.1) se agrega de forma ADITIVA: es el adapter del
   * camino de demo (dev/demo-gated). No cambia ningún método de la interfaz.
   */
  readonly kind: 'manual' | 'mock' | 'web-serial' | 'spp-android' | 'hid-wedge' | 'simulator';

  /** Conecta (opcionalmente a un device recordado). No bloquea la carga manual si falla (R7.4). */
  connect(deviceId?: string): Promise<void>;

  /**
   * OPCIONAL — reconexión automática al ABRIR la app (R6.4). El provider la llama UNA vez al montar el
   * transporte; un adapter que no la implemente simplemente no auto-conecta (no-op).
   *
   * Es opcional y no `connect()` porque son dos cosas distintas: `connect()` lo dispara un GESTO y
   * puede pedirle cosas al operario (permiso, prender el Bluetooth); `autoConnect()` corre en el primer
   * frame, **sin** que nadie haya pedido nada, así que no puede tocar la radio ni mostrar un diálogo:
   * si falta el device recordado, el permiso o el Bluetooth, NO arranca y deja el estado como estaba.
   *
   * Hoy la implementa SOLO `spp-android`, y no por olvido de los otros cuatro:
   *   · `web-serial` NO PUEDE — la Web Serial API exige un gesto de usuario para `requestPort()`;
   *     "recordar" ahí lo provee `navigator.serial.getPorts()` (R5.4), que es otro mecanismo.
   *   · `manual` no tiene transporte físico que conectar (es el piso, R7).
   *   · `mock` lo conecta el bridge de E2E; `simulator`, el botón de la demo.
   *   · `hid-wedge` (GATED) no conecta nada: el teclado lo empareja el SO.
   */
  autoConnect?(): Promise<void>;

  /**
   * OPCIONAL — ¿el `autoConnect()` de este adapter agotó su tope sin encontrar el bastón recordado?
   *
   * La cadena de reintentos que arranca sin gesto tiene tope (a diferencia de la que arranca con un tap),
   * y al agotarse el estado queda en `'off'`: no conectado y **sin** estar intentando. Eso deja el chrome
   * de la app en paz (el indicador global se auto-oculta en `'off'`), pero le esconde al operario que SÍ
   * fue a mirar la pantalla de conexión que hubo un intento. Este flag es lo que le da el copy honesto
   * ("no encontramos el bastón guardado" en vez de "conectá el bastón"). Se pone en `true` ANTES del
   * cambio de estado que provoca el re-render, así que la UI siempre lo lee fresco.
   */
  readonly autoConnectExhausted?: boolean;

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
