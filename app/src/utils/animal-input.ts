// Sanitizadores PUROS de los inputs del alta de animal (spec 02/09 fix-loop C2, FIX 2).
//
// Filosofía: PREVENIR, no errorear. El operario no debería poder tipear basura (letras en una fecha
// o un peso, 40 dígitos en una caravana de 15) y descubrirlo recién al submit. Estos helpers se
// enganchan en `onChangeText` de cada campo del form: filtran/limitan EN VIVO lo que entra, así el
// estado del form nunca contiene un valor imposible. Es el mismo patrón que `sanitizePhoneInput`
// del perfil (Fase 6).
//
// Sin RN, sin red: testeable con node:test (mismo patrón que animal-form.ts / validation.ts).
// La validación de submit (animal-form.ts) sigue como ÚLTIMO recurso (un valor parcial válido en
// caracteres pero incompleto, ej. "2024-1" en la fecha, lo caza el validador), pero el grueso de
// los errores los corta el sanitizador antes de que ocurran.

// ─── Topes de longitud (formato real del dominio) ──────────────────────────────────────
// Caravana electrónica FDX-B / ISO 11784/11785: exactamente 15 dígitos (prefijo país 982/032…).
export const TAG_ELECTRONIC_LENGTH = 15;
// IDV / caravana VISUAL oficial: ALFANUMÉRICA (formato CUIG/binomio, NO numérica). El binomio actual
// (SENASA Res. 841/2025) es CUIG "AB123" + identificación individual "A000".."ZZZ9" + dígito
// verificador ≈ 15 chars, replicando los 15 de la electrónica; la vieja "AR"+9 dígitos = 11 entra
// holgada. Tope alineado a esos 15.
export const IDV_MAX_LENGTH = 15;
// Identificación visual: texto libre (color, seña, número de manga corto) pero acotado.
export const VISUAL_MAX_LENGTH = 30;
// Fecha ISO 'YYYY-MM-DD' = 10 caracteres con los guiones.
const DATE_MASK_LENGTH = 10;
// Peso de bovino: máximo 4 cifras ENTERAS. El bovino más pesado registrado pesó 1.740 kg; ninguno
// llegó a 5 cifras (10.000 kg). Los decimales (ej. 320,5) NO se limitan. Compartido por el peso de
// entrada del alta (C2) y el evento de peso (C3): ambos son pesos de bovino, el cap aplica igual.
export const WEIGHT_INTEGER_MAX_DIGITS = 4;

/**
 * Caravana electrónica: solo dígitos, máximo 15 (FDX-B). Descarta cualquier no-dígito que el
 * teclado (o un paste) deje pasar. No agrega validación semántica (eso lo hace isValidTagElectronic).
 */
export function sanitizeTagInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, TAG_ELECTRONIC_LENGTH);
}

/**
 * IDV / caravana VISUAL oficial: ALFANUMÉRICA (formato CUIG/binomio). Filtra a letras + dígitos,
 * descartando separadores/espacios/otros, y acota a IDV_MAX_LENGTH. La caravana visual argentina NO
 * es numérica: es el binomio CUIG ("AB123") + identificación individual + dígito verificador. NO
 * fuerza mayúsculas (se acepta como se tipea); los separadores de display no se tipean en el campo.
 */
export function sanitizeIdvInput(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').slice(0, IDV_MAX_LENGTH);
}

/**
 * Identificación visual: texto libre acotado. No filtra caracteres (puede ser "vaca blanca", "R-14"),
 * solo limita el largo para que un IDV de 40+ chars no wrappee la ficha.
 */
export function sanitizeVisualInput(raw: string): string {
  return raw.slice(0, VISUAL_MAX_LENGTH);
}

/**
 * Máscara de fecha AAAA-MM-DD EN VIVO: el operario tipea solo dígitos y los guiones se insertan
 * solos (no se puede tipear "asdasd" ni meter un guion suelto). Acepta que el usuario borre
 * (backspace) porque trabajamos siempre desde los dígitos crudos del valor entrante.
 *
 *   "2024"      → "2024"
 *   "202401"    → "2024-01"
 *   "20240115"  → "2024-01-15"
 *   "2024-01-1" → "2024-01-1"   (parcial, válido en caracteres; el validador de submit lo completa)
 *   "abc2024"   → "2024"        (descarta letras)
 *   "2024011599"→ "2024-01-15"  (8 dígitos máximo)
 */
export function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8); // AAAAMMDD = 8 dígitos
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  let out = year;
  if (digits.length > 4) out += `-${month}`;
  if (digits.length > 6) out += `-${day}`;
  return out.slice(0, DATE_MASK_LENGTH);
}

/**
 * Peso (decimal): dígitos + UN solo separador decimal (coma o punto, es-AR). Descarta letras y
 * separadores extra. La parte ENTERA se acota a WEIGHT_INTEGER_MAX_DIGITS (4): ningún bovino llega a
 * 5 cifras (ver constante). Los decimales NO se limitan. No fuerza el valor > 0 (eso lo valida
 * parseWeight/animal-form/validateWeight al submit), solo impide tipear "dasdas".
 *
 *   "180"     → "180"
 *   "320,5"   → "320,5"
 *   "32.5"    → "32.5"
 *   "1740"    → "1740"
 *   "12345"   → "1234"  (parte entera acotada a 4 dígitos)
 *   "99999"   → "9999"
 *   "12345,5" → "1234,5" (cap solo sobre los enteros; los decimales se mantienen)
 *   "1,2,3"   → "1,23"   (un solo separador; el resto de comas se descartan)
 *   "abc12"   → "12"
 *   ",5"      → ",5"     (separador inicial permitido; el validador lo resuelve)
 */
export function sanitizeWeightInput(raw: string): string {
  // Quedarnos con dígitos y separadores; luego colapsar a UN solo separador (el primero) y acotar la
  // parte entera (los dígitos ANTES del separador) a WEIGHT_INTEGER_MAX_DIGITS.
  let seenSeparator = false;
  let out = '';
  let integerDigits = 0;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      // Antes del separador: contamos enteros y cortamos al tope. Después: los decimales no se limitan.
      if (!seenSeparator) {
        if (integerDigits >= WEIGHT_INTEGER_MAX_DIGITS) continue; // 5to+ dígito entero → descartado
        integerDigits += 1;
      }
      out += ch;
    } else if ((ch === ',' || ch === '.') && !seenSeparator) {
      seenSeparator = true;
      out += ch;
    }
    // cualquier otra cosa (letras, 2do separador) se descarta
  }
  return out;
}

/**
 * ¿La caravana electrónica es válida para submit? Vacía OK (es opcional/recomendada, R4.3) o
 * exactamente 15 dígitos. Espeja la forma FDX-B. (El sanitizador ya garantiza "solo dígitos ≤15",
 * así que acá solo chequeamos el largo exacto cuando no está vacía.)
 */
export function isValidTagElectronic(value: string): boolean {
  const t = value.trim();
  if (t.length === 0) return true;
  return /^\d{15}$/.test(t);
}
