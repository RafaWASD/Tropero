// Capa de datos de establecimientos (spec 01, Fase 4 — T4.1 / T4.4).
//
// Queries DIRECTAS a Supabase con supabase-js (PowerSync es Fase 7, diferida — design.md
// §PowerSync). RLS protege server-side (R7.1/R7.2): la policy `establishments_select` usa
// has_role_in(id) y `user_roles_select` deja al user ver SUS roles. El cliente no mezcla
// campos: solo trae los establishments donde el usuario tiene user_roles.active = true.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id. El set de campos
// del usuario se deriva de auth.uid() vía RLS; el campo activo lo decide el contexto.

import { supabase } from './supabase';
import { mapMembershipRows, type RoleRow } from '../utils/establishment';
import type { MembershipEstablishment } from '../utils/establishment';

export type { MembershipEstablishment } from '../utils/establishment';

export type LoadMembershipsResult =
  | { ok: true; establishments: MembershipEstablishment[] }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

function classifyError(error: { message?: string; code?: string } | null): {
  kind: 'network' | 'unknown';
  message: string;
} {
  const msg = error?.message ?? '';
  // Errores de red de fetch (sin status HTTP): "Failed to fetch" / "Network request failed".
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

/**
 * Trae los establecimientos donde el usuario actual tiene user_roles.active = true, con su
 * rol en cada uno.
 *
 * IMPORTANTE — filtro explícito por `userId`: la policy `user_roles_select` (0008) es
 * `user_id = auth.uid() OR is_owner_of(establishment_id)`. El segundo término deja a un
 * OWNER ver TODAS las filas de roles de su campo (para la pantalla Members). Sin
 * `.eq('user_id', userId)`, un owner con N miembros invitados recibiría N filas del mismo
 * campo → el campo se duplicaría en "Mis campos" (R6.6), tomaría el rol de otro miembro
 * (R6.6.2) e inflaría `available.length` (R6.4/R6.7). Filtramos por el propio usuario para
 * traer SOLO sus roles. Con R4.3 (1 rol activo por (user, campo)) cada campo aparece UNA
 * vez con el rol correcto del usuario; `mapMembershipRows` dedup es la red de seguridad.
 *
 * Filtra los soft-deleted (R8.3) en el mapeo. El contexto reordena por recencia (R6.6.1).
 */
export async function loadMemberships(userId: string): Promise<LoadMembershipsResult> {
  // Join user_roles → establishments. PostgREST resuelve la FK por el nombre de la tabla.
  const { data, error } = await supabase
    .from('user_roles')
    .select(
      'role, establishment:establishments ( id, name, province, city, deleted_at )',
    )
    .eq('active', true)
    .eq('user_id', userId);

  if (error) {
    return { ok: false, error: classifyError(error) };
  }

  const rows = (data ?? []) as unknown as RoleRow[];
  return { ok: true, establishments: mapMembershipRows(rows) };
}

export type CreateEstablishmentInput = {
  name: string;
  province: string;
  city?: string | null;
  totalHectares?: number | null;
};

export type CreateEstablishmentResult =
  | { ok: true; establishment: MembershipEstablishment }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Crea un establecimiento (R3.1). NO se hardcodea establishment_id ni owner: el trigger
 * 0011 (AFTER INSERT) deriva el owner de auth.uid() (R3.2).
 *
 * ⚠️ SPLIT insert + select — NO usar `.insert().select()` (RLS-on-RETURNING):
 *   El `.select()` post-insert hace que PostgREST evalúe la policy `establishments_select`
 *   (`has_role_in(id)`, 0007) sobre la fila del RETURNING. En la práctica eso devuelve
 *   **403 Forbidden** porque, en ese punto de la transacción, el rol owner que crea el
 *   trigger 0011 todavía NO es visible para la policy de select. (El comentario de
 *   `0011_establishment_auto_owner.sql` afirma que `insert().select()` es seguro acá; eso
 *   es FALSO — Raf lo confirmó probando en web: `POST …?select=… → 403`.) La migration NO
 *   se toca (ya aplicada al remoto). El patrón correcto es insert SIN `.select()` y luego un
 *   SELECT separado (mismo patrón que `createEstablishmentAs` en supabase/tests/rls/run.cjs).
 *
 * Cómo recuperamos el id del campo recién creado, robusto ante NOMBRES DUPLICADOS:
 *   No filtramos por `name` (dos campos del mismo usuario podrían llamarse igual). En su
 *   lugar diffeamos el SET de memberships del usuario: lo leemos ANTES del insert y DESPUÉS;
 *   el id que aparece en el after-set y NO estaba en el before-set es el campo nuevo. Esto
 *   identifica la fila exacta sin ambigüedad por nombre, y reusa `loadMemberships` (ya
 *   filtra por user_id + dedup + soft-delete, testeado). El campo nuevo trae role 'owner'
 *   (creado por el trigger), así que `loadMemberships` ya lo ve en el after-set.
 *
 * R9.2: crear campo REQUIERE conexión (operación administrativa online). Si la red falla,
 * devolvemos kind:'network' para que la pantalla muestre copy accionable.
 */
export async function createEstablishment(
  userId: string,
  input: CreateEstablishmentInput,
): Promise<CreateEstablishmentResult> {
  const row = {
    name: input.name.trim(),
    province: input.province.trim(),
    city: input.city?.trim() || null,
    total_hectares: input.totalHectares ?? null,
  };

  // SET de campos del usuario ANTES del insert (para diffear el nuevo después).
  const before = await loadMemberships(userId);
  if (!before.ok) {
    return { ok: false, error: before.error };
  }
  const beforeIds = new Set(before.establishments.map((e) => e.id));

  // Insert SIN .select() — ver nota arriba (RLS-on-RETURNING → 403).
  const { error: insertError } = await supabase.from('establishments').insert(row);
  if (insertError) {
    return { ok: false, error: classifyError(insertError) };
  }

  // SELECT separado: re-leemos el set (el trigger 0011 ya creó el rol owner) y tomamos el
  // id que NO estaba antes. Robusto ante nombres duplicados (no filtra por name).
  const after = await loadMemberships(userId);
  if (!after.ok) {
    return { ok: false, error: after.error };
  }
  const created = after.establishments.find((e) => !beforeIds.has(e.id));
  if (!created) {
    // El insert no devolvió error pero el campo nuevo no aparece en el after-set. No
    // inventamos un id: reportamos unknown para que la pantalla muestre el error genérico.
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo confirmar el campo recién creado.' },
    };
  }

  // El creador es owner por el trigger 0011 (R3.2); loadMemberships ya trae role='owner'.
  return { ok: true, establishment: created };
}

export type UserProfile = { phone: string | null };

export type LoadProfileResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/** Lee el perfil del usuario actual (para el gate de teléfono, R3.8). */
export async function loadOwnProfile(userId: string): Promise<LoadProfileResult> {
  const { data, error } = await supabase
    .from('users')
    .select('phone')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  return { ok: true, profile: { phone: data?.phone ?? null } };
}

export type SaveResult =
  | { ok: true }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/** Guarda el teléfono en el perfil (R3.8). RLS users_update_self exige id = auth.uid(). */
export async function saveOwnPhone(userId: string, phone: string): Promise<SaveResult> {
  const { error } = await supabase
    .from('users')
    .update({ phone: phone.trim() })
    .eq('id', userId);

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  return { ok: true };
}

// ─── Pantalla "Más" — perfil completo + gestión de campo (Run 1: T6.2 + T4.5) ───

export type FullProfile = { name: string; email: string; phone: string | null };

export type LoadFullProfileResult =
  | { ok: true; profile: FullProfile }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Lee el perfil completo del usuario actual (name + email + phone) para la sección Perfil de
 * "Más" (R2.1). RLS `users_select_self` (0006) deja al user ver SOLO su propia fila (id =
 * auth.uid()). No mezcla perfiles de otros (R7.2).
 */
export async function loadFullProfile(userId: string): Promise<LoadFullProfileResult> {
  const { data, error } = await supabase
    .from('users')
    .select('name, email, phone')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  if (!data) {
    // La fila de perfil debería existir (la crea el trigger on_auth_user_created). Si falta,
    // reportamos unknown en vez de fabricar datos.
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se encontró el perfil del usuario.' },
    };
  }
  return { ok: true, profile: { name: data.name ?? '', email: data.email ?? '', phone: data.phone ?? null } };
}

/**
 * Guarda nombre + teléfono del perfil propio (R2.1). NO toca el email: cambiar el email dispara
 * verificación (R2.2) y va por otro flujo (changeEmail en services/account.ts). RLS
 * `users_update_self` exige id = auth.uid() (un user solo edita su propia fila). UPDATE SIN
 * `.select()`: no necesitamos el RETURNING (el llamador re-lee o usa lo que ya tiene), y así
 * evitamos cualquier sorpresa de RLS-on-RETURNING.
 *
 * Fase 6 (consolidación del saludo — fuente única): escribe SOLO `public.users`. Ya NO sincroniza
 * el nombre a `auth.user_metadata` (lo que hacía Run 2): el saludo de la home/onboarding ahora lee
 * el nombre del ProfileContext (que lee `public.users`), no de AuthContext/user_metadata. Tras
 * guardar, el llamador refresca el ProfileContext (`useProfile().refresh()`) → el saludo se
 * actualiza sin reload, sin depender del metadata de Auth. Esto elimina de raíz la desincronización
 * de 2 fuentes que tenía Run 2.
 */
export async function saveProfile(
  userId: string,
  input: { name: string; phone: string | null },
): Promise<SaveResult> {
  const name = input.name.trim();
  const { error } = await supabase
    .from('users')
    .update({ name, phone: input.phone?.trim() || null })
    .eq('id', userId);

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  return { ok: true };
}

export type EstablishmentDetail = {
  id: string;
  name: string;
  province: string;
  city: string | null;
  totalHectares: number | null;
};

export type LoadEstablishmentDetailResult =
  | { ok: true; establishment: EstablishmentDetail }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Lee los datos editables de un establecimiento (name/province/city/total_hectares) para
 * pre-cargar el form de edición (R3.4). RLS `establishments_select` (0007) exige `has_role_in`,
 * así que solo trae el campo si el usuario tiene rol activo. Lo leemos fresco (no del contexto)
 * porque el contexto solo guarda name/province/city/role — no hectáreas.
 */
export async function loadEstablishmentDetail(
  establishmentId: string,
): Promise<LoadEstablishmentDetailResult> {
  const { data, error } = await supabase
    .from('establishments')
    .select('id, name, province, city, total_hectares')
    .eq('id', establishmentId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  if (!data) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se encontró el campo. Puede que ya no tengas acceso.' },
    };
  }
  return {
    ok: true,
    establishment: {
      id: data.id,
      name: data.name,
      province: data.province,
      city: data.city ?? null,
      totalHectares: data.total_hectares ?? null,
    },
  };
}

export type UpdateEstablishmentInput = {
  name: string;
  province: string;
  city?: string | null;
  totalHectares?: number | null;
};

/**
 * Edita los datos de un establecimiento (R3.4, owner-only). RLS `establishments_update` (0007)
 * es `is_owner_of(id)` tanto en USING como en WITH CHECK → solo el owner puede mutar; a un
 * field_operator/veterinarian la policy le devuelve 0 filas (R3.5/R7.3). La UI ya oculta la
 * acción a no-owners, pero la RLS es la barrera real.
 *
 * ⚠️ UPDATE SIN `.select()` — mismo gotcha de RLS-on-RETURNING que mordió en createEstablishment:
 *   el `.select()` post-update evalúa la policy de SELECT sobre el RETURNING y puede dar 403 en
 *   ciertos timings. No lo necesitamos: tras guardar, el llamador hace refreshEstablishments()
 *   para reflejar el cambio en el contexto. Sin `.select()`, un update que NO matchea ninguna
 *   fila (no-owner) NO devuelve error — devuelve `count` 0; pedimos `count: 'exact'` (head-less)
 *   para distinguir "se actualizó" de "RLS lo bloqueó / id inexistente" y reportar un error
 *   accionable en vez de un falso OK.
 */
export async function updateEstablishment(
  establishmentId: string,
  input: UpdateEstablishmentInput,
): Promise<SaveResult> {
  const { error, count } = await supabase
    .from('establishments')
    .update(
      {
        name: input.name.trim(),
        province: input.province.trim(),
        city: input.city?.trim() || null,
        total_hectares: input.totalHectares ?? null,
      },
      { count: 'exact' },
    )
    .eq('id', establishmentId);

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  if (count === 0) {
    // El update no tocó ninguna fila: RLS lo bloqueó (no es owner) o el id no existe / está
    // soft-deleted. No es un error de red; reportamos unknown para copy genérico accionable.
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo editar el campo. Verificá que seguís teniendo permiso.' },
    };
  }
  return { ok: true };
}

/**
 * Soft-delete de un establecimiento (R3.6, owner-only): set `deleted_at = now()`. NO es un
 * DELETE físico (no hay grant de delete en la tabla; el hard-delete está fuera de scope MVP).
 * RLS `establishments_update` (0007) es owner-only. Tras esto, `has_role_in`/`is_owner_of`
 * excluyen el campo (filtran deleted_at) → desaparece de loadMemberships del owner Y de todos
 * los miembros (R8.3/R8.4); esos miembros entran en active_lost (R6.10) la próxima vez que
 * operan. UPDATE SIN `.select()` (gotcha RLS-on-RETURNING); usamos count para confirmar.
 *
 * Nota de R3.6 (decisión de alcance — ver bitácora): la spec dice "todos los user_roles
 * asociados deberán quedar active = false". En MVP NO desactivamos explícitamente los user_roles
 * acá: el soft-delete del establishment ya los oculta vía RLS (has_role_in/loadMemberships
 * filtran deleted_at del establishment), que es lo que el usuario observa. Desactivar los roles
 * es higiene de datos diferida (requeriría un trigger o una RPC; ambos fuera de Run 1). Queda
 * documentado como decisión consciente.
 */
export async function softDeleteEstablishment(establishmentId: string): Promise<SaveResult> {
  const { error, count } = await supabase
    .from('establishments')
    .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', establishmentId)
    .is('deleted_at', null); // idempotencia: no re-borra uno ya borrado

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  if (count === 0) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo eliminar el campo. Verificá que seguís siendo el dueño.' },
    };
  }
  return { ok: true };
}

export type CountMembersResult =
  | { ok: true; count: number }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Cuenta los miembros ACTIVOS de un establecimiento DISTINTOS del owner que ejecuta la acción
 * (R3.6.1: warning antes del soft-delete). El owner puede contar los `user_roles` activos de su
 * campo porque la policy `user_roles_select` (0008) le permite ver TODAS las filas de roles de su
 * campo (término `is_owner_of(establishment_id)`). Excluimos al propio owner (`user_id != ownerId`)
 * para reportar cuántos OTROS perderán acceso. `head: true` + `count: 'exact'` → no trae filas,
 * solo el conteo (eficiente).
 */
export async function countActiveMembers(
  establishmentId: string,
  ownerId: string,
): Promise<CountMembersResult> {
  const { count, error } = await supabase
    .from('user_roles')
    .select('id', { count: 'exact', head: true })
    .eq('establishment_id', establishmentId)
    .eq('active', true)
    .neq('user_id', ownerId);

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  return { ok: true, count: count ?? 0 };
}
