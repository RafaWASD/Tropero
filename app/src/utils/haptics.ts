// Haptic feedback helper (drag del wizard de jornada, spec 03 M1.4 — y reutilizable).
//
// El proyecto NO tiene expo-haptics en deps; el patrón establecido para feedback táctil es el módulo
// `Vibration` de react-native (ver services/ble/feedback.ts). Centralizamos acá un par de "pulsos"
// hápticos cortos (agarrar / soltar una fila al reordenar) con el MISMO idioma: import perezoso de RN
// (web-safe → degrada en silencio, la vibración de desktop es pobre/nula) y best-effort (nunca rompe el
// flujo si la API no está). Patrón idéntico a feedback.ts (R4.5 generaliza: el feedback nunca crashea).
//
// Por qué no expo-haptics: sumarlo abriría superficie de postinstall (onlyBuiltDependencies, ADR-011) por
// un beneficio marginal sobre Vibration; cuando el dev build sume un canal háptico más rico, se enchufa acá.

/** Acceso perezoso a Vibration (no arrastra RN a node:test; degrada en silencio en web/sin módulo). */
function vibrate(pattern: number | number[]): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Vibration } = require('react-native') as typeof import('react-native');
    Vibration.vibrate(pattern);
  } catch {
    // Sin Vibration (web/SSR/test) → sin háptica, no rompe el flujo.
  }
}

/** Pulso corto al AGARRAR una fila para arrastrarla (confirma que el drag "agarró"). */
export function hapticPickUp(): void {
  vibrate(12);
}

/** Pulso corto al SOLTAR la fila en su nueva posición (confirma el commit del reorder). */
export function hapticDrop(): void {
  vibrate(18);
}
