// local-reads.ts — SQL builders PUROS para el swap de lectura PostgREST → SQLite local (spec 15, T3).
//
// Cada `build<Algo>Query(params)` devuelve `{ sql, args }` SIN tocar I/O (no importa el SDK, ni
// supabase, ni RN) → testeable bajo node:test (mismo patrón puro que upload-classify.ts / status-derive.ts).
// El módulo de I/O (cada service) hace `getPowerSync().getAll(sql, args)` y mapea las filas con los
// `to<Tipo>` existentes. Acá vive SOLO la lógica de SQL (qué tabla, qué columnas, qué filtros de DOMINIO,
// qué JOINs, qué orden).
//
// Reglas del swap (design §5.1, scope T3):
//  - NO se re-filtra el scoping de tenant (`establishment_id IN (...)`, `has_role_in`): la sync stream
//    YA scopeó al sincronizar (el dato que está local ya es el autorizado). Re-filtrar sería redundante
//    y arriesgaría divergir del set ya autorizado.
//  - SÍ se conservan los filtros de DOMINIO que las queries PostgREST aplican y que NO son de scoping:
//    p.ej. `active = true` en field_definitions y rodeos. El `deleted_at IS NULL` ya lo garantiza la
//    stream; se deja defensivo en el SQL local (no-op, pero explícito).
//  - (c2, ADR-026 — paso 2) Los NOMBRES de coworkers (y el propio) se leen de `user_roles.member_name`
//    (denormalizado desde users.name, migración 0080), NO de la tabla global `users`: el paso 2 NO sincroniza
//    `users` (sin establishment_id propio → fuera del modelo JOIN-free). La PII (email/phone) sigue en
//    `user_private` self-only (ADR-025). buildMembersQuery/buildOwnNameQuery ya NO JOINean/leen `users`.
//  - Los JOINs `!inner`/nested de PostgREST se reescriben como JOINs SQLite normales.
//  - SQLite guarda los booleanos como 0/1 (column.integer en AppSchema); el coerción a boolean la hace
//    el mapper del service (helper `toBool` exportado acá para reuso), preservando el shape público.
//    ⚠️ Asunción verificable: PowerSync materializa un boolean de Postgres en una columna `INTEGER`
//    como el entero 1/0 (comportamiento estable del SDK). Por eso los filtros de dominio usan
//    `active = 1` (equivalente al `.eq('active', true)` de PostgREST). El log de diagnóstico de
//    provider.tsx + la validación en vivo de Raf confirman que el set de filas no cambió.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id ni ids; llegan por param.

export type LocalQuery = { sql: string; args: unknown[] };

/** Coerce un valor SQLite (0/1, '0'/'1', boolean, null) a boolean. SQLite no tiene tipo boolean. */
export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

// ─── Catálogos globales (T3.1) ────────────────────────────────────────────────────

/**
 * field_definitions activos (espeja rodeo-config.fetchFieldCatalog).
 * Filtro de DOMINIO conservado: `active = 1`. Catálogo global → sin scoping de tenant.
 */
export function buildFieldCatalogQuery(): LocalQuery {
  return {
    sql:
      'SELECT id, data_key, label, description, category, data_type, ui_component ' +
      'FROM field_definitions WHERE active = 1',
    args: [],
  };
}

/**
 * system_default_fields de un sistema (espeja rodeo-config.fetchSystemDefaults).
 * Sin filtro de dominio extra: PostgREST traía todas las del system_id.
 */
export function buildSystemDefaultsQuery(systemId: string): LocalQuery {
  return {
    sql:
      'SELECT field_definition_id, default_enabled, required_for_system, sort_order ' +
      'FROM system_default_fields WHERE system_id = ?',
    args: [systemId],
  };
}

/**
 * rodeo_data_config de un rodeo (espeja rodeo-config.fetchRodeoConfig). Sin filtro de dominio extra
 * (PostgREST traía todas las filas del rodeo_id). La stream ya scopeó por establecimiento del rodeo.
 */
export function buildRodeoConfigQuery(rodeoId: string): LocalQuery {
  return {
    sql: 'SELECT field_definition_id, enabled FROM rodeo_data_config WHERE rodeo_id = ?',
    args: [rodeoId],
  };
}

/**
 * categories_by_system activas de un sistema, ordenadas por sort_order (espeja
 * animals.fetchSystemCategories). Filtro de DOMINIO conservado: `active = 1`. Orden preservado.
 */
export function buildSystemCategoriesQuery(systemId: string): LocalQuery {
  return {
    sql:
      'SELECT code, name FROM categories_by_system ' +
      'WHERE system_id = ? AND active = 1 ORDER BY sort_order ASC',
    args: [systemId],
  };
}

// ─── Sistemas productivos (T3.1) — fetchProductionSystems ──────────────────────────

/**
 * species id por code (paso 1 de fetchProductionSystems). Filtro de DOMINIO conservado: `active = 1`
 * (PostgREST: `.eq('code', …).eq('active', true).maybeSingle()`). LIMIT 1 = maybeSingle.
 */
export function buildSpeciesByCodeQuery(speciesCode: string): LocalQuery {
  return {
    sql: 'SELECT id FROM species WHERE code = ? AND active = 1 LIMIT 1',
    args: [speciesCode],
  };
}

/**
 * systems_by_species de una especie (paso 2 de fetchProductionSystems). PostgREST traía TODOS
 * (activos e inactivos) para grisar los no-MVP → NO se filtra active acá. Sin orden explícito
 * (PostgREST tampoco lo tenía).
 */
export function buildSystemsBySpeciesQuery(speciesId: string): LocalQuery {
  return {
    sql:
      'SELECT id, species_id, code, name, active FROM systems_by_species WHERE species_id = ?',
    args: [speciesId],
  };
}

// ─── Rodeos (T3.3) — fetchRodeos ───────────────────────────────────────────────────

/**
 * Rodeos ACTIVOS (no soft-deleted) de un establecimiento (espeja rodeos.fetchRodeos).
 * Filtros de DOMINIO conservados: `active = 1` (excluye desactivados) + `deleted_at IS NULL`
 * (defensivo; la stream ya lo garantiza). Orden preservado: `created_at ASC`.
 */
export function buildRodeosQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      'SELECT id, establishment_id, name, species_id, system_id, active FROM rodeos ' +
      'WHERE establishment_id = ? AND active = 1 AND deleted_at IS NULL ' +
      'ORDER BY created_at ASC',
    args: [establishmentId],
  };
}

// ─── Contexto de establecimiento (T3.2) ────────────────────────────────────────────

/**
 * Memberships del usuario: user_roles activos del propio usuario + JOIN a establishments vivos
 * (espeja establishments.loadMemberships, que hacía `user_roles → establishments` con join PostgREST).
 *
 * El JOIN `!inner` de PostgREST (`establishment:establishments(...)`) se reescribe como JOIN SQLite.
 * Filtros de DOMINIO conservados: `ur.active = 1` (rol activo) + `ur.user_id = ?` (SOLO sus roles —
 * crítico: la stream est_members trae roles de coworkers para el owner; sin este filtro un owner
 * vería N filas y duplicaría el campo, igual que la nota de loadMemberships). El soft-delete del
 * establecimiento (`e.deleted_at IS NULL`) replica el filtro que el mapper PostgREST hacía sobre la
 * fila embebida (R8.3).
 */
export function buildMembershipsQuery(userId: string): LocalQuery {
  return {
    sql:
      'SELECT ur.role AS role, e.id AS id, e.name AS name, e.province AS province, ' +
      'e.city AS city, e.deleted_at AS deleted_at ' +
      'FROM user_roles ur JOIN establishments e ON e.id = ur.establishment_id ' +
      'WHERE ur.user_id = ? AND ur.active = 1 AND e.deleted_at IS NULL',
    args: [userId],
  };
}

/**
 * phone propio (espeja establishments.loadOwnProfile). user_private es self-only en la stream →
 * la única fila local es la del usuario; igual filtramos por user_id (defensivo + explícito).
 */
export function buildOwnPhoneQuery(userId: string): LocalQuery {
  return {
    sql: 'SELECT phone FROM user_private WHERE user_id = ? LIMIT 1',
    args: [userId],
  };
}

/**
 * name del perfil público propio (espeja la 1ra query de loadFullProfile / loadProfileNamePhone).
 *
 * (c2, ADR-026) El nombre se lee de `user_roles.member_name` (denormalizado desde users.name, migración 0080),
 * NO de la tabla global `users` — que el paso 2 NO sincroniza (queda online; ver R13.8/c2). El propio user tiene
 * N filas en user_roles (una por campo activo), todas con el MISMO member_name → `LIMIT 1` toma cualquiera.
 * El shape del resultado (`{ name }`) NO cambia (R11.1); cambia solo la FUENTE (user_roles en vez de users).
 */
export function buildOwnNameQuery(userId: string): LocalQuery {
  return {
    sql: 'SELECT member_name AS name FROM user_roles WHERE user_id = ? LIMIT 1',
    args: [userId],
  };
}

/**
 * email + phone propios (espeja la 2da query de loadFullProfile). user_private self-only.
 */
export function buildOwnEmailPhoneQuery(userId: string): LocalQuery {
  return {
    sql: 'SELECT email, phone FROM user_private WHERE user_id = ? LIMIT 1',
    args: [userId],
  };
}

/**
 * Datos editables de un establecimiento (espeja establishments.loadEstablishmentDetail).
 * Filtro de DOMINIO conservado: `deleted_at IS NULL`. LIMIT 1 = maybeSingle.
 */
export function buildEstablishmentDetailQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      'SELECT id, name, province, city, total_hectares FROM establishments ' +
      'WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    args: [establishmentId],
  };
}

/**
 * Conteo de OTROS miembros activos del campo, distintos del owner (espeja
 * establishments.countActiveMembers, que era HEAD count). Filtros de DOMINIO: `active = 1` +
 * `user_id != ownerId`.
 */
export function buildCountActiveMembersQuery(
  establishmentId: string,
  ownerId: string,
): LocalQuery {
  return {
    sql:
      'SELECT COUNT(*) AS count FROM user_roles ' +
      'WHERE establishment_id = ? AND active = 1 AND user_id != ?',
    args: [establishmentId, ownerId],
  };
}

// ─── Miembros e invitaciones (T3.2) ────────────────────────────────────────────────

/**
 * Miembros ACTIVOS del campo (espeja members.loadMembers).
 *
 * (c2, ADR-026) El nombre se lee de `user_roles.member_name` (denormalizado desde users.name, migración 0080),
 * eliminando el `LEFT JOIN users`: la tabla global `users` NO se sincroniza en el paso 2 (R13.8/c2). SOLO
 * role + user_id + name (hallazgo RLS #2: nunca phone/email de otros — la PII vive en user_private self-only,
 * ADR-025). Filtro de DOMINIO: `ur.active = 1`. El scoping de qué filas de user_roles ve el usuario lo decidió
 * la stream (est_members_roles: owner ve la matriz; no-owner solo la propia vía self_user_roles). El shape del
 * resultado (role/user_id/user_name) NO cambia (R11.1); cambia solo la FUENTE del nombre.
 */
export function buildMembersQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      'SELECT ur.role AS role, ur.user_id AS user_id, ur.member_name AS user_name ' +
      'FROM user_roles ur ' +
      'WHERE ur.establishment_id = ? AND ur.active = 1',
    args: [establishmentId],
  };
}

/**
 * Conteo de otros miembros activos (≠ self) del campo (espeja la 1ra mitad de members.countTeam).
 * Filtros de DOMINIO: `active = 1` + `user_id != selfUserId`.
 */
export function buildCountOtherMembersQuery(
  establishmentId: string,
  selfUserId: string,
): LocalQuery {
  return {
    sql:
      'SELECT COUNT(*) AS count FROM user_roles ' +
      'WHERE establishment_id = ? AND active = 1 AND user_id != ?',
    args: [establishmentId, selfUserId],
  };
}

/**
 * Conteo de invitaciones pendientes del campo (espeja la 2da mitad de members.countTeam). Filtro de
 * DOMINIO: `status = 'pending'`. La stream est_invitations es owner-only y solo pending → para un
 * no-owner no hay filas locales (da 0), igual que la RLS owner-only del path PostgREST.
 */
export function buildCountPendingInvitationsQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      "SELECT COUNT(*) AS count FROM invitations " +
      "WHERE establishment_id = ? AND status = 'pending'",
    args: [establishmentId],
  };
}

/**
 * Invitaciones PENDIENTES del campo (espeja members.loadPendingInvitations). Filtro de DOMINIO:
 * `status = 'pending'`. Owner-only por la stream (no-owner: sin filas locales).
 */
export function buildPendingInvitationsQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      "SELECT id, role, email, created_at, expires_at, token FROM invitations " +
      "WHERE establishment_id = ? AND status = 'pending'",
    args: [establishmentId],
  };
}
