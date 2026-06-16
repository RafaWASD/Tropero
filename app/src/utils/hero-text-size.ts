// Lógica PURA del TAMAÑO del texto HERO de un nombre de longitud variable (spec 03 M3.2b, fix web).
// Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón que condition-stepper.ts).
//
// PROBLEMA (web): el hero del producto del paso silent_apply (SilentSanitaryStep — Antiparasitario /
// Antibiótico / Inseminación-single) mostraba el nombre a un tamaño FIJO ($11 = 64px) con
// `adjustsFontSizeToFit` para que un nombre largo se encogiera. Pero `adjustsFontSizeToFit` es NO-OP en
// react-native-web (gotcha del repo, memoria reference_rn_web_pitfalls) → el nombre largo NO se encogía y
// overfloweaba horizontal saliéndose de la pantalla ("Ivermectinaaaa…" gigante, cortado por ambos lados).
//
// SOLUCIÓN web-safe: en vez de medir en runtime (que web no hace con adjustsFontSizeToFit), elegimos el
// tamaño por la LONGITUD del string en buckets — emulando lo que adjustsFontSizeToFit debía hacer, pero de
// forma determinística y sin measuring. El criterio (dirección del leader): un nombre TÍPICO de producto
// veterinario entra COMPLETO y GRANDE (dominante, legible a pleno sol en manga); un nombre LARGO entra
// completo más chico. El hero se renderiza con `numberOfLines={2}` y word-break, así que cada bucket está
// calibrado para que su tamaño quepa en ≤2 líneas dentro del ancho útil de la card a 360px (el ancho de
// pantalla más chico que soportamos) — el caso patológico (un string larguísimo SIN espacios) lo absorbe el
// word-break + el último bucket + la elipsis del componente, nunca el overflow horizontal.
//
// El tamaño se expresa como un TOKEN de la escala tipográfica Inter ($7..$11 = 20..64px) — cero hardcode
// (ADR-023 §4): el componente lo consume como `fontSize`/`lineHeight` con su par matching (recorte de
// descendentes). Acá solo decidimos QUÉ token según la longitud; los px viven en tamagui.config.ts.

/** Los escalones tipográficos que usa el hero (de la escala Inter de tamagui.config.ts). */
export type HeroSizeToken = '$7' | '$8' | '$9' | '$10' | '$11';

/**
 * Un token de la escala tipográfica con su par `lineHeight` matching (regla dura de recorte de
 * descendentes g/q/p/j/y: en Tamagui el `fontSize` suelto no aplica el lineHeight del token, hay que
 * setearlo a la par — memoria feedback_descender_clipping). El tipo es la unión EXACTA de los escalones
 * (no `$${number}` genérico) para que Tamagui acepte el valor como prop `fontSize`/`lineHeight` tipada.
 */
export type HeroFontToken = {
  /** Token de `fontSize` (ej. "$11"). */
  fontSize: HeroSizeToken;
  /** Token de `lineHeight` matching (mismo número que fontSize). */
  lineHeight: HeroSizeToken;
};

/**
 * Escalones de tamaño del hero, de MÁS grande a MÁS chico. El componente arranca por el más grande cuyo
 * `maxChars` cubra la longitud del nombre. Calibración (Inter, ancho útil de la card ~296px a 360px de
 * pantalla, hasta 2 líneas con word-break):
 *   $11 (64px) — nombre corto (hasta ~10 ch): "Ivermectina" no llega; "Aftosa", "Mancha", "Toro 123" sí.
 *   $10 (38px) — nombre típico (hasta ~16 ch): "Ivermectina"(11), "Bencimidazol"(12), "Oxitetraciclina"(15).
 *   $9  (30px) — nombre largo (hasta ~24 ch): "Closantel + Ivermectina"(23), pajuelas "GANADOR 1234 RA".
 *   $8  (23px) — nombre muy largo (hasta ~40 ch): combinaciones largas / códigos de pajuela con sufijos.
 *   $7  (20px) — piso: cualquier cosa más larga (el caso patológico) → además word-break + elipsis a 2 líneas.
 * Cada paso entra COMPLETO en ≤2 líneas a 360px; el bucket más chico es el piso de legibilidad de manga
 * (20px sigue siendo grande/legible a pleno sol; por debajo no bajamos — preferimos elipsar).
 */
const HERO_STEPS: ReadonlyArray<{ maxChars: number; token: HeroFontToken }> = [
  { maxChars: 10, token: { fontSize: '$11', lineHeight: '$11' } },
  { maxChars: 16, token: { fontSize: '$10', lineHeight: '$10' } },
  { maxChars: 24, token: { fontSize: '$9', lineHeight: '$9' } },
  { maxChars: 40, token: { fontSize: '$8', lineHeight: '$8' } },
];

/** Token piso (el más chico): para nombres más largos que el último escalón con `maxChars`. */
const HERO_FLOOR: HeroFontToken = { fontSize: '$7', lineHeight: '$7' };

/**
 * Elige el token de tamaño del hero según la LONGITUD del nombre (length-aware step-down, web-safe).
 * Devuelve el escalón MÁS grande cuyo `maxChars` cubra la longitud; si ninguno la cubre (nombre larguísimo,
 * incluido el patológico sin espacios), devuelve el piso ($7) — combinado con word-break + numberOfLines en
 * el componente, nunca overflowea horizontal.
 *
 * La longitud se mide sobre el nombre RECORTADO (trim): los espacios de borde no deben empujar a un bucket
 * más chico. Un nombre vacío (o el placeholder "Sin producto") es corto → token más grande (es texto fijo
 * y corto, no overflowea).
 */
export function heroFontTokenForName(name: string): HeroFontToken {
  const len = (name ?? '').trim().length;
  for (const step of HERO_STEPS) {
    if (len <= step.maxChars) return step.token;
  }
  return HERO_FLOOR;
}
