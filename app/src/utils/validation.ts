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

// ─── Crear establecimiento (R3.1/R3.3/R3.8) ────────────────────────────────────

/** Teléfono no vacío (R3.8). El formato exacto AR no se valida acá (lo afinamos si hace
 * falta); exigimos al menos algunos dígitos para no guardar basura. */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8;
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
 * Valida el form de editar perfil (R2.1): nombre obligatorio (R1.1, name not null), teléfono
 * OPCIONAL pero válido si se ingresa. No valida el email (cambiar el email dispara verificación,
 * R2.2 — fuera de Run 1; el campo es solo-lectura). Copy en voseo.
 */
export function validateProfile(input: {
  name: string;
  phone: string;
}): { name: FieldError; phone: FieldError; valid: boolean } {
  const name: FieldError = isValidName(input.name) ? null : 'Ingresá tu nombre.';
  // Teléfono opcional: vacío = OK (no lo borramos forzosamente); si tiene algo, debe ser válido.
  const phone: FieldError =
    input.phone.trim().length === 0 || isValidPhone(input.phone)
      ? null
      : 'Ingresá un teléfono válido (al menos 8 dígitos) o dejalo vacío.';
  return { name, phone, valid: !name && !phone };
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
