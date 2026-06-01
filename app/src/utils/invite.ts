// Lógica PURA de invitaciones (spec 01, Fase 5 / B.1.3). Sin RN, sin red, sin supabase-js:
// testeable con node:test (mismo patrón que validation/establishment/lockout).
//
// Cubre dos piezas que NO tocan I/O:
//   - parseInviteToken: extraer el token de un link pegado (universal/deep-link/crudo). R5.4/R6.5.
//   - inviteErrorCopy: mapear el `code` de error de las Edge Functions a copy legible en español.

import type { UserRole } from '../types';

// ─── parseInviteToken (R5.4 / R6.5) ─────────────────────────────────────────────
//
// El destinatario pega lo que recibió por WhatsApp/mail/etc. Aceptamos TRES formas:
//   1. URL universal:   https://app.rafq.ar/invite?token=XXX   (o cualquier host/path con ?token=)
//   2. Deep-link:       rafq://invite?token=XXX
//   3. Token crudo:     XXX (un UUID v4 que el usuario copió suelto)
// Cualquier basura (texto sin token, vacío) → null. El backend hace el lookup definitivo del
// token (accept_invitation); acá solo lo EXTRAEMOS para no mandar ruido al edge.

// UUID v4 canónico (lo que genera crypto.randomUUID() en invite_user/resend_invitation).
// Aceptamos cualquier versión/variante de UUID (8-4-4-4-12 hex) para no rechazar tokens
// válidos por una diferencia de versión; el backend valida la existencia real.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extrae el token de invitación de un input pegado por el usuario. Devuelve el token (string)
 * o null si no se reconoce.
 *
 * Estrategia, en orden:
 *   1. Si el input trimmeado YA es un UUID válido → es un token crudo, lo devolvemos.
 *   2. Si parsea como URL (http/https/rafq://) → tomamos el query param `token`. Si ese token
 *      es no vacío, lo devolvemos (sin re-validar formato UUID estricto: el backend manda;
 *      pero exigimos que exista y no esté vacío).
 *   3. Fallback tolerante: buscamos `token=...` con regex aunque la URL no parsee limpio (ej.
 *      el usuario pegó algo con espacios alrededor o un esquema raro). Tomamos hasta el primer
 *      separador (`&`, espacio, fin).
 *   4. Nada de lo anterior → null.
 *
 * Pura, sin I/O. No decodifica el token más allá de decodeURIComponent del valor del query
 * (por si vino percent-encoded, como lo emite invite_user con encodeURIComponent).
 */
export function parseInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // 1. Token crudo (UUID suelto).
  if (UUID_RE.test(trimmed)) return trimmed;

  // 2. Intento de parseo como URL (cubre https://… y rafq://…).
  const fromUrl = tokenFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  // 3. Fallback regex: `token=` en cualquier parte del string pegado.
  const m = trimmed.match(/[?&]token=([^&\s]+)/i) ?? trimmed.match(/(?:^|\s)token=([^&\s]+)/i);
  if (m && m[1]) {
    const decoded = safeDecode(m[1]);
    if (decoded.length > 0) return decoded;
  }

  return null;
}

/** Intenta parsear `raw` como URL y extraer el query param `token`. null si no aplica. */
function tokenFromUrl(raw: string): string | null {
  // `new URL` acepta esquemas custom (rafq://) y http(s). En esquemas custom el "host" puede
  // quedar en distintas partes según el runtime, pero el query (`?token=`) se preserva en
  // `.search` en los runtimes modernos (Hermes/web/node). Si no parsea, devolvemos null y el
  // fallback regex se encarga.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const token = url.searchParams.get('token');
  if (token && token.trim().length > 0) {
    return token.trim();
  }
  return null;
}

/** decodeURIComponent tolerante: si el valor no es percent-encoding válido, lo devuelve crudo. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s.trim();
  }
}

// ─── inviteErrorCopy (R5.6 / R5.9 / errores de las Edge Functions) ──────────────
//
// Las Edge Functions devuelven `{ error: { code, message } }` con status no-2xx. Mapeamos el
// `code` a copy accionable en español (UI en español, voseo). El `message` del backend es para
// logs, no para el usuario (suele ser técnico). Fallback genérico para códigos desconocidos.
//
// Códigos que emiten las funciones de Fase 2 (verificados leyendo los index.ts):
//   - invite_user:        invalid_input(400), forbidden(403), already_member(409),
//                         pending_exists(409), db_error(500), unexpected(500)
//   - accept_invitation:  invalid_input(400), not_found(404), invalid_state(409),
//                         expired(410), already_member(409), db_error/unexpected(500)
//   - cancel/resend:       invalid_input, forbidden(403), not_found(404), invalid_state(409)
//   - remove_member:      forbidden(403), not_found(404), last_owner(409)
//   - change_member_role: invalid_input, forbidden(403), not_found(404), no_change(409),
//                         last_owner(409)
//   - requireUser:         unauthorized(401)

const COPY: Record<string, string> = {
  // Ya es miembro (R5.9): el copy completo que nombra el rol se arma aparte (alreadyMemberCopy);
  // este es el fallback si no tenemos el rol a mano.
  already_member: 'Esta persona ya es miembro de este campo.',
  // Invitación en estado no-pending: aceptada (= ya usada, R5.6) o cancelada. Single-use de facto.
  invalid_state: 'Este link ya fue usado o fue cancelado. Pedile al dueño que te genere uno nuevo.',
  // Token no existe (404).
  not_found: 'No encontramos esa invitación. Verificá el link o pedile al dueño que te genere uno nuevo.',
  // Expirada (410).
  expired: 'Este link de invitación venció. Pedile al dueño que te genere uno nuevo.',
  // Sin permisos de owner (403).
  forbidden: 'No tenés permisos para hacer esto. Solo el dueño del campo puede.',
  // Último owner (409): no se puede remover/degradar al único dueño.
  last_owner: 'No se puede dejar al campo sin dueño. Asigná otro dueño antes de hacer esto.',
  // Ya hay una invitación pendiente con ese email (409).
  pending_exists: 'Ya hay una invitación pendiente para ese email. Cancelala o regenerala desde la lista.',
  // El miembro ya tiene ese rol (409).
  no_change: 'El miembro ya tiene ese rol.',
  // Input inválido (400) — no debería pasar con el form validado, pero por las dudas.
  invalid_input: 'Algunos datos no son válidos. Revisalos y probá de nuevo.',
  // Sesión inválida (401).
  unauthorized: 'Tu sesión expiró. Volvé a iniciar sesión y probá de nuevo.',
};

const FALLBACK_COPY = 'No pudimos completar la acción. Probá de nuevo en un momento.';

/**
 * Copy legible en español para un código de error de las Edge Functions. `code` puede venir
 * null/undefined (error sin body parseable, ej. fallo de red) → fallback. Pura.
 */
export function inviteErrorCopy(code: string | null | undefined): string {
  if (!code) return FALLBACK_COPY;
  return COPY[code] ?? FALLBACK_COPY;
}

/**
 * Copy de "ya sos miembro" que NOMBRA el rol actual (R5.9): "Ya sos miembro de este campo como
 * <rol>. Para cambiar tu rol, pedile al dueño que use Miembros → Cambiar rol." El rol viene del
 * contexto del que acepta (no lo expone el backend en el 409). Si no tenemos el rol, cae al copy
 * genérico de already_member. Pura.
 */
export function alreadyMemberCopy(role: UserRole | null): string {
  if (!role) return COPY.already_member;
  const label = ROLE_LABELS[role];
  return `Ya sos miembro de este campo como ${label}. Para cambiar tu rol, pedile al dueño que lo haga desde Miembros → Cambiar rol.`;
}

// Espejo de roleLabel (utils/establishment) — re-declarado acá para no acoplar este módulo puro
// a establishment.ts (que crece con dominio de campos). FUENTE ÚNICA conceptual: ambos derivan
// del mismo set de roles de ADR-006. Si divergen, el test lo detecta (mismo string esperado).
const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Dueño',
  field_operator: 'Operario',
  veterinarian: 'Veterinario',
};
