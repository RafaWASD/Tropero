// Validación de inputs de los formularios de auth (spec 01, R1.1 / T3.2).
//
// Lógica PURA (sin RN, sin red): testeable con node:test. Las reglas:
//   - email: formato razonable (no RFC-completo, que es inviable y contraproducente;
//     un patrón pragmático que atrapa los typos comunes — falta @, falta dominio,
//     espacios). El backend (Supabase Auth) hace la validación autoritativa.
//   - password: mínimo 8 caracteres (R1.1 implícito vía T3.2 "password mínimo 8").
//   - name: no vacío (R1.1, dato obligatorio en signup).

export const PASSWORD_MIN_LENGTH = 8;

// Patrón pragmático: <algo sin espacios ni @>@<algo sin espacios>.<tld de 2+>.
// No intenta ser RFC 5322 (eso valida cosas absurdas y rechaza válidas). Atrapa
// los errores reales del usuario en el campo.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}

export function isValidName(name: string): boolean {
  return name.trim().length > 0;
}

export type FieldError = string | null;

/** Valida el form de signup. Devuelve un error por campo (null = OK). Copy en voseo. */
export function validateSignUp(input: {
  name: string;
  email: string;
  password: string;
}): { name: FieldError; email: FieldError; password: FieldError; valid: boolean } {
  const name: FieldError = isValidName(input.name) ? null : 'Ingresá tu nombre.';
  const email: FieldError = isValidEmail(input.email)
    ? null
    : 'Ingresá un email válido.';
  const password: FieldError = isValidPassword(input.password)
    ? null
    : `La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  return { name, email, password, valid: !name && !email && !password };
}

// ─── Teléfono (R3.8 alta de campo / R2.1 perfil) ─────────────────────────────────

// Rango de dígitos de un teléfono válido (E.164: hasta 15 dígitos incluyendo el código de
// país; mínimo razonable de 8 para un fijo/celular sin código). Vacío se trata aparte (opcional).
export const PHONE_MIN_DIGITS = 8;
export const PHONE_MAX_DIGITS = 15;

// Máximo de caracteres TIPEABLES en un campo de teléfono (dígitos + separadores). Holgado sobre
// los 15 dígitos para permitir "+54 9 11 2345-6789" y similares con espacios/guiones/paréntesis.
export const PHONE_MAX_LENGTH = 20;

// Caracteres permitidos en el input de teléfono: dígitos + los separadores de formato comunes
// (`+`, `-`, `(`, `)` y espacio). Se usa para SANITIZAR lo que se tipea (las letras no entran).
const PHONE_ALLOWED_CHAR = /[\d+\-() ]/;

/**
 * Extrae solo los dígitos de un teléfono (descarta `+`, espacios, guiones, paréntesis y cualquier
 * otro caracter). Base de la validación por largo.
 */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Sanitiza en vivo lo que se tipea en un campo de teléfono: descarta cualquier caracter que no sea
 * dígito o separador permitido (`+ - ( ) ` y espacio) y recorta a PHONE_MAX_LENGTH. Las LETRAS no
 * pueden quedar en el campo (R2.1: el teléfono no acepta texto). Pura: la usa el onChangeText.
 */
export function sanitizePhoneInput(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (PHONE_ALLOWED_CHAR.test(ch)) out += ch;
    if (out.length >= PHONE_MAX_LENGTH) break;
  }
  return out;
}

/**
 * Teléfono válido (R3.8 alta de campo / R2.1 perfil): 8 a 15 dígitos (rango E.164), ignorando
 * separadores. NO acepta vacío (para el campo OBLIGATORIO del alta de campo); el perfil trata el
 * vacío como "sin teléfono" aparte (validateProfile).
 */
export function isValidPhone(phone: string): boolean {
  const digits = phoneDigits(phone);
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

// Largo máximo de un nombre de persona (R2.1). El saludo lo necesita no-vacío; el tope evita
// guardar basura / desbordar la UI.
export const NAME_MAX_LENGTH = 80;

/** Nombre de persona válido (R2.1): no vacío tras trim y de a lo sumo NAME_MAX_LENGTH chars. */
export function isValidPersonName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= NAME_MAX_LENGTH;
}

/** Valida el form de alta de campo (R3.3: nombre + provincia obligatorios). Copy en voseo. */
export function validateCreateEstablishment(input: {
  name: string;
  province: string;
}): { name: FieldError; province: FieldError; valid: boolean } {
  const name: FieldError = input.name.trim().length > 0 ? null : 'Ingresá el nombre del campo.';
  const province: FieldError =
    input.province.trim().length > 0 ? null : 'Ingresá la provincia.';
  return { name, province, valid: !name && !province };
}

// ─── Editar perfil (R2.1) ───────────────────────────────────────────────────────

/**
 * Valida el form de editar perfil (R2.1): nombre obligatorio (name not null, lo necesita el saludo)
 * y de a lo sumo NAME_MAX_LENGTH chars; teléfono OPCIONAL pero, si se ingresa, de 8 a 15 dígitos
 * (rango E.164). El email se cambia por un flujo aparte (pantalla dedicada, R2.2) → no se valida acá.
 * Copy en voseo.
 */
export function validateProfile(input: {
  name: string;
  phone: string;
}): { name: FieldError; phone: FieldError; valid: boolean } {
  const name: FieldError = isValidPersonName(input.name) ? null : 'Ingresá tu nombre.';
  // Teléfono opcional: vacío = OK (queda null, "sin teléfono"); si tiene algo, debe ser válido.
  const phone: FieldError =
    input.phone.trim().length === 0 || isValidPhone(input.phone)
      ? null
      : 'Ingresá un teléfono válido (8 a 15 dígitos).';
  return { name, phone, valid: !name && !phone };
}

// ─── Cambiar email (R2.1/R2.2) ───────────────────────────────────────────────────

/**
 * Valida el campo "nuevo email" de la pantalla de cambio de email (R2.1/R2.2): formato razonable
 * y distinto del email actual (case-insensitive). Devuelve el error de campo (null = OK). Pura.
 */
export function validateNewEmail(input: {
  newEmail: string;
  currentEmail: string | null;
}): FieldError {
  const candidate = input.newEmail.trim();
  if (!isValidEmail(candidate)) return 'Ingresá un email válido.';
  if (
    input.currentEmail &&
    candidate.toLowerCase() === input.currentEmail.trim().toLowerCase()
  ) {
    return 'Ese ya es tu email actual.';
  }
  return null;
}

/** Valida el form de login. Solo formato (el backend valida credenciales). Copy en voseo. */
export function validateSignIn(input: {
  email: string;
  password: string;
}): { email: FieldError; password: FieldError; valid: boolean } {
  const email: FieldError = isValidEmail(input.email)
    ? null
    : 'Ingresá un email válido.';
  // En login no exigimos longitud mínima de copy (la cuenta ya existe); solo que
  // no esté vacío, para no mostrar un error confuso sobre "8 caracteres" al loguear.
  const password: FieldError = input.password.length > 0 ? null : 'Ingresá tu contraseña.';
  return { email, password, valid: !email && !password };
}
