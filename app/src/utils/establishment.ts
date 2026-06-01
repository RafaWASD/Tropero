// Lógica PURA del EstablishmentContext (spec 01, Fase 4). Sin RN, sin red, sin
// supabase-js: testeable con node:test (mismo patrón que validation/lockout de B.1.1).
//
// Cubre: landing por cantidad (R6.7), detección de active_lost (R6.10), orden de "Mis
// campos" (R6.6.1), derivación del rastro de visitados al campo activo + recientes.

import type { UserRole } from '../types';

// ─── Tipos de dominio de membership ─────────────────────────────────────────────
//
// Viven acá (lógica pura, sin imports de RN/red) para que el mapeo `RoleRow[] →
// MembershipEstablishment[]` sea testeable con node:test. `services/establishments.ts`
// (que importa supabase-js → expo/RN, no cargable bajo node) los re-exporta.

/** Un establecimiento accesible por el usuario, con su rol en ese campo. */
export type MembershipEstablishment = {
  id: string;
  name: string;
  province: string;
  city: string | null;
  /** Rol del usuario en ESTE campo (R6.6: badge). */
  role: UserRole;
};

// Forma cruda de la fila de user_roles con el establishment embebido (join supabase-js).
// `establishment` puede venir como objeto (FK 1:1) en el shape de PostgREST.
export type RoleRow = {
  role: UserRole;
  establishment:
    | { id: string; name: string; province: string; city: string | null; deleted_at: string | null }
    | null;
};

/**
 * Mapea las filas crudas de user_roles (con establishment embebido) a la forma de dominio
 * `MembershipEstablishment[]`. Función PURA y testeable (sin red/RN): aísla la lógica que
 * la suite RLS no cubre (esa valida el SQL/policies, no el mapeo del cliente — el gap por
 * el que el bug del owner pasó la primera vez).
 *
 * - Filtra los soft-deleted (R8.3: `deleted_at != null`) por si la fila viniera igual.
 * - DEDUP defensivo por `establishment.id`: si por lo que sea llegaran ≥2 filas del mismo
 *   campo (no debería con el filtro por user_id en loadMemberships + R4.3: 1 rol activo por
 *   (user, campo)), nos quedamos con la PRIMERA — así el campo nunca se duplica en "Mis
 *   campos" (R6.6) ni infla `available.length` (R6.4/R6.7). Es la red de seguridad contra
 *   el bug que veía un owner: la policy `user_roles_select` (0008) le deja ver los roles de
 *   TODOS los miembros de su campo (para la pantalla Members).
 */
export function mapMembershipRows(rows: RoleRow[]): MembershipEstablishment[] {
  const out: MembershipEstablishment[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const e = row.establishment;
    if (e == null || e.deleted_at != null) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      name: e.name,
      province: e.province,
      city: e.city,
      role: row.role,
    });
  }
  return out;
}

// ─── Hectáreas — parseo/formateo tolerante (crear/editar campo) ─────────────────

/**
 * Parseo tolerante de hectáreas (campo OPCIONAL del alta/edición de campo). Acepta coma o
 * punto como separador decimal y puntos de miles ("1.200,50"). Devuelve null si está vacío o
 * no es un número válido (no bloqueamos el alta/edición por un campo opcional mal tipeado).
 * Lógica pura (sin RN): testeable y compartida por crear-campo y editar-campo.
 */
export function parseHectares(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Formatea hectáreas (número o null) al string del input de edición. null/undefined → '' (campo
 * vacío). Un entero se muestra sin decimales; un decimal con coma (es-AR). Pura.
 */
export function formatHectares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  // Entero exacto → sin decimales; si tiene fracción, coma decimal (es-AR), sin separador de miles
  // (el parseo tolera ambos; mantenemos el input simple para re-tipear).
  if (Number.isInteger(value)) return String(value);
  return String(value).replace('.', ',');
}

// ─── Rastro de visitados (R6.9) — lógica pura, sin I/O ──────────────────────────

/** Tope por defecto del rastro de visitados. La persistencia lo recorta a este largo. */
export const MAX_TRAIL = 8;

/**
 * Mueve `id` al frente del rastro (más reciente primero), deduplicando y recortando a
 * `max`. No muta la entrada. Usada al hacer switch/landing: el campo recién abierto pasa
 * a ser `last_establishment_opened` y el saliente baja un puesto (sigue en "recientes",
 * de ahí que reaparezca como visitado — bug (b) de Raf). Vive acá (no en establishment-store)
 * para ser testeable sin tocar expo-secure-store/RN.
 */
export function promoteInTrail(trail: string[], id: string, max = MAX_TRAIL): string[] {
  const deduped = [id, ...trail.filter((x) => x !== id)];
  return deduped.slice(0, max);
}

// ─── Tipos del estado (design.md §EstablishmentContext) ─────────────────────────

/** Razón de la pérdida del campo activo (R6.10): distingue el copy del aviso. */
export type ActiveLostReason = 'role_revoked' | 'establishment_deleted';

export type EstablishmentState =
  | { status: 'loading' }
  | { status: 'no_establishments' }
  | { status: 'choosing'; available: MembershipEstablishment[] }
  | {
      status: 'active';
      current: MembershipEstablishment;
      available: MembershipEstablishment[];
      role: UserRole;
    }
  // R6.10: el establecimiento activo dejó de ser válido. NO se fuerza logout (R7.4).
  | {
      status: 'active_lost';
      reason: ActiveLostReason;
      lostEstablishmentName: string;
      available: MembershipEstablishment[];
    };

// ─── Resolución del estado tras cargar memberships ──────────────────────────────

/**
 * Decide el estado del contexto a partir de:
 *   - `available`: los establishments con rol activo (de loadMemberships).
 *   - `preferredId`: el id que querríamos activo (last_establishment_opened o el elegido
 *     por switch). Si null, se cae a la regla de landing por cantidad (R6.7).
 *   - `lostName`/`lostReason`: si veníamos de un `current` que YA NO está en `available`
 *     (rol revocado / campo borrado), se reporta active_lost en vez de elegir otro en
 *     silencio. El re-ruteo lo decide la pantalla a partir de `available` (R6.10).
 *
 * Reglas:
 *   - 0 campos → no_establishments (wizard R6.5). Si veníamos de active_lost, la pantalla
 *     de aviso ya mostró el motivo; acá igual reportamos no_establishments para el wizard.
 *   - preferredId presente Y en available → active sobre ese.
 *   - preferredId ausente/inaccesible:
 *       · exactamente 1 campo → active (auto-activo, R6.4).
 *       · ≥2 campos → choosing ("Mis campos" como landing, R6.7).
 */
export function resolveState(args: {
  available: MembershipEstablishment[];
  preferredId: string | null;
}): EstablishmentState {
  const { available, preferredId } = args;

  if (available.length === 0) {
    return { status: 'no_establishments' };
  }

  if (preferredId) {
    const match = available.find((e) => e.id === preferredId);
    if (match) {
      return { status: 'active', current: match, available, role: match.role };
    }
    // preferredId apunta a un campo inaccesible (R6.9): se ignora y se cae al landing.
  }

  if (available.length === 1) {
    const only = available[0];
    return { status: 'active', current: only, available, role: only.role };
  }

  return { status: 'choosing', available };
}

/**
 * ¿El `currentId` activo sigue presente en el nuevo set `available`? Si NO, hubo pérdida
 * del campo activo (R6.10): rol revocado o campo soft-deleted. Esta es la detección
 * PROACTIVA (al refrescar): el activo desapareció del set de roles activos del usuario.
 * Devuelve null si sigue presente (sin pérdida).
 *
 * No podemos distinguir desde el cliente con 100% certeza entre "rol revocado" y "campo
 * borrado" (en ambos casos la fila desaparece del set por RLS). El contexto pasa el
 * `reason` que tenga mejor evidencia; por default 'role_revoked' (R6.10 lista ese como el
 * caso (a)/(d) más común — rol removido/revocado por sync). El copy de ambos es legible.
 */
export function detectActiveLost(args: {
  currentId: string | null;
  available: MembershipEstablishment[];
}): { lost: true } | { lost: false } {
  const { currentId, available } = args;
  if (!currentId) return { lost: false };
  const stillThere = available.some((e) => e.id === currentId);
  return stillThere ? { lost: false } : { lost: true };
}

// ─── Orden de "Mis campos" (R6.6.1) ─────────────────────────────────────────────

/**
 * Ordena "Mis campos" (R6.6.1): el campo activo / último visitado PRIMERO; el resto
 * alfabético por nombre (es-AR, case/acento-insensitive). No muta la entrada.
 */
export function sortMyEstablishments(
  list: MembershipEstablishment[],
  activeOrLastId: string | null,
): MembershipEstablishment[] {
  const rest = list
    .filter((e) => e.id !== activeOrLastId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es-AR', { sensitivity: 'base' }));
  const head = activeOrLastId ? list.find((e) => e.id === activeOrLastId) : undefined;
  return head ? [head, ...rest] : rest;
}

/**
 * Deriva la lista de "recientes" (más reciente primero) para el dropdown del switch
 * (R6.8.1) a partir del rastro persistido de ids (`trail`) y el set actual `available`.
 * Mapea cada id del rastro a su establishment si SIGUE accesible (descarta los que ya no
 * están, R6.9), preservando el orden de recencia. Los campos accesibles que no estén en
 * el rastro (ej. recién traídos, nunca abiertos) se agregan al final en orden alfabético,
 * para que el dropdown/orden siempre tenga de dónde sacar visitados aunque el rastro esté
 * corto o vacío en el primer arranque.
 */
export function buildRecents(
  trail: string[],
  available: MembershipEstablishment[],
): MembershipEstablishment[] {
  const byId = new Map(available.map((e) => [e.id, e]));
  const fromTrail: MembershipEstablishment[] = [];
  const seen = new Set<string>();
  for (const id of trail) {
    const est = byId.get(id);
    if (est && !seen.has(id)) {
      fromTrail.push(est);
      seen.add(id);
    }
  }
  const remaining = available
    .filter((e) => !seen.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es-AR', { sensitivity: 'base' }));
  return [...fromTrail, ...remaining];
}

// ─── Desambiguación de campos homónimos (R6.6 / R6.8.1) — Run 2 (e) ─────────────
//
// Con campos del mismo nombre el switch "se ve muy confuso" (Raf). El subtítulo de
// desambiguación es localidad + rol. NO usamos "propietario/owner-name" (RLS no expone
// el dueño a los miembros — diferido a Facundo). Lógica pura para testear.

/** Etiqueta de rol canónica en español (UI en español). FUENTE ÚNICA — la consumen el
 *  dropdown del switch y EstablishmentCard para no divergir (Nielsen #4 consistencia). */
const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Dueño',
  field_operator: 'Operario',
  veterinarian: 'Veterinario',
};

/** Etiqueta de rol en español para el usuario final. Pura. */
export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

/**
 * Localidad de desambiguación de un campo: `city` si existe y no está vacía, si no
 * `province` (que es obligatoria en el alta, R3.3). Devuelve '' solo si ambas faltan
 * (no debería pasar — province es obligatoria — pero defendemos null/vacío). El llamador
 * NO debe renderizar una línea con "·" colgando si esto vuelve vacío. Pura.
 */
export function localityOf(args: { city?: string | null; province?: string | null }): string {
  const city = args.city?.trim();
  if (city) return city;
  const province = args.province?.trim();
  return province ?? '';
}

// ─── Detección de nombres duplicados (R3.1 / R3.4) — Run 2 (f) ──────────────────

/** Campo accesible mínimo para comparar nombres (id + name) — lo cumple MembershipEstablishment. */
export type NamedField = { id: string; name: string };

/**
 * ¿`name` coincide (trimmed + case/acento-insensitive, es-AR) con el nombre de algún campo
 * de `existing`? Mismo criterio de comparación que el filtro de búsqueda de "Mis campos"
 * (toLocaleLowerCase('es-AR') + sin acentos). Se usa para ADVERTIR (no bloquear) al
 * crear/editar un campo con nombre repetido (decisión council).
 *
 * `excludeId` (opcional): en EDICIÓN, el propio campo no cuenta como duplicado de sí mismo.
 * Pasamos su id para saltarlo de la comparación — así editar sin cambiar el nombre NO
 * advierte, pero si hay OTRO campo genuinamente homónimo sí (su id no fue excluido). En
 * ALTA no se pasa (el campo nuevo aún no existe en `existing`).
 *
 * Nombre vacío/blanco → false (no advertimos sobre un campo sin tipear todavía). Pura.
 */
export function hasDuplicateName(
  name: string,
  existing: NamedField[],
  excludeId?: string,
): boolean {
  const target = normalizeName(name);
  if (target.length === 0) return false;
  return existing.some((e) => e.id !== excludeId && normalizeName(e.name) === target);
}

/** Normalización de nombre para comparar: trim + lowercase es-AR + sin acentos (NFD). */
function normalizeName(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

// ─── Banner "establecimiento listo" per-campo (R6.x) — Run 2 (c) ────────────────

/**
 * ¿Mostrar el banner "establecimiento listo" para el campo activo? Solo si hay un campo
 * activo (`activeId` no nulo) y su id NO está en el set de banners ya descartados por el
 * usuario (persistido per-campo, establishment-store). Pura, null-safe.
 *
 * TODO (spec 02 frontend): gatear ADEMÁS por rodeoCount === 0 ("solo si falta configurar",
 * decisión council). El frontend de rodeos (spec 02) no existe todavía, así que hoy NO
 * podemos consultar si el campo tiene rodeo → gateamos SOLO por el set de descartados
 * (efectivamente todos los campos están sin configurar hoy). NO inventamos estado de rodeo.
 */
export function shouldShowReadyBanner(
  activeId: string | null,
  dismissedIds: string[],
): boolean {
  if (!activeId) return false;
  return !dismissedIds.includes(activeId);
}
