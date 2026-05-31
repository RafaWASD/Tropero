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
 * Devuelve copy en voseo para un error de auth. `context` afina el mensaje según
 * el flujo (login vs signup), porque el mismo code/status puede leerse distinto.
 */
export function authErrorMessage(
  error: AuthErrorLike | null | undefined,
  context: 'signin' | 'signup' | 'reset' | 'resend' | 'generic' = 'generic',
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
    default:
      return GENERIC;
  }
}
