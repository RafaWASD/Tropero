// Validación de inputs de los formularios de auth (spec 01, R1.1 / T3.2).
//
// Lógica PURA (sin RN, sin red): testeable con node:test. Las reglas:
//   - email: formato razonable (no RFC-completo, que es inviable y contraproducente;
//     un patrón pragmático que atrapa los typos comunes — falta @, falta dominio,
//     espacios). El backend (Supabase Auth) hace la validación autoritativa.
//   - password: mínimo 8 caracteres (R1.1 implícito vía T3.2 "password mínimo 8").
//   - name: no vacío (R1.1, dato obligatorio en signup).

import { type PhoneValue } from './phone';

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
//
// La lógica del teléfono se centralizó en `utils/phone.ts` (delta TELÉFONO, RTEL.2.9): un solo origen
// para la normalización, la máscara, los techos y el copy. Acá SOLO se re-exporta para no romper a los
// importadores históricos — nada se reimplementa. Cualquier regla nueva del teléfono va en phone.ts.

export {
  PHONE_MIN_DIGITS,
  PHONE_MAX_DIGITS,
  PHONE_MAX_LENGTH,
  phoneDigits,
  sanitizePhoneInput,
  isValidPhone,
} from './phone';

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
 * y de a lo sumo NAME_MAX_LENGTH chars; teléfono OPCIONAL. El email se cambia por un flujo aparte
 * (pantalla dedicada, R2.2) → no se valida acá. Copy en voseo.
 *
 * El teléfono llega como `PhoneValue` (los tres estados de `PhoneField`) y NO como texto crudo: el
 * componente es el único que ve lo tipeado (RTEL.3.1.1). `empty` es OK y persiste null (RTEL.5.4);
 * `incomplete` bloquea el guardado (RTEL.5.5).
 *
 * Devuelve `phoneInvalid` (bandera) y NO un mensaje: el copy puntual —"faltan dígitos", "sacá el 15" +
 * la sugerencia de un tap— lo deriva y lo muestra `PhoneField` sobre el propio campo, porque es el
 * único que ve el contenido tipeado (RTEL.6.4/RTEL.6.6/RTEL.6.7). Devolver acá un segundo mensaje
 * genérico lo pisaría con uno peor, que es exactamente la divergencia que este delta cierra.
 */
export function validateProfile(input: {
  name: string;
  phone: PhoneValue;
}): { name: FieldError; phoneInvalid: boolean; valid: boolean } {
  const name: FieldError = isValidPersonName(input.name) ? null : 'Ingresá tu nombre.';
  const phoneInvalid = input.phone.kind === 'incomplete';
  return { name, phoneInvalid, valid: !name && !phoneInvalid };
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
