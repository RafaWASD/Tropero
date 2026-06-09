// Lógica PURA del connector de PowerSync: construcción de credenciales + clasificación de errores
// de la upload queue (T1.5 / R3.1, R3.4, R3.5). SIN imports de supabase/RN/SDK → testeable con
// node:test. El connector real (connector.ts) importa `./supabase` (→ expo-secure-store) y NO carga
// bajo node:test; acá vive solo la decisión.
//
// NOTA de Run 1: este módulo cubre la BASE de CRUD plano + la clasificación transitorio/permanente.
// El mapeo op_intents→RPC, el overlay optimista y la idempotencia (R6.8–R6.12) son Run T6 (stubs
// marcados en connector.ts). Acá NO se decide nada de esas ramas.

/** Forma mínima de la sesión Supabase que precisamos (subset de Session de supabase-js). */
export type SessionLike = { access_token?: string | null } | null | undefined;

/** Credenciales que espera PowerSync (subset de PowerSyncCredentials). */
export type PowerSyncCredentialsLike = { endpoint: string; token: string };

/**
 * Construye las credenciales para PowerSync a partir del endpoint y la sesión Supabase actual.
 * PURA (testeable). Contrato del SDK (PowerSyncBackendConnector.fetchCredentials):
 *   - sin sesión / sin access_token → devolver null (NO conectar; el SDK reintenta cuando haya login).
 *   - con sesión → { endpoint, token: access_token }.
 * NUNCA loguea ni filtra el token (el connector tampoco).
 */
export function buildCredentials(
  endpoint: string,
  session: SessionLike,
): PowerSyncCredentialsLike | null {
  const token = session?.access_token;
  if (!token) return null;
  return { endpoint, token };
}

/**
 * ¿El error al subir una op es TRANSITORIO (red caída / 5xx)? Si sí, el connector RE-LANZA y la op
 * queda en la cola para reintento (R3.4) — NO se descarta. Si NO (permanente: RLS 42501, constraint,
 * check), el connector descarta la op para no bloquear el resto (R3.5/R8.1).
 *
 * PURA (testeable). Detecta lo transitorio por:
 *   - mensajes de red (supabase-js no setea code en fallos de fetch);
 *   - status HTTP 5xx / 429 (rate limit) cuando viene;
 *   - ausencia total de señal de "rechazo del servidor" → conservador: lo trata como TRANSITORIO
 *     (mejor reintentar que descartar a ciegas un dato de campo).
 * Un código de Postgres conocido de rechazo permanente (clase 23 constraint, 42501 RLS, 22/23 checks)
 * → NO transitorio.
 */
export function isTransientUploadError(error: unknown): boolean {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; status?: unknown };
  const msg = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (/network|failed to fetch|fetch failed|networkerror|timeout|timed out/i.test(msg)) {
    return true;
  }
  if (status !== undefined && (status >= 500 || status === 429)) {
    return true;
  }
  // Códigos de rechazo PERMANENTE del servidor (Postgres / PostgREST).
  if (isPermanentServerCode(code)) {
    return false;
  }
  if (status !== undefined && status >= 400 && status < 500) {
    // 4xx que NO es 429: rechazo del cliente (validación/authz) → permanente.
    return false;
  }
  // Sin señal clara de rechazo del servidor → conservador: reintentar.
  return true;
}

/**
 * ¿El `code` de Postgres/PostgREST es un rechazo PERMANENTE? (RLS, constraints, checks, dominio).
 * PURA. Cubre: 42501 (RLS/insufficient_privilege), clase 23 (integrity constraint: 23502 not_null,
 * 23503 fk, 23505 unique, 23514 check), 22xxx (data exception), 42xxx (syntax/undefined).
 */
export function isPermanentServerCode(code: string): boolean {
  if (!code) return false;
  if (code === '42501') return true;
  return /^(22|23|42)/.test(code);
}
