// Orden canónico de la lista de miembros del campo (spec 01, R4.8 — pantalla /miembros).
//
// PROBLEMA: `buildMembersQuery` no tenía `ORDER BY` → el orden lo decidía SQLite y podía cambiar
// entre syncs (la misma pantalla se reordenaba sola). Regla decidida:
//
//   1. Por ROL: Dueño (`owner`) → Operario (`field_operator`) → Veterinario (`veterinarian`).
//      Son los 3 únicos roles del enum (`0003_user_roles.sql`). Un rol desconocido (enum ampliado
//      en el futuro sin tocar este mapa) cae AL FINAL en vez de romper el orden — fail-soft.
//   2. Alfabético DENTRO de cada rol, con collation es-AR real (`localeCompare('es-AR',
//      { sensitivity: 'base' })`): acentos y Ñ ordenan como en castellano (Nuria < Ñandú < Oscar,
//      José ≈ Jose). El `NOCASE` de SQLite es solo ASCII y rompe con esos casos → el orden final
//      lo manda ESTE helper; el `ORDER BY` del SQL es solo el piso de determinismo.
//   3. Los miembros SIN nombre (la fila muestra "Sin nombre") van al final de SU rol: son los
//      menos identificables, no deben encabezar un grupo.
//
// El usuario logueado NO va primero (decisión de producto, Raf): se queda en su posición alfabética
// dentro de su rol y se lo distingue con el badge "vos" que ya existe. La pantalla existe para
// gestionar a OTROS y la fila propia es la única NO accionable (`canManage = isOwner && !isCurrentUser`)
// → ponerla primera desperdiciaría la posición de mayor valor de la lista.
//
// PURO: sin DB, sin RN, sin I/O. No muta la entrada (devuelve un array nuevo) — el llamador puede
// seguir sosteniendo la lista original sin sorpresas.

import type { UserRole } from '../types';

/**
 * Prioridad de cada rol en la lista. Menor = más arriba. Es el mismo orden jerárquico que usa el
 * dominio (dueño → operario → veterinario) y espeja el `CASE` del `ORDER BY` de `buildMembersQuery`.
 */
const ROLE_ORDER: Record<UserRole, number> = {
  owner: 0,
  field_operator: 1,
  veterinarian: 2,
};

/** Rango de un rol fuera del mapa (enum ampliado a futuro): al final, nunca `undefined` en la resta. */
const UNKNOWN_ROLE_ORDER = 3;

/**
 * Shape MÍNIMO que necesita el orden: rol + nombre. Estructural a propósito — `Member`
 * (`services/members.ts`) lo satisface sin que este util dependa de la capa de servicios
 * (nada de ciclos de import) y los tests pueden armar objetos sueltos.
 */
export type SortableMember = {
  role: UserRole;
  /** Nombre del miembro. `''`/espacios/null ⇒ "sin nombre" ⇒ al final de su rol. */
  name?: string | null;
};

function roleRank(role: UserRole): number {
  return ROLE_ORDER[role] ?? UNKNOWN_ROLE_ORDER;
}

/**
 * Ordena los miembros del campo: rol (dueño → operario → veterinario) y, dentro de cada rol,
 * alfabético es-AR; los sin nombre al final de su rol.
 *
 * Genérico: devuelve el MISMO tipo de elemento que recibe (no recorta `Member` a `SortableMember`),
 * así el llamador conserva `userId` / `isCurrentUser`.
 *
 * Estable (Array.prototype.sort lo es desde ES2019): dos miembros indistinguibles para esta regla
 * (mismo rol y nombres equivalentes bajo `sensitivity: 'base'`, ej. "Jose"/"José", o dos sin nombre)
 * conservan el orden de entrada — que el `ORDER BY` del SQL ya dejó determinístico.
 */
export function sortMembers<T extends SortableMember>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => {
    const rankDiff = roleRank(a.role) - roleRank(b.role);
    if (rankDiff !== 0) return rankDiff;

    const nameA = (a.name ?? '').trim();
    const nameB = (b.name ?? '').trim();
    const emptyA = nameA === '';
    const emptyB = nameB === '';
    // Sin nombre al final de su rol. Si ambos están vacíos, empate → orden de entrada (estable).
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    if (emptyA) return 0;

    // Collation es-AR: acentos y Ñ ordenan como en castellano; case-insensitive por `base`.
    return nameA.localeCompare(nameB, 'es-AR', { sensitivity: 'base' });
  });
}

// ─── Mapeo de las filas locales → lista de la pantalla ──────────────────────────────

/** Fila cruda de `buildMembersQuery` (user_roles con el nombre denormalizado, ADR-026). */
export type MemberRow = {
  role: UserRole;
  user_id: string;
  /** `member_name` denormalizado. NULL si el miembro nunca completó su nombre. */
  user_name: string | null;
};

/**
 * Un miembro del campo tal como lo consume la pantalla: rol + identidad mínima (id + name).
 * NUNCA phone/email de otros (hallazgo RLS #2 — la PII vive en `user_private` self-only, ADR-025).
 * `services/members.ts` lo re-exporta como `Member` (el nombre de dominio de la pantalla).
 */
export type MemberListItem = {
  userId: string;
  /** Nombre del miembro. Puede ser `''` si no lo completó (la fila muestra "Sin nombre"). */
  name: string;
  role: UserRole;
  /** ¿Es el usuario actual? → marcador "vos". NO altera la posición en la lista (R4.8). */
  isCurrentUser: boolean;
};

/**
 * Proyecta las filas locales a la lista de la pantalla y la devuelve YA ORDENADA (R4.8).
 *
 * PURA (sin supabase/RN) a propósito: `services/members.ts` importa `./supabase` → expo-secure-store
 * y no carga bajo `node:test`, así que la lógica testeable vive acá y `loadMembers` queda como
 * orquestador delgado (mismo patrón que `tag-lookup.ts` ↔ `animals.ts::lookupByTag`).
 *
 * Multi-tenant: NO scopea por campo — eso ya lo hizo la query (`establishment_id = ?`) y, antes, la
 * sync stream. Acá solo se proyecta y ordena lo que ya llegó filtrado.
 */
export function mapMemberRows(
  rows: readonly MemberRow[],
  currentUserId: string,
): MemberListItem[] {
  return sortMembers(
    rows.map((row) => ({
      userId: row.user_id,
      name: row.user_name ?? '',
      role: row.role,
      isCurrentUser: row.user_id === currentUserId,
    })),
  );
}
