// Haptic feedback helper (drag del wizard de jornada, spec 03 M1.4 — y reutilizable).
//
// Centralizamos acá un par de "pulsos" hápticos cortos (agarrar / soltar una fila al reordenar, tick de
// la rueda) con import perezoso de RN (web-safe → degrada en silencio, la vibración de desktop es
// pobre/nula) y best-effort (nunca rompe el flujo si la API no está).
//
// ── CORRECCIÓN DE UN MOTIVO FALSO (2026-08-06) ───────────────────────────────────────────────────────
// Hasta hoy este encabezado decía «el proyecto NO tiene expo-haptics en deps» y justificaba: «sumarlo
// abriría superficie de postinstall (onlyBuiltDependencies, ADR-011)». Las dos afirmaciones son falsas y
// se verificaron ejecutando `npm view expo-haptics scripts dependencies`:
//   · `dependencies: {}` y los ÚNICOS scripts son lint/test/build/clean de `expo-module-scripts` — NO
//     hay `postinstall`, `install` ni `prepare`, así que el allowlist de pnpm ni se consulta. Instalarlo
//     no agregó una sola entrada a `onlyBuiltDependencies` (verificable en el diff de `package.json`).
//   · `ADR-013 §Capa 4 — Manga-friendly` ya lo listaba en el stack elegido («expo-haptics — feedback
//     táctil. El operario con guantes/barro siente la vibración aunque no vea la pantalla»). O sea que
//     esta nota contradecía al ADR, que está más arriba en la jerarquía de verdad.
// Lo que sumarlo SÍ cuesta es real y es otra cosa: cambia el FINGERPRINT del build nativo (trae módulo
// nativo → hace falta un build de EAS nuevo). Ese es el costo que hay que sopesar, no un postinstall que
// no existe.
//
// `expo-haptics` YA ESTÁ en deps desde esa fecha, y lo usa `services/ble/feedback.ts` (el canal táctil de
// la lectura del bastón, con patrones `notificationAsync` distintos para "entró" y "no sirvió"). Este
// módulo sigue con `Vibration` a propósito: sus dos consumidores (el reorder y la rueda inercial) piden
// ticks de 8–18 ms sin semántica de éxito/error, que es justo lo que `Vibration` hace bien y lo que
// `NotificationFeedbackType` NO expresa. Migrarlos a `impactAsync` es una decisión de UX de esas
// pantallas, no un arrastre de esta unidad.

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

/**
 * Tick MUY corto al cruzar un valor de la RUEDA inercial (spec 03 M6 — circunferencia escrotal, R14.5):
 * el operario siente cada valor sin mirar fijo (manga, operable con una mano + guante). Más ligero que
 * pick/drop (8ms vs 12/18) porque se dispara por cada celda durante un fling → tiene que ser un toque, no
 * un buzz. Best-effort/web-safe como el resto: degrada en silencio (la vibración de desktop es nula).
 */
export function hapticTick(): void {
  vibrate(8);
}
