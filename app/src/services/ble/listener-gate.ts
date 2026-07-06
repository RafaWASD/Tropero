// listener-gate.ts — decisión PURA de si el listener del bastón DEBE escuchar ahora (R10.5/R10.6 + delta
// caravana-ficha bastoneo RCF.6). Extraída del provider para testearla determinísticamente sin React.
//
// La regla de propiedad EXCLUSIVA (RCF.6, el punto crítico):
//   - Un "scanner acotado" activo (un sheet de scan que tomó la propiedad exclusiva, ej. bastonear la
//     caravana desde la ficha) FUERZA la escucha — quiere las lecturas para SÍ, AUNQUE la pantalla haya
//     prendido busyMode para suspender el listener global (la ficha lo hace con useBusyWhileMounted). El
//     FindOrCreateOverlay ignora esas lecturas por su cuenta (chequea scopedScannerActive) → un solo
//     consumidor efectivo, sin doble proceso del EID.
//   - Sin scanner acotado, vale lo de siempre: se escucha si el listener está `enabled` y no está `busy`
//     (un form CREATE/EDIT abierto, o MODO MANIOBRAS suspendido).
//
// Invariante clave: cuando el scanner acotado se libera, `listening` vuelve EXACTAMENTE a `enabled && !busy`
// → si la ficha seguía con busyMode prendido, la escucha se re-suspende sola (un bastonazo posterior en la
// ficha no dispara nada, como antes de abrir el sheet). Sin estado colgado.

export interface ListeningGateInput {
  /** ¿Hay ≥1 scanner acotado activo? (contador del provider > 0). Fuerza la escucha si true. */
  scopedScannerActive: boolean;
  /** ¿El listener global está habilitado? (enable/disable — MODO MANIOBRAS lo suspende, R10.7). */
  enabled: boolean;
  /** ¿Modo "ocupado"? (form CREATE/EDIT abierto — la ficha lo prende con useBusyWhileMounted, R10.6). */
  busy: boolean;
}

/**
 * ¿El listener debe estar escuchando ahora? Un scanner acotado gana siempre; si no, `enabled && !busy`.
 */
export function resolveListening({ scopedScannerActive, enabled, busy }: ListeningGateInput): boolean {
  return scopedScannerActive || (enabled && !busy);
}
