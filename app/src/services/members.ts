// Capa de datos de miembros e invitaciones (spec 01, Fase 5 / B.1.3).
//
// Dos clases de operación:
//   1. LECTURAS desde el SQLite local de PowerSync (spec 15, T3.2). El SCOPING ya lo aplicó la
//      sync stream al sincronizar (est_members: owner ve la matriz de roles; no-owner solo la propia
//      vía self_user_roles; est_invitations es owner-only) → acá NO se re-scopea, solo filtros de
//      dominio. SQL builders puros en powersync/local-reads.ts.
//        - loadMembers: user_roles activos del campo + LEFT JOIN users por id+name (hallazgo RLS #2:
//          NO traer phone/email de otros — esas columnas ni existen en la tabla users local).
//        - loadPendingInvitations: invitations status=pending del campo (owner-only por la stream).
//        - countTeam: conteos livianos (otros miembros + invitaciones pendientes).
//   2. WRAPPERS de las Edge Functions de Fase 2 (operaciones que requieren admin/validación
//      cruzada: invitar, cancelar, regenerar, remover, cambiar rol, aceptar) — siguen ONLINE (R7.1).
//      Vía supabase.functions.invoke; el JWT lo agrega supabase-js solo.
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
import {
  buildMembersQuery,
  buildCountOtherMembersQuery,
  buildCountPendingInvitationsQuery,
  buildPendingInvitationsQuery,
} from './powersync/local-reads';
import { runLocalQuery } from './powersync/local-query';
import { offlineError } from './powersync/online-guard';
import { getPowerSync } from './powersync/database';

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
  // Las operaciones de equipo (invitar/cancelar/regenerar/remover/cambiar-rol/aceptar) son Edge
  // Functions ONLINE-only (R9.2): sin red el invoke no resuelve rápido → fast-fail accionable ANTES
  // del call. Todas pasan por acá → un único guard cubre todos los call-sites. (Las LECTURAS de
  // miembros/invitaciones NO pasan por invokeFn — leen del SQLite local, así que no se gatean.)
  const off = offlineError(
    getPowerSync().currentStatus?.connected,
    'Necesitás conexión para gestionar tu equipo.',
  );
  if (off) {
    return { ok: false, error: { kind: 'network', code: null, message: off.message } };
  }

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

// ─── Lecturas locales (SQLite de PowerSync, T3.2) ─────────────────────────────────

export type LoadMembersResult =
  | { ok: true; members: Member[] }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

// Forma PLANA de la fila local (LEFT JOIN user_roles + users). El join `user:users(id,name)` de
// PostgREST se reescribe como LEFT JOIN SQLite (user_name puede ser null si falta la fila users).
type MemberFlatRow = {
  role: UserRole;
  user_id: string;
  user_name: string | null;
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
  // Desde el SQLite local (T3.2): la stream est_members decide qué filas de user_roles ve el usuario
  // (owner: la matriz; no-owner: solo la propia vía self_user_roles) → acá NO se re-scopea, solo el
  // filtro de dominio active=1. SOLO id+name del user (hallazgo RLS #2: nunca phone/email de otros —
  // esas columnas ni existen en la tabla users local).
  const r = await runLocalQuery<MemberFlatRow>(buildMembersQuery(establishmentId));
  if (!r.ok) return { ok: false, error: r.error };

  const members: Member[] = r.value.map((row) => ({
    userId: row.user_id,
    name: row.user_name ?? '',
    role: row.role,
    isCurrentUser: row.user_id === currentUserId,
  }));
  return { ok: true, members };
}

// ─── Conteo liviano del equipo (home: paso "Invitá a tu vet o capataz" por estado real) ──

/** Conteo liviano del equipo de un campo: otros miembros activos + invitaciones pendientes. */
export type TeamCounts = { others: number; pending: number };

export type CountTeamResult =
  | { ok: true; counts: TeamCounts }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Cuenta, SIN traer listas completas, las dos señales de "equipo iniciado" de un campo, para drivear
 * el paso "Invitá a tu vet o capataz" del Stepper de la home por estado REAL (en vez de hardcodearlo
 * siempre pendiente):
 *   - `others`  = user_roles activos del campo con `user_id != selfUserId` (otros miembros además del
 *                 usuario actual). HEAD count (sin filas).
 *   - `pending` = invitaciones status=pending del campo. HEAD count.
 *
 * RLS como barrera (0008), owner-céntrica — IMPORTANTE para interpretar el resultado:
 *   - `user_roles_select` deja al OWNER ver TODAS las filas activas de su campo, pero a un NO-OWNER
 *     solo la SUYA. Así, para un no-owner `others` SIEMPRE da 0 (no ve al owner ni a sus pares): el
 *     llamador (la home) NO debe inferir "equipo no iniciado" de eso. Un no-owner que llegó a la home
 *     ES en sí mismo evidencia de un equipo de ≥2 personas (alguien lo sumó) → la home trata "no-owner"
 *     como equipo iniciado por su rol, sin depender de este conteo.
 *   - `invitations` es owner-only (RLS): para un no-owner `pending` da 0. Idem: lo decide el rol.
 * Por eso este helper es la fuente para el OWNER; para el no-owner el paso lo cierra el rol (ver la home).
 *
 * Multi-tenant (CLAUDE.md ppio 6): NUNCA hardcodea establishment_id ni selfUserId — ambos llegan del
 * contexto del llamador. El `.eq('establishment_id', …)` es defensa en profundidad; la RLS es la barrera.
 */
export async function countTeam(
  establishmentId: string,
  selfUserId: string,
): Promise<CountTeamResult> {
  // Desde el SQLite local (T3.2). La asimetría owner/no-owner del docstring se preserva por la stream:
  //  - others: para un no-owner la stream solo trae SU propia fila de user_roles → COUNT(≠ self) = 0.
  //  - pending: la stream est_invitations es owner-only → para un no-owner no hay filas → COUNT = 0.
  // COUNT(*) devuelve siempre 1 fila → emptyIsSyncing no aplica.
  const membersRes = await runLocalQuery<{ count: number }>(
    buildCountOtherMembersQuery(establishmentId, selfUserId),
  );
  if (!membersRes.ok) return { ok: false, error: membersRes.error };

  const invitesRes = await runLocalQuery<{ count: number }>(
    buildCountPendingInvitationsQuery(establishmentId),
  );
  if (!invitesRes.ok) return { ok: false, error: invitesRes.error };

  return {
    ok: true,
    counts: {
      others: membersRes.value[0]?.count ?? 0,
      pending: invitesRes.value[0]?.count ?? 0,
    },
  };
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
  // Desde el SQLite local (T3.2): la stream est_invitations es owner-only + solo pending → un no-owner
  // no tiene filas locales (lista vacía, igual que la RLS owner-only). emptyIsSyncing:false → vacío es
  // un resultado LEGÍTIMO (no-owner, o sin invitaciones pendientes), NO se degrada a "sincronizando".
  const r = await runLocalQuery<PendingRow>(buildPendingInvitationsQuery(establishmentId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: r.error };

  const invitations: PendingInvitation[] = r.value.map((r) => ({
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
