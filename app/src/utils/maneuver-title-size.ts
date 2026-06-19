// Lógica PURA del TAMAÑO del TÍTULO (línea de maniobra) de longitud variable (spec 03 M5-CLIENTE bugfix).
// Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón que hero-text-size.ts).
//
// PROBLEMA (web, bug cazado en vivo por Raf): la LÍNEA DE MANIOBRA del frame (carga.tsx) muestra el label de
// la maniobra a `$5` (16px) con `numberOfLines={1}` → un label de maniobra CUSTOM largo (ej. "Ángulo de
// inclinación de pezuña posterior", 41 ch) se RECORTA con elipsis a una sola línea ("Ángulo de inclinación de
// pezuña …"). El operario no puede leer QUÉ está cargando.
//
// SOLUCIÓN (paridad con hero-text-size.ts, length-aware step-down web-safe): el label se renderiza con
// `numberOfLines={2}` (dos líneas, lineHeight matching para no recortar descendentes g/p/q/y) y su tamaño se
// elige por la LONGITUD del string en buckets. Un label TÍPICO de fábrica ("Tacto", "Condición corporal") o
// una custom de longitud normal entra COMPLETO a `$5` en ≤2 líneas; un label MUY largo baja a `$4` (14px) para
// caber en 2 líneas dentro del ancho útil de la fila a 360px (la pantalla más chica que soportamos). El caso
// patológico (string larguísimo sin espacios) lo absorbe el word-break + el último bucket + la elipsis de 2
// líneas del componente — nunca overflow ni recorte de 1 línea silencioso.
//
// El tamaño se expresa como TOKEN de la escala tipográfica Inter (`$4`/`$5`) — cero hardcode (ADR-023 §4): el
// componente lo consume como `fontSize`/`lineHeight` con su par matching. Acá solo decidimos QUÉ token según
// la longitud; los px viven en tamagui.config.ts.

/** Los escalones tipográficos que usa la línea de maniobra (subset de la escala Inter). */
export type ManeuverTitleSizeToken = '$4' | '$5';

/**
 * Un token de `fontSize` con su par `lineHeight` matching (regla dura de recorte de descendentes g/p/q/y: en
 * Tamagui el `fontSize` suelto NO aplica el lineHeight del token, hay que setearlo a la par — memoria
 * feedback_descender_clipping). El tipo es la unión EXACTA de los escalones (no `$${number}` genérico) para
 * que Tamagui acepte el valor como prop `fontSize`/`lineHeight` tipada.
 */
export type ManeuverTitleFontToken = {
  /** Token de `fontSize` (ej. "$5"). */
  fontSize: ManeuverTitleSizeToken;
  /** Token de `lineHeight` matching (mismo número que fontSize). */
  lineHeight: ManeuverTitleSizeToken;
};

/**
 * Escalón base (label típico): `$5` (16px). El label se renderiza a `$5`/`numberOfLines={2}` salvo que su
 * longitud exceda lo que entra cómodo en 2 líneas a 360px — ahí baja a `$4` (14px). Calibración: ancho útil de
 * la fila a 360px ≈ 270px (pantalla 360 − padding $4 ×2 − gap − contador "· N de M"); a 16px Inter entran ~33
 * ch/línea → ~66 ch en 2 líneas. El umbral se fija CONSERVADOR en 56 ch (margen para acentos/anchos variables)
 * → labels más largos que eso bajan a `$4` (~38 ch/línea → ~76 ch en 2 líneas).
 */
const MANEUVER_TITLE_BASE: ManeuverTitleFontToken = { fontSize: '$5', lineHeight: '$5' };

/** Token reducido (label muy largo): `$4` (14px), para que un label largo entre en ≤2 líneas a 360px. */
const MANEUVER_TITLE_SMALL: ManeuverTitleFontToken = { fontSize: '$4', lineHeight: '$4' };

/** Umbral (en caracteres del label recortado) sobre el cual el título baja de `$5` a `$4`. */
export const MANEUVER_TITLE_STEPDOWN_CHARS = 56;

/**
 * Elige el token de tamaño de la línea de maniobra según la LONGITUD del label (length-aware step-down,
 * web-safe). Devuelve `$5` para labels normales y `$4` para labels muy largos (> MANEUVER_TITLE_STEPDOWN_CHARS)
 * → combinado con `numberOfLines={2}` + word-break en el componente, el label entra completo o elipsa a 2
 * líneas, nunca a 1 línea silenciosa ni overflow.
 *
 * La longitud se mide sobre el label RECORTADO (trim): los espacios de borde no deben empujar a un bucket más
 * chico. Un label vacío es corto → token base.
 */
export function maneuverTitleFontToken(label: string): ManeuverTitleFontToken {
  const len = (label ?? '').trim().length;
  return len > MANEUVER_TITLE_STEPDOWN_CHARS ? MANEUVER_TITLE_SMALL : MANEUVER_TITLE_BASE;
}
