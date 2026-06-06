// adapter-hid-wedge — ⚠️ GATED. NO SE IMPLEMENTA en este run ni hasta pasar el GATE FÍSICO
// de ADR-024 §4 / R8.7. El Council fue enfático: no fijar arquitectura sobre un mecanismo no
// ejecutado en hardware real.
//
// Dirección elegida para el camino iOS-sin-MFi: un bastón BLE-HID que TIPEA el EID como
// teclado Bluetooth del SO en un TextInput de "scan" enfocado, en iOS y Android, sin MFi.
// NO es BLE GATT; NO usa react-native-ble-plx; el parser de stream NO aplica (R11.4) — el
// adaptador define su propia captura de keystrokes + Enter (R8.2).
//
// El gate (T5.0, BLOQUEANTE de esta fase) exige validar en iPhone REAL: (a) tipea los 15
// dígitos completos, (b) emite terminador Enter, (c) la supresión del teclado en pantalla de
// iOS no rompe la UX de manga, (d) el TextInput de RN con foco programático captura
// confiable. Hasta ese gate, este archivo es un PLACEHOLDER documentado SIN lógica activa.
//
// No exporta un StickAdapter funcional a propósito: el contrato y los otros 4 adaptadores
// operan sin él (manual-first). Cuando el gate pase, la Fase 5 lo implementa detrás de la
// MISMA interfaz StickAdapter sin tocar el contrato (R10.3, R11.3).

export const HID_WEDGE_GATED = true as const;

export const HID_WEDGE_GATE_REASON =
  'adapter-hid-wedge GATED por validación física en iPhone real (ADR-024 §4 / R8.7). No se implementa hasta pasar el gate.';
