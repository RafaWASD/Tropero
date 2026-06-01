// Capa de datos de miembros e invitaciones (spec 01, Fase 5 / B.1.3).
//
// Dos clases de operación:
//   1. LECTURAS directas a Supabase (RLS protege server-side):
//        - loadMembers: filas de user_roles activas del campo (owner ve todas; no-owner ve solo
//          la suya, por la policy user_roles_select 0008). Join a users SOLO por id+name (hallazgo
//          RLS #2: no traer phone/email de otros).
//        - loadPendingInvitations: invitations status=pending del campo (RLS owner-only, 0008).
//   2. WRAPPERS de las Edge Functions de Fase 2 (operaciones que requieren admin/validación
//      cruzada: invitar, cancelar, regenerar, remover, cambiar rol, aceptar). Vía
//      supabase.functions.invoke; el JWT lo agrega supabase-js solo.
//
// Helper de invoke (invokeFn): normaliza el shape de respuesta a un Result tipado con el `code`
// del error. supabase-js devuelve, en no-2xx, `{ data: null, error: FunctionsHttpError }` y el
// body real (`{ error: { code, message } }`) queda en `error.context` (una Response) → hay que
// hacer `await error.context.json()` para leer el code. Centralizamos ese unwrap acá.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id; siempre llega del
// contexto/llamador. NUNCA se expone phone/email de otros usuarios (hallazgo RLS #2).

import { supabase } from './supabase';
import type { UserRole } from '../types';

// Base URL para reconstruir el accept_url de invitaciones PENDIENTES a partir del token. Las
// invitaciones recién creadas/regeneradas ya traen `accept_url` del backend; para las que listamos
// (que solo tienen el token en la fila) reconstruimos el link con esta base. DEBE coincidir con el
// `APP_URL` del backend (invite_user/resend_invitation: `${APP_URL}/invite?token=...`, default
// `https://app.rafq.ar`). Si el backend cambia APP_URL en secrets, actualizar acá.
export const INVITE_BASE_URL = 'https://app.rafq.ar';

/** Reconstruye el accept_url shareable de una invitación pendiente a partir de su token. */
export function inviteUrlForToken(token: string): string {
  return `${INVITE_BASE_URL}/invite?token=${encodeURIComponent(token)}`;
}

// ─── Tipos de dominio ───────────────────────────────────────────────────────────

/** Un miembro del campo: rol + identidad mínima (id + name). NUNCA phone/email (RLS #2). */
export type Member = {
  userId: string;
  /** Nombre del usuario (de users.name). Puede ser '' si no lo completó. */
  name: string;
  role: UserRole;
  /** ¿Es el usuario actual? → marcador "vos". */
  isCurrentUser: boolean;
};

/** Una invitación pendiente del campo (owner-only). */
export type PendingInvitation = {
  id: string;
  role: UserRole;
  /** Email-anotación opcional (R5.1): etiqueta del owner, no se valida. null si no se anotó. */
  email: string | null;
  createdAt: string;
  expiresAt: string;
  /** Token vigente → reconstruye el accept_url para copiar/compartir. */
  token: string;
};

// ─── Result tipado ──────────────────────────────────────────────────────────────

export type ServiceError = {
  /** 'network' = fallo de fetch sin status; 'fn' = el edge devolvió un error con code; 'unknown'. */
  kind: 'network' | 'fn' | 'unknown';
  /** Código del error del edge (`error.code`), si lo hubo. Para mapear a copy con inviteErrorCopy. */
  code: string | null;
  /** Mensaje crudo (logs/diagnóstico, no para el usuario directo). */
  message: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

// ─── Helper de invoke de Edge Functions ──────────────────────────────────────────

/**
 * Invoca una Edge Function y normaliza la respuesta a Result<T>. Desempaqueta el error del shape
 * de supabase-js: en no-2xx, `functions.invoke` devuelve `{ data:null, error: FunctionsHttpError }`
 * y el body (`{ error: { code, message } }`) queda en `error.context` (una Response). Hacemos
 * `await error.context.json()` dentro de un try para leer el `code`. En éxito (2xx), `data` ES el
 * objeto de datos (jsonOk(data) del backend) → lo devolvemos como value.
 *
 * También cubre el caso defensivo de un 2xx que igual trae `{ error: {...} }` en el body (no
 * debería con jsonOk/jsonError, pero blindamos como push-notifications.ts).
 */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<Result<T>> {
  let data: unknown;
  let error: unknown;
  try {
    const res = await supabase.functions.invoke(name, { body });
    data = res.data;
    error = res.error;
  } catch (err) {
    // Fallo de red antes de tener respuesta (offline, DNS, etc.).
    return {
      ok: false,
      error: { kind: 'network', code: null, message: err instanceof Error ? err.message : String(err) },
    };
  }

  if (error) {
    // Intentamos leer el body de error del edge (queda en error.context como Response).
    const parsed = await readEdgeError(error);
    return { ok: false, error: parsed };
  }

  // Defensa: un 2xx que igual trae { error } en el body (no debería con jsonOk).
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const inner = (data as { error?: { code?: unknown; message?: unknown } }).error;
    return {
      ok: false,
      error: {
        kind: 'fn',
        code: typeof inner?.code === 'string' ? inner.code : null,
        message: typeof inner?.message === 'string' ? inner.message : 'Error de la función.',
      },
    };
  }

  return { ok: true, value: data as T };
}

/** Lee el `{ error: { code, message } }` del cuerpo de un FunctionsHttpError de supabase-js. */
async function readEdgeError(error: unknown): Promise<ServiceError> {
  const message = error instanceof Error ? error.message : String(error);
  // FunctionsHttpError trae el Response en .context. FunctionsFetchError (red) no tiene body útil.
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = (await (context as Response).json()) as { error?: { code?: unknown; message?: unknown } };
      const code = typeof body?.error?.code === 'string' ? body.error.code : null;
      const msg = typeof body?.error?.message === 'string' ? body.error.message : message;
      return { kind: 'fn', code, message: msg };
    } catch {
      // El body no era JSON parseable: caemos al mensaje genérico con kind fn igual.
      return { kind: 'fn', code: null, message };
    }
  }
  // Sin context con json() → probablemente un error de red/fetch.
  if (/network|failed to fetch|fetch failed/i.test(message)) {
    return { kind: 'network', code: null, message };
  }
  return { kind: 'unknown', code: null, message };
}

// ─── Lecturas directas (RLS) ──────────────────────────────────────────────────────

export type LoadMembersResult =
  | { ok: true; members: Member[] }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

function classifyQueryError(error: { message?: string } | null): {
  kind: 'network' | 'unknown';
  message: string;
} {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

// Forma cruda de la fila de user_roles con el user embebido (join PostgREST por la FK user_id).
type MemberRow = {
  role: UserRole;
  user_id: string;
  user: { id: string; name: string | null } | null;
};

/**
 * Lista los miembros ACTIVOS del campo (R5.1/T5.1). Selecciona SOLO `id, name` del user embebido
 * (hallazgo RLS #2: la coworkers policy 0006 expone la fila completa de users, pero NO traemos
 * phone/email de otros). El email del miembro NO se muestra (no hace falta).
 *
 * RLS owner-céntrica (hallazgo #1): la policy user_roles_select (0008) deja al OWNER ver TODAS las
 * filas de su campo; un NO-OWNER solo ve su PROPIA fila. Así, esta query devuelve la lista completa
 * al owner y solo {la suya} a un no-owner — la pantalla se adapta a eso (no forzamos la lista
 * completa para no-owner; sería un delta backend fuera de scope).
 *
 * Marca `isCurrentUser` comparando contra `currentUserId` (para el marcador "vos").
 */
export async function loadMembers(
  establishmentId: string,
  currentUserId: string,
): Promise<LoadMembersResult> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role, user_id, user:users ( id, name )')
    .eq('establishment_id', establishmentId)
    .eq('active', true);

  if (error) {
    return { ok: false, error: classifyQueryError(error) };
  }

  const rows = (data ?? []) as unknown as MemberRow[];
  const members: Member[] = rows.map((r) => ({
    userId: r.user_id,
    name: r.user?.name ?? '',
    role: r.role,
    isCurrentUser: r.user_id === currentUserId,
  }));
  return { ok: true, members };
}

export type LoadPendingInvitationsResult =
  | { ok: true; invitations: PendingInvitation[] }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

type PendingRow = {
  id: string;
  role: UserRole;
  email: string | null;
  created_at: string;
  expires_at: string;
  token: string;
};

/**
 * Lista las invitaciones PENDIENTES del campo (R5.12/T5.3). RLS owner-only (policy de invitations,
 * 0008): un no-owner recibe 0 filas. La pantalla solo muestra esta sección al owner.
 */
export async function loadPendingInvitations(
  establishmentId: string,
): Promise<LoadPendingInvitationsResult> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, role, email, created_at, expires_at, token')
    .eq('establishment_id', establishmentId)
    .eq('status', 'pending');

  if (error) {
    return { ok: false, error: classifyQueryError(error) };
  }

  const rows = (data ?? []) as unknown as PendingRow[];
  const invitations: PendingInvitation[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    email: r.email,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    token: r.token,
  }));
  return { ok: true, invitations };
}

// ─── Wrappers de Edge Functions (Result con code) ─────────────────────────────────

/** Rol invitable (R5.1): NO se puede invitar como owner (invite_user devuelve 400). */
export type InvitableRole = 'field_operator' | 'veterinarian';

export type CreatedInvitation = {
  invitationId: string;
  token: string;
  acceptUrl: string;
  expiresAt: string;
};

/** invite_user (T5.2 / R5.1/R5.2): crea la invitación y devuelve el accept_url shareable. */
export function createInvitation(args: {
  establishmentId: string;
  role: InvitableRole;
  email?: string | null;
}): Promise<Result<CreatedInvitation>> {
  const body: Record<string, unknown> = {
    establishment_id: args.establishmentId,
    role: args.role,
  };
  const email = args.email?.trim();
  if (email) body.email = email;
  return mapInviteResult(invokeFn('invite_user', body));
}

async function mapInviteResult(
  p: Promise<Result<{ invitation_id: string; token: string; accept_url: string; expires_at: string }>>,
): Promise<Result<CreatedInvitation>> {
  const r = await p;
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      invitationId: r.value.invitation_id,
      token: r.value.token,
      acceptUrl: r.value.accept_url,
      expiresAt: r.value.expires_at,
    },
  };
}

/** cancel_invitation (T5.3 / R5.7). */
export function cancelInvitation(invitationId: string): Promise<Result<unknown>> {
  return invokeFn('cancel_invitation', { invitation_id: invitationId });
}

export type RegeneratedInvitation = { token: string; acceptUrl: string; expiresAt: string };

/** resend_invitation = "regenerar link" (T5.3 / R5.8): nuevo token, el viejo muere. */
export async function regenerateInvitation(
  invitationId: string,
): Promise<Result<RegeneratedInvitation>> {
  const r = await invokeFn<{ token: string; accept_url: string; expires_at: string }>(
    'resend_invitation',
    { invitation_id: invitationId },
  );
  if (!r.ok) return r;
  return {
    ok: true,
    value: { token: r.value.token, acceptUrl: r.value.accept_url, expiresAt: r.value.expires_at },
  };
}

/** remove_member (T5.6 / R4.7): no remueve al último owner. */
export function removeMember(args: {
  userId: string;
  establishmentId: string;
}): Promise<Result<unknown>> {
  return invokeFn('remove_member', {
    user_id: args.userId,
    establishment_id: args.establishmentId,
  });
}

/** change_member_role (T5.5 / R4.5): no degrada al último owner; destino field_operator/veterinarian. */
export function changeMemberRole(args: {
  userId: string;
  establishmentId: string;
  newRole: InvitableRole;
}): Promise<Result<unknown>> {
  return invokeFn('change_member_role', {
    user_id: args.userId,
    establishment_id: args.establishmentId,
    new_role: args.newRole,
  });
}

export type AcceptedInvitation = { establishmentId: string; role: UserRole };

/** accept_invitation (T5.4 / R5.5): el caller logueado acepta el token. */
export async function acceptInvitation(token: string): Promise<Result<AcceptedInvitation>> {
  const r = await invokeFn<{ establishment_id: string; role: UserRole }>('accept_invitation', {
    token,
  });
  if (!r.ok) return r;
  return { ok: true, value: { establishmentId: r.value.establishment_id, role: r.value.role } };
}
