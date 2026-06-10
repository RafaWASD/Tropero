// Capa de datos de establecimientos (spec 01, Fase 4 — T4.1 / T4.4).
//
// LECTURAS (spec 15, T3.2): desde el SQLite local de PowerSync (contexto sincronizado por las
// streams est_establishments / est_members / self_user_private). `loadMemberships`,
// `loadOwnProfile`, `loadFullProfile`, `loadEstablishmentDetail`, `countActiveMembers` leen local;
// el scoping de tenant (has_role_in, self-only) ya lo aplicó la stream → NO se re-filtra. Los SQL
// builders puros viven en powersync/local-reads.ts (testeables sin SDK).
// MUTACIONES (crear/editar/soft-delete establecimiento, guardar perfil/teléfono): siguen ONLINE
// contra Supabase (admin/owner, R7.1) — NO se tocan en T3. RLS protege server-side (R7.1/R7.2).
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id. El set de campos
// del usuario se deriva de auth.uid() vía la stream; el campo activo lo decide el contexto.

import { supabase } from './supabase';
import { mapMembershipRows, type RoleRow } from '../utils/establishment';
import type { MembershipEstablishment } from '../utils/establishment';
import {
  buildMembershipsQuery,
  buildOwnPhoneQuery,
  buildOwnNameQuery,
  buildOwnEmailPhoneQuery,
  buildEstablishmentDetailQuery,
  buildCountActiveMembersQuery,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle } from './powersync/local-query';
import { assertOnline } from './powersync/online-guard';

// Copy es-AR (voseo) para el fast-fail de las acciones ONLINE-only de campo cuando no hay red.
const OFFLINE_FIELD_MSG = 'Necesitás conexión para esta acción.';

export type { MembershipEstablishment } from '../utils/establishment';

export type LoadMembershipsResult =
  | { ok: true; establishments: MembershipEstablishment[] }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

// Forma PLANA de la fila local (JOIN user_roles + establishments). Se re-arma a RoleRow para
// reusar mapMembershipRows (dedup + filtro soft-delete).
type MembershipFlatRow = {
  role: RoleRow['role'];
  id: string;
  name: string;
  province: string;
  city: string | null;
  deleted_at: string | null;
};

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
  // Desde el SQLite local (T3.2): JOIN user_roles → establishments (el join `!inner` de PostgREST
  // se reescribe como JOIN SQLite en buildMembershipsQuery). El filtro `ur.user_id = ?` es CRÍTICO
  // (la stream est_members trae roles de coworkers para el owner; sin él un owner duplicaría campos).
  const r = await runLocalQuery<MembershipFlatRow>(buildMembershipsQuery(userId));
  if (!r.ok) return { ok: false, error: r.error };

  // Re-armamos la forma anidada `RoleRow` que espera mapMembershipRows (dedup + soft-delete safety net).
  const rows: RoleRow[] = r.value.map((row) => ({
    role: row.role,
    establishment: {
      id: row.id,
      name: row.name,
      province: row.province,
      city: row.city ?? null,
      deleted_at: row.deleted_at ?? null,
    },
  }));
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

/** UUID v4 de cliente. crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Crea un establecimiento (R3.1). NO se hardcodea establishment_id ni owner: el trigger
 * 0011 (AFTER INSERT) deriva el owner de auth.uid() (R3.2).
 *
 * ⚠️ ID DE CLIENTE — por qué generamos el `id` acá (spec 15, residual #1):
 *   El insert NO usa `.select()` (RLS-on-RETURNING → 403: la policy `establishments_select`
 *   `has_role_in(id)` no ve el rol owner que el trigger 0011 crea en la misma transacción).
 *   La versión anterior recuperaba el id DIFFEANDO el set de memberships ANTES/DESPUÉS del
 *   insert — pero `loadMemberships` lee el SQLite LOCAL de PowerSync, y el campo recién creado
 *   ONLINE todavía NO bajó por el sync → el after-set NO lo incluía → "No se pudo confirmar el
 *   campo recién creado" (el bug del residual #1: el create FALLABA aunque el insert hubiera
 *   andado). La solución robusta: GENERAMOS el `id` (uuid v4) en el cliente y lo mandamos en el
 *   insert (la policy `establishments_insert` es `with check (auth.uid() is not null)`, NO
 *   restringe el `id`; el trigger 0011 deriva el owner igual). Así CONOCEMOS la fila exacta sin
 *   ningún read-back: armamos el `MembershipEstablishment` con el id + los datos del input + role
 *   'owner'. El contexto lo aterriza optimista (applyCreatedEstablishment) y reconcilia cuando el
 *   sync baja la fila real (mismo id → idempotente, sin duplicado). Mismo patrón de id-de-cliente
 *   que `createAnimal`/`createRodeo` (offline-first), consistente con la arquitectura.
 *
 * R9.2: crear campo REQUIERE conexión (operación administrativa online). Si la red falla,
 * devolvemos kind:'network' para que la pantalla muestre copy accionable.
 */
export async function createEstablishment(
  userId: string,
  input: CreateEstablishmentInput,
): Promise<CreateEstablishmentResult> {
  // Crear campo es ONLINE-only (R9.2): sin red, el insert no resuelve → fast-fail accionable
  // en vez de colgar. Antes del primer supabase call.
  const off = assertOnline(OFFLINE_FIELD_MSG);
  if (off) return off;

  const id = randomUuid();
  const name = input.name.trim();
  const province = input.province.trim();
  const city = input.city?.trim() || null;
  const row = {
    id,
    name,
    province,
    city,
    total_hectares: input.totalHectares ?? null,
  };

  // Insert SIN .select() (RLS-on-RETURNING → 403). El id es de cliente → no necesitamos read-back.
  const { error: insertError } = await supabase.from('establishments').insert(row);
  if (insertError) {
    return { ok: false, error: classifyError(insertError) };
  }

  // El creador es owner por el trigger 0011 (R3.2). Devolvemos la fila que CONOCEMOS (id de cliente
  // + datos del input); el sync bajará la fila real con el mismo id (reconciliación en el contexto).
  return { ok: true, establishment: { id, name, province, city, role: 'owner' } };
}

export type UserProfile = { phone: string | null };

export type LoadProfileResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Lee el perfil del usuario actual (para el gate de teléfono, R3.8). El `phone` se separó a
 * `public.user_private` (spec 14, R6.4). RLS `user_private_select_self` (0068) acota a la fila propia.
 */
export async function loadOwnProfile(userId: string): Promise<LoadProfileResult> {
  // Desde el SQLite local (T3.2): user_private es self-only en la stream → la única fila es la propia.
  // emptyIsSyncing:false → fila ausente = phone null (resultado legítimo, igual que maybeSingle), no
  // se degrada a "sincronizando" (el gate de teléfono no debe trabarse si el user no cargó teléfono).
  const r = await runLocalQuerySingle<{ phone: string | null }>(buildOwnPhoneQuery(userId));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, profile: { phone: r.value?.phone ?? null } };
}

export type SaveResult =
  | { ok: true }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

/**
 * Guarda el teléfono en el perfil (R3.8). El `phone` vive en `public.user_private` (spec 14, R6.4).
 * RLS `user_private_update_self` (0068) exige user_id = auth.uid() (un user solo edita su fila).
 */
export async function saveOwnPhone(userId: string, phone: string): Promise<SaveResult> {
  // ONLINE-only (R9.2): el `user_private` no está en el sync set de escritura offline → fast-fail.
  const off = assertOnline('Necesitás conexión para guardar tu teléfono.');
  if (off) return off;

  const { error } = await supabase
    .from('user_private')
    .update({ phone: phone.trim() })
    .eq('user_id', userId);

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
 * "Más" (R2.1). El `name` sale de `public.users`; el `email` + `phone` se separaron a
 * `public.user_private` (spec 14, R6.1). RLS self-only en ambas tablas (0006 / 0068) deja al user
 * ver SOLO su propia fila. No mezcla perfiles de otros (R7.2).
 *
 * Nota: el email mostrado en la pantalla de "Más" lo deriva del session de auth (R6.5); este
 * `loadFullProfile` mantiene `email` en el shape por compatibilidad de contrato (Run 1 lo pedía),
 * leyéndolo de `user_private` (la copia consultable). El email canónico fresco lo da el session.
 */
export async function loadFullProfile(userId: string): Promise<LoadFullProfileResult> {
  // name desde users (self) en el SQLite local (T3.2). emptyIsSyncing:true → si la fila no está y aún
  // no sincronizó, degrada "sincronizando"; post-sync ausente → "no se encontró el perfil".
  const nameRes = await runLocalQuerySingle<{ name: string | null }>(buildOwnNameQuery(userId), {
    emptyIsSyncing: true,
  });
  if (!nameRes.ok) return { ok: false, error: nameRes.error };
  if (!nameRes.value) {
    // La fila de perfil debería existir (la crea el trigger on_auth_user_created). Si falta
    // tras sincronizar, reportamos unknown en vez de fabricar datos.
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se encontró el perfil del usuario.' },
    };
  }

  // email + phone desde user_private (self). Ausente = vacío/null (resultado legítimo), no degrada.
  const privRes = await runLocalQuerySingle<{ email: string | null; phone: string | null }>(
    buildOwnEmailPhoneQuery(userId),
  );
  if (!privRes.ok) return { ok: false, error: privRes.error };

  return {
    ok: true,
    profile: {
      name: nameRes.value.name ?? '',
      email: privRes.value?.email ?? '',
      phone: privRes.value?.phone ?? null,
    },
  };
}

/**
 * Guarda nombre + teléfono del perfil propio (R2.1). NO toca el email: cambiar el email dispara
 * verificación (R2.2) y va por otro flujo (changeEmail en services/account.ts). RLS
 * `users_update_self` exige id = auth.uid() (un user solo edita su propia fila). UPDATE SIN
 * `.select()`: no necesitamos el RETURNING (el llamador re-lee o usa lo que ya tiene), y así
 * evitamos cualquier sorpresa de RLS-on-RETURNING.
 *
 * Fase 6 (consolidación del saludo — fuente única): el `name` va a `public.users`; ya NO sincroniza
 * el nombre a `auth.user_metadata` (lo que hacía Run 2). El saludo de la home/onboarding lee el
 * nombre del ProfileContext (que lee `public.users`). Tras guardar, el llamador refresca el
 * ProfileContext (`useProfile().refresh()`).
 *
 * Spec 14 (R6.2): el `phone` se separó a `public.user_private` → son DOS writes (distinta tabla).
 * Escribimos el `phone` PRIMERO (user_private) y el `name` DESPUÉS (users): si el phone falla,
 * cortamos antes de tocar el name (no dejamos el name guardado con el phone viejo de forma
 * silenciosa). RLS `user_private_update_self` / `users_update_self` acotan ambos a la fila propia.
 */
export async function saveProfile(
  userId: string,
  input: { name: string; phone: string | null },
): Promise<SaveResult> {
  // ONLINE-only (R9.2): perfil = `public.users` + `public.user_private` (no en el sync set de
  // escritura offline). Sin red, los DOS `supabase.update()` no resuelven → la pantalla queda en
  // "Guardando…" para siempre (bug reportado). Fast-fail accionable ANTES del primer write.
  const off = assertOnline('Necesitás conexión para editar tu perfil.');
  if (off) return off;

  const name = input.name.trim();

  const { error: phoneError } = await supabase
    .from('user_private')
    .update({ phone: input.phone?.trim() || null })
    .eq('user_id', userId);

  if (phoneError) {
    return { ok: false, error: classifyError(phoneError) };
  }

  const { error } = await supabase
    .from('users')
    .update({ name })
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
  // Desde el SQLite local (T3.2): el scoping (has_role_in) ya lo aplicó la stream → si la fila está
  // local, el usuario tiene acceso. emptyIsSyncing:true → pre-sync ausente degrada "sincronizando";
  // post-sync ausente → "no se encontró el campo" (sin acceso / soft-deleted).
  const r = await runLocalQuerySingle<{
    id: string;
    name: string;
    province: string;
    city: string | null;
    total_hectares: number | null;
  }>(buildEstablishmentDetailQuery(establishmentId), { emptyIsSyncing: true });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.value) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se encontró el campo. Puede que ya no tengas acceso.' },
    };
  }
  const data = r.value;
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
  // Editar campo es ONLINE-only (R9.2): sin red el update no resuelve → fast-fail accionable.
  const off = assertOnline('Necesitás conexión para editar el campo.');
  if (off) return off;

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
  // Eliminar campo es ONLINE-only (R9.2): sin red el update no resuelve → fast-fail accionable.
  const off = assertOnline(OFFLINE_FIELD_MSG);
  if (off) return off;

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
  // Desde el SQLite local (T3.2): la stream est_members trae la matriz de roles del campo al owner
  // → el COUNT local sobre user_roles del campo (activos, ≠ owner) refleja cuántos OTROS perderán
  // acceso. COUNT(*) devuelve siempre 1 fila → emptyIsSyncing no aplica (no degrada).
  const r = await runLocalQuery<{ count: number }>(
    buildCountActiveMembersQuery(establishmentId, ownerId),
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, count: r.value[0]?.count ?? 0 };
}
