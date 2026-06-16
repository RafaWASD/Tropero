// app/src/utils/maniobra-listen-state.ts — decisión PURA del sub-estado del HERO ADAPTATIVO de la
// identificación de la manga (spec 03 M2.1, R3.6/R3.7), cuando la pantalla está "escuchando"
// (outcome===null). Tres sub-estados según el estado de conexión del bastón:
//
//   - 'connected'   → CONECTADO: el bastón lee solo → ScanHero ("Acercá el bastón al animal"). El escaneo
//                     es la tarea; el manual es banda secundaria.
//   - 'connectable' → DESCONECTADO pero con un transporte CONECTABLE (web-serial antes de elegir puerto, o
//                     el bastón se cayó y se puede reconectar) → ConnectHero: el disco es un BOTÓN que
//                     dispara connect() con el gesto del tap (web-serial lo exige).
//   - 'manual'      → DESCONECTADO y SIN transporte conectable (native manual-first hoy, hasta que aterrice
//                     el BLE native) → MANUAL PROMOVIDO: sin disco, la entrada manual es la tarea primaria.
//                     Tono NEUTRO (es lo normal en ese dispositivo, no un error).
//
// La lógica vive acá (no inline en el render) para que sea TESTEABLE de forma determinística sin montar la
// pantalla: el sub-estado 'manual' (transport==null) NO es expresable con el mock-adapter en web (siempre
// tiene transporte) → el E2E cubre connected↔connectable y este test puro cubre los 3 sin device.

export type ListenConnState = 'connected' | 'connectable' | 'manual';

export interface ListenConnInput {
  /** ¿El transporte del bastón está conectado AHORA? (de useBleStickListener). */
  isConnected: boolean;
  /** ¿Hay un transporte CONECTABLE? (provider.transport != null). false en native manual-first. */
  conectable: boolean;
}

/**
 * Mapea el estado de conexión al sub-estado del hero. CONECTADO gana siempre (si está conectado, el
 * transporte obviamente existe). Si NO está conectado: conectable → 'connectable'; si no → 'manual'.
 */
export function resolveListenConnState({ isConnected, conectable }: ListenConnInput): ListenConnState {
  if (isConnected) return 'connected';
  if (conectable) return 'connectable';
  return 'manual';
}

/**
 * ¿El manual va PROMOVIDO? (= la entrada manual es la tarea primaria). True solo en el sub-estado 'manual'
 * (desconectado y sin transporte conectable). En ese caso el ManualEntry arranca expandido y sin el
 * "Cancelar → volver al escaneo" (no hay nada que escanear).
 */
export function isManualPromoted(input: ListenConnInput): boolean {
  return resolveListenConnState(input) === 'manual';
}
