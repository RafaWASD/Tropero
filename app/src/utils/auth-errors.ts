// Traducción de errores de Supabase Auth a copy legible en español voseo
// (spec 01, T3.2 "manejo de errores de Supabase Auth"). Lógica PURA y testeable.
//
// supabase-js v2 expone en AuthError tanto `.message` (texto en inglés del server)
// como, en versiones recientes, `.code` (string estable, ej. 'invalid_credentials',
// 'user_already_exists', 'weak_password', 'over_request_rate_limit'). Mapeamos por
// `code` cuando está y caemos a heurística sobre el `message` para versiones que no
// lo traen. Nunca mostramos el stack ni el texto crudo del server al usuario
// (docs/conventions.md §Errores: mensajes accionables, no "Network Error").

export type AuthErrorLike = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
  name?: string | null;
};

const GENERIC = 'No pudimos completar la operación. Probá de nuevo en un momento.';
const NETWORK = 'Sin conexión. Revisá tu internet e intentá de nuevo.';

/**
 * ¿El error es un fallo de RED o un RATE-LIMIT del server? Decide mirando el error
 * CRUDO (code/status/name/message), NO el copy ya traducido. Sirve para decidir
 * control de flujo (ej. forgot-password: mostrar el error real vs. el mensaje neutro
 * anti-enumeración) sin acoplarse al texto, que puede cambiar.
 *
 * Es la misma detección que usa authErrorMessage para las ramas NETWORK y rate-limit;
 * mantenerlas alineadas. Fail-closed: error nulo/desconocido → false (no es accionable).
 */
export function isNetworkOrRateLimit(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;

  const code = (error.code ?? '').toLowerCase();
  const msg = (error.message ?? '').toLowerCase();
  const name = (error.name ?? '').toLowerCase();
  const status = error.status ?? null;

  // Sin red: 'Failed to fetch' / 'Network request failed' / AuthRetryableFetchError.
  const isNetwork =
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    name.includes('retryable');

  // Rate limit (incluye el lockout nativo de Supabase Auth, R1.7 server-side).
  const isRateLimit =
    code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429;

  return isNetwork || isRateLimit;
}

/**
 * Devuelve copy en voseo para un error de auth. `context` afina el mensaje según
 * el flujo (login vs signup), porque el mismo code/status puede leerse distinto.
 */
export function authErrorMessage(
  error: AuthErrorLike | null | undefined,
  context: 'signin' | 'signup' | 'reset' | 'resend' | 'social' | 'generic' = 'generic',
): string {
  if (!error) return GENERIC;

  const code = (error.code ?? '').toLowerCase();
  const msg = (error.message ?? '').toLowerCase();
  const status = error.status ?? null;

  // Sin red: supabase-js / fetch tiran 'Failed to fetch' / 'Network request failed'
  // o un AuthRetryableFetchError. No hay status HTTP útil.
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    (error.name ?? '').toLowerCase().includes('retryable')
  ) {
    return NETWORK;
  }

  // Login social (spec 19, D7/R6.3–R6.4). Los servicios `*-auth.native.ts` normalizan el code opaco de
  // la lib a un code canónico estable ANTES de llegar acá (la cancelación NO llega: el servicio devuelve
  // { ok:false } sin error → silencio, R6.1). Nunca se filtra config ni el mensaje crudo del proveedor.
  if (code === 'developer_error') {
    // Misconfig de client ID / SHA-1 (Google). NO exponer detalle (R6.3).
    return 'No pudimos iniciar con Google. Probá con tu email y contraseña.';
  }
  if (code === 'play_services_not_available') {
    // Dispositivo sin Google Play (ej. Huawei) → degradar a email/password (R6.4).
    return 'Necesitás Google Play para iniciar con Google. Usá tu email y contraseña.';
  }

  // Rate limit (incluye el lockout nativo de Supabase Auth, R1.7 server-side).
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429) {
    return 'Demasiados intentos. Esperá unos minutos antes de volver a probar.';
  }

  // Email ya registrado (signup).
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered') || msg.includes('already been registered')) {
    return 'Ese email ya tiene una cuenta. Probá iniciar sesión o recuperar la contraseña.';
  }

  // Credenciales inválidas (login).
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Email o contraseña incorrectos.';
  }

  // Password débil (signup / update).
  if (code === 'weak_password' || msg.includes('password should be at least') || msg.includes('weak password')) {
    return 'La contraseña es muy débil. Usá al menos 8 caracteres.';
  }

  // Email no confirmado (login con cuenta sin verificar — aunque R1.3 permite login,
  // algunos proyectos lo bloquean; cubrimos el caso por las dudas).
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Tenés que verificar tu email antes de continuar. Revisá tu casilla.';
  }

  // Email inválido reportado por el server.
  if (code === 'validation_failed' || code === 'email_address_invalid' || msg.includes('invalid email')) {
    return 'El email no es válido.';
  }

  // Fallback por contexto: algo salió mal pero no lo reconocimos.
  switch (context) {
    case 'signup':
      return 'No pudimos crear la cuenta. Revisá los datos e intentá de nuevo.';
    case 'signin':
      return 'No pudimos iniciar sesión. Intentá de nuevo.';
    case 'reset':
      return 'No pudimos enviar el email de recuperación. Intentá de nuevo.';
    case 'resend':
      return 'No pudimos reenviar el email. Intentá de nuevo en un momento.';
    case 'social':
      // Fallback social genérico (R6.5): invita al fallback email/password sin filtrar el motivo crudo.
      return 'No pudimos iniciar sesión con ese método. Probá con tu email y contraseña.';
    default:
      return GENERIC;
  }
}
