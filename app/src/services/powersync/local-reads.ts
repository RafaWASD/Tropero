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
  // OVERLAY-OVERRIDE (Run T9.8 alta + Run T9.9 edición / R6.11). El overlay pending_rodeo_data_config porta
  // dos casos:
  //   - ALTA offline (T9.8): la plantilla COMPUTADA en el cliente al crear el rodeo. La tabla synced está
  //     vacía para ese rodeo (no baja hasta el ACK) → el overlay es la única fuente.
  //   - EDICIÓN offline (T9.9): el diff de toggles que el owner cambió. La tabla synced YA tiene la fila vieja
  //     del field → un UNION ALL puro DUPLICARÍA el field_definition_id (synced viejo + overlay nuevo). Por eso
  //     es overlay-OVERRIDE, no UNION ALL: UNA sola fila por field_definition_id, el overlay PISA al synced.
  // Mecánica: (1) las synced del rodeo cuyo field NO está en el overlay (NOT IN); UNION ALL (2) TODAS las del
  // overlay del rodeo. Que esto devuelva UNA sola fila por field depende de un INVARIANTE garantizado por el
  // enqueue: el overlay tiene ≤1 fila por (rodeo_id, field_definition_id) — `enqueueSetRodeoConfig` hace
  // DELETE-PRIOR (borra cualquier fila previa de ese rodeo+field, de cualquier client_op_id) ANTES del INSERT.
  // Por eso YA NO se dedupa por MAX(rowid) ni hay correlated subquery — innecesario y, además, `rowid` NO existe
  // sobre las VIEWS de PowerSync (fix rowid (Run T9.9 follow-up, 2026-06-09): el SQL fallaba "no such column: rowid" online y offline; el
  // unit test no lo cazó porque corre contra node:sqlite, tablas reales con rowid).
  // Overlay vacío → el 2do SELECT no devuelve nada y el 1ro = todas las synced → idéntico al swap T3.1 puro.
  // Caso alta (synced vacío del rodeo) → el 1er SELECT vacío, el 2do devuelve el overlay (una fila por field
  // por el invariante) → OK. Al ACK las filas reales bajan por est_rodeo_data_config y el overlay se limpia.
  return {
    sql:
      'SELECT field_definition_id, enabled FROM rodeo_data_config ' +
      'WHERE rodeo_id = ? AND field_definition_id NOT IN ' +
      '(SELECT field_definition_id FROM pending_rodeo_data_config WHERE rodeo_id = ?) ' +
      'UNION ALL ' +
      'SELECT field_definition_id, enabled FROM pending_rodeo_data_config ' +
      'WHERE rodeo_id = ?',
    args: [rodeoId, rodeoId, rodeoId],
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

/**
 * system_id ACTIVO de un sistema por (species_id, code) — para resolver el system al crear un rodeo
 * (createRodeo, Run T9.8). Filtro de DOMINIO: `active = 1` (el sistema debe estar disponible; la RPC +
 * el trigger lo re-validan al subir). LIMIT 1 = maybeSingle. Catálogo global sincronizado.
 */
export function buildSystemByCodeQuery(speciesId: string, systemCode: string): LocalQuery {
  return {
    sql: 'SELECT id FROM systems_by_species WHERE species_id = ? AND code = ? AND active = 1 LIMIT 1',
    args: [speciesId, systemCode],
  };
}

// ─── Rodeos (T3.3) — fetchRodeos ───────────────────────────────────────────────────

/**
 * Rodeos ACTIVOS (no soft-deleted) de un establecimiento (espeja rodeos.fetchRodeos).
 * Filtros de DOMINIO conservados: `active = 1` (excluye desactivados) + `deleted_at IS NULL`
 * (defensivo; la stream ya lo garantiza). Orden preservado: `created_at ASC`.
 */
export function buildRodeosQuery(establishmentId: string): LocalQuery {
  // UNION overlay (T6/R6.11): oculta los rodeos con un `soft_deleted` pendiente (softDeleteRodeo encola
  // un intent soft_delete_rodeo + override) Y suma los rodeos ALTA-optimistas pendientes (createRodeo
  // encola un intent create_rodeo + pending_rodeos, Run T9.8). Overlay vacío → idéntico al swap T3.3.
  // El rodeo offline aparece en la lista al instante; al ACK la fila real baja por est_rodeos y el
  // overlay se limpia (sin duplicado: el id del overlay = el id de cliente = el id real del rodeo).
  const synced =
    'SELECT id, establishment_id, name, species_id, system_id, active, created_at FROM rodeos rd ' +
    'WHERE rd.establishment_id = ? AND rd.active = 1 AND rd.deleted_at IS NULL AND ' +
    notHiddenByOverride('rodeos', 'rd.id', ['soft_deleted']);
  // Rama OVERLAY: el rodeo alta-optimista. active = 1 (lo escribe el builder del overlay) → pasa el filtro
  // de dominio. Lo ocultamos si ya tiene un soft_delete pendiente (defensivo). Mismas columnas proyectadas.
  const overlay =
    'SELECT id, establishment_id, name, species_id, system_id, active, created_at FROM pending_rodeos pr ' +
    'WHERE pr.establishment_id = ? AND pr.active = 1 AND ' +
    notHiddenByOverride('rodeos', 'pr.id', ['soft_deleted']);
  return {
    // ORDER BY created_at ASC sobre el UNION (ambas ramas proyectan created_at); el del overlay es el
    // now() de cliente → el rodeo recién creado queda al final (orden de creación), igual que el online.
    sql: `${synced} UNION ALL ${overlay} ORDER BY created_at ASC`,
    args: [establishmentId, establishmentId],
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

// ─── Resolución de category_id / species_id para el alta offline (T6.2f) ─────────────

/**
 * category_id por (system_id, code) ACTIVO (espeja la lectura online de categories_by_system de
 * createAnimal). Catálogo global sincronizado (catalog_categories). LIMIT 1 = maybeSingle.
 */
export function buildCategoryIdByCodeQuery(systemId: string, code: string): LocalQuery {
  return {
    sql: 'SELECT id FROM categories_by_system WHERE system_id = ? AND code = ? AND active = 1 LIMIT 1',
    args: [systemId, code],
  };
}

/**
 * species_id de un rodeo (espeja la lectura online de rodeos de createAnimal: animals.species_id deriva
 * del rodeo). El rodeo ya está sincronizado (est_rodeos). LIMIT 1 = maybeSingle.
 */
export function buildRodeoSpeciesQuery(rodeoId: string): LocalQuery {
  return {
    sql: 'SELECT species_id FROM rodeos WHERE id = ? LIMIT 1',
    args: [rodeoId],
  };
}

/**
 * Contexto de la MADRE para el overlay optimista de un parto (T6.2f / register_birth offline): los
 * terneros HEREDAN establishment_id + rodeo_id de la madre (lo hace la RPC server-side); la categoría del
 * ternero (ternero/ternera) se resuelve por el system del rodeo de la madre. Devuelve establishment_id,
 * rodeo_id (de la madre) + species_id/system_id del rodeo. El perfil de la madre ya está sincronizado.
 */
export function buildBirthOverlayContextQuery(motherProfileId: string): LocalQuery {
  return {
    sql:
      'SELECT ap.establishment_id AS establishment_id, ap.rodeo_id AS rodeo_id, ' +
      'r.species_id AS species_id, r.system_id AS system_id ' +
      'FROM animal_profiles ap JOIN rodeos r ON r.id = ap.rodeo_id ' +
      'WHERE ap.id = ? AND ap.deleted_at IS NULL LIMIT 1',
    args: [motherProfileId],
  };
}

// ─── Animales: lista / búsqueda / detalle / lookup (T4.1) ───────────────────────────
//
// b1 (ADR-026 / paso 2 / migración 0079): la identidad del animal (tag electrónico, sexo, fecha de
// nacimiento) está DENORMALIZADA sobre `animal_profiles` (`animal_tag_electronic`/`animal_sex`/
// `animal_birth_date`), mantenida fiel por trigger desde la tabla global `animals`. La tabla `animals`
// NO se sincroniza al SQLite local (es global, sin establishment_id) → estas lecturas NO JOINean a
// `animals`: leen TODO de `animal_profiles` (+ JOINs locales a `rodeos`/`categories_by_system`/
// `management_groups`). Esto reemplaza el `animals!inner ( tag_electronic, sex, birth_date )` de las
// queries PostgREST originales. `breed`/`coat_color` ya viven en `animal_profiles` (no se denormalizan).
//
// El scoping de tenant (has_role_in + deleted_at del campo) ya lo aplicó la stream est_animal_profiles
// al sincronizar → NO se re-filtra. SÍ se conservan los filtros de DOMINIO: `deleted_at IS NULL` propio
// (defensivo), `status = ?` (la tab muestra activos por default), `rodeo_id`, `noTag`, + el orden y el
// LIMIT de la versión PostgREST.

// ─── OVERLAY (T6): UNION synced + overlay `pending_*` (R6.11) ────────────────────────
//
// Las lecturas del camino de campo (lista/búsqueda/detalle/timeline/madre/lotes/rodeos) UNIONan el
// estado SINCRONIZADO con el overlay LOCAL-ONLY (`pending_animal_profiles`, `pending_reproductive_events`,
// `pending_status_overrides`). Efecto: una CREACIÓN optimista (alta/parto/ternero) aparece al instante; una
// BAJA/borrado optimista (exit/soft_delete) se OCULTA — todo offline, antes de que la RPC corra server-side.
// Cuando la RPC corre y el ACK limpia el overlay (clearOverlay), la fila REAL baja por la stream → el UNION
// deja de mostrar el overlay y muestra la fila sincronizada (sin duplicado, R6.11). El overlay vive SOLO en
// tablas localOnly (NO generan CrudEntry, R6.12) → la única CrudEntry de una op (b) es su op_intent.
//
// Por construcción, con el overlay VACÍO (caso normal, sin ops pendientes) el UNION/NOT EXISTS son no-ops →
// el set de filas es IDÉNTICO al swap T4 (sin cambio de comportamiento). Estos builders preservan sus firmas
// públicas (R11.1).

/**
 * Predicado de OCULTACIÓN por override pendiente (R6.11): excluye las filas de `<alias>` cuya `id` (col
 * `<idCol>`) tiene un `pending_status_overrides` con `target_table = <table>` y `effect IN (<effects>)`.
 * Usado por la lista (oculta exits), los lotes/rodeos (ocultan soft_deletes), el timeline (oculta eventos
 * borrados). Sin filas en el overlay → el NOT EXISTS no excluye nada (no-op).
 */
function notHiddenByOverride(table: string, idExpr: string, effects: readonly string[]): string {
  const inList = effects.map((e) => `'${e}'`).join(', ');
  return (
    `NOT EXISTS (SELECT 1 FROM pending_status_overrides pso ` +
    `WHERE pso.target_table = '${table}' AND pso.target_id = ${idExpr} ` +
    `AND pso.effect IN (${inList}))`
  );
}

/**
 * SELECT compartido por la lista y la búsqueda. Reescribe el LIST_SELECT de PostgREST (que embebía
 * `animals!inner`/`rodeos!inner`/`categories_by_system!inner`) como JOINs SQLite sobre las tablas
 * locales. La identidad (tag/sex) sale de `animal_profiles` (b1), NO de `animals`. `LEFT JOIN
 * management_groups` no hace falta para la lista (solo management_group_id, que es columna del perfil).
 * Las columnas se aliasean al shape plano que el mapper toLocalListItem espera.
 */
// Proyecta `created_at` (alias) ADEMÁS de las columnas de la lista: en un UNION el ORDER BY solo puede
// referenciar columnas PROYECTADAS, y la lista ordena por created_at. La búsqueda lo ignora (el mapper
// toLocalListItem lee por nombre y descarta columnas extra) → es inofensivo proyectarlo siempre.
const LOCAL_LIST_SELECT =
  'SELECT ap.id AS id, ap.animal_id AS animal_id, ap.idv AS idv, ' +
  'ap.visual_id_alt AS visual_id_alt, ap.category_id AS category_id, ap.rodeo_id AS rodeo_id, ' +
  'ap.status AS status, ap.management_group_id AS management_group_id, ' +
  'ap.animal_tag_electronic AS tag_electronic, ap.animal_sex AS sex, ' +
  'r.name AS rodeo_name, c.code AS category_code, c.name AS category_name, ' +
  'ap.created_at AS created_at ' +
  'FROM animal_profiles ap ' +
  'JOIN rodeos r ON r.id = ap.rodeo_id ' +
  'JOIN categories_by_system c ON c.id = ap.category_id';

// Mismo SELECT (mismo shape de columnas) PERO desde el overlay `pending_animal_profiles` (alias `pap`).
// La identidad/atributos salen denormalizados del overlay; rodeo/categoría se JOINean a las tablas
// SINCRONIZADAS (para createAnimal/ternero el rodeo y la categoría son filas reales ya sincronizadas).
const LOCAL_LIST_SELECT_OVERLAY =
  'SELECT pap.id AS id, pap.animal_id AS animal_id, pap.idv AS idv, ' +
  'pap.visual_id_alt AS visual_id_alt, pap.category_id AS category_id, pap.rodeo_id AS rodeo_id, ' +
  'pap.status AS status, pap.management_group_id AS management_group_id, ' +
  'pap.animal_tag_electronic AS tag_electronic, pap.animal_sex AS sex, ' +
  'r.name AS rodeo_name, c.code AS category_code, c.name AS category_name, ' +
  'pap.created_at AS created_at ' +
  'FROM pending_animal_profiles pap ' +
  'JOIN rodeos r ON r.id = pap.rodeo_id ' +
  'JOIN categories_by_system c ON c.id = pap.category_id';

/** Filtros de dominio comunes de la lista/búsqueda: establishment + status + deleted_at propio. */
function listDomainFilters(establishmentId: string, status: string): { where: string; args: unknown[] } {
  return {
    where: 'ap.establishment_id = ? AND ap.deleted_at IS NULL AND ap.status = ?',
    args: [establishmentId, status],
  };
}

// Filtros de dominio EQUIVALENTES sobre el overlay (alias `pap`; no tiene deleted_at — un pending nunca
// está soft-deleteado). Mismo establishment + status.
function listDomainFiltersOverlay(establishmentId: string, status: string): { where: string; args: unknown[] } {
  return {
    where: 'pap.establishment_id = ? AND pap.status = ?',
    args: [establishmentId, status],
  };
}

// Cláusula que OCULTA del listado sincronizado los perfiles con un override pendiente (exit/soft_delete):
// la baja/borrado optimista saca al animal de la lista activa antes de que la RPC corra (R6.11).
const HIDE_EXITED_PROFILE = notHiddenByOverride('animal_profiles', 'ap.id', ['exited', 'soft_deleted']);

/**
 * Lista de animal_profiles del campo (espeja animals.fetchAnimals). Filtros de DOMINIO conservados:
 * establishment + `deleted_at IS NULL` + `status` (default 'active') + opcional `rodeo_id` + opcional
 * `noTag` (`animal_tag_electronic IS NULL`, b1). Orden `created_at DESC` + LIMIT 200, idénticos.
 *
 * UNION overlay (T6/R6.11): suma las altas/terneros optimistas (`pending_animal_profiles`) y OCULTA los
 * perfiles con un override `exited`/`soft_deleted` pendiente. Overlay vacío → idéntico al swap T4.
 */
export function buildAnimalsListQuery(
  establishmentId: string,
  filter: { rodeoId?: string | null; status?: string | null; noTag?: boolean } = {},
): LocalQuery {
  const status = filter.status ?? 'active';
  // Parte SINCRONIZADA (con ocultación de exits/soft-deletes pendientes).
  const dom = listDomainFilters(establishmentId, status);
  let synced = `${LOCAL_LIST_SELECT} WHERE ${dom.where} AND ${HIDE_EXITED_PROFILE}`;
  const args: unknown[] = [...dom.args];
  // Parte OVERLAY (altas/terneros optimistas; ocultos si ya tienen un override — defensivo).
  const domO = listDomainFiltersOverlay(establishmentId, status);
  let overlay =
    `${LOCAL_LIST_SELECT_OVERLAY} WHERE ${domO.where} AND ` +
    notHiddenByOverride('animal_profiles', 'pap.id', ['exited', 'soft_deleted']);
  const overlayArgs: unknown[] = [...domO.args];
  if (filter.rodeoId) {
    synced += ' AND ap.rodeo_id = ?';
    args.push(filter.rodeoId);
    overlay += ' AND pap.rodeo_id = ?';
    overlayArgs.push(filter.rodeoId);
  }
  if (filter.noTag) {
    // "sin caravana" = identidad denormalizada tag NULL (b1; antes animals.tag_electronic IS NULL).
    synced += ' AND ap.animal_tag_electronic IS NULL';
    overlay += ' AND pap.animal_tag_electronic IS NULL';
  }
  // El ORDER BY usa el alias proyectado `created_at` (lo emiten ambas ramas: ap.created_at / pap.created_at).
  const sql = `${synced} UNION ALL ${overlay} ORDER BY created_at DESC LIMIT 200`;
  return { sql, args: [...args, ...overlayArgs] };
}

/**
 * Conteo de animales ACTIVOS del campo (espeja animals.countAnimals; era head:true count). status
 * 'active' + deleted_at IS NULL. COUNT(*) → siempre 1 fila (no degrada a "sincronizando").
 *
 * UNION overlay (T6): suma los pending activos NO ocultos y resta los sincronizados con exit pendiente.
 * Overlay vacío → idéntico al swap T4.
 */
export function buildAnimalsCountQuery(establishmentId: string): LocalQuery {
  const sql =
    'SELECT (' +
    'SELECT COUNT(*) FROM animal_profiles ap ' +
    "WHERE ap.establishment_id = ? AND ap.status = 'active' AND ap.deleted_at IS NULL AND " +
    HIDE_EXITED_PROFILE +
    ') + (' +
    'SELECT COUNT(*) FROM pending_animal_profiles pap ' +
    "WHERE pap.establishment_id = ? AND pap.status = 'active' AND " +
    notHiddenByOverride('animal_profiles', 'pap.id', ['exited', 'soft_deleted']) +
    ') AS count';
  return { sql, args: [establishmentId, establishmentId] };
}

/** UNION genérico synced+overlay para las búsquedas (TAG/IDV/LIKE): mismo filtro extra en ambas ramas. */
function buildSearchUnion(
  establishmentId: string,
  syncedExtra: string,
  overlayExtra: string,
  extraArg: unknown,
): LocalQuery {
  const dom = listDomainFilters(establishmentId, 'active');
  const synced = `${LOCAL_LIST_SELECT} WHERE ${dom.where} AND ${HIDE_EXITED_PROFILE} AND ${syncedExtra}`;
  const domO = listDomainFiltersOverlay(establishmentId, 'active');
  const overlay =
    `${LOCAL_LIST_SELECT_OVERLAY} WHERE ${domO.where} AND ` +
    notHiddenByOverride('animal_profiles', 'pap.id', ['exited', 'soft_deleted']) +
    ` AND ${overlayExtra}`;
  // LIMIT 20 sobre el UNION completo (mismo tope que el T4; el dedup por profileId lo hace el service).
  return {
    sql: `${synced} UNION ALL ${overlay} LIMIT 20`,
    args: [...dom.args, extraArg, ...domO.args, extraArg],
  };
}

/**
 * Búsqueda EXACTA por TAG electrónico (b1: `animal_profiles.animal_tag_electronic`). status active +
 * deleted_at IS NULL + LIMIT 20. UNION synced + overlay (T6); oculta exits pendientes.
 */
export function buildSearchByTagQuery(establishmentId: string, tag: string): LocalQuery {
  return buildSearchUnion(
    establishmentId,
    'ap.animal_tag_electronic = ?',
    'pap.animal_tag_electronic = ?',
    tag,
  );
}

/**
 * Búsqueda EXACTA por IDV (`animal_profiles.idv`). status active + deleted_at IS NULL + LIMIT 20.
 * UNION synced + overlay (T6).
 */
export function buildSearchByIdvQuery(establishmentId: string, idv: string): LocalQuery {
  return buildSearchUnion(establishmentId, 'ap.idv = ?', 'pap.idv = ?', idv);
}

/**
 * Búsqueda PARCIAL (substring) sobre una columna de animal_profiles, como `LIKE '%term%'` local
 * (degradación del fuzzy/ilike de PostgREST — SQLite no tiene pg_trgm; el LIKE cubre el caso operativo
 * de tipear un fragmento). `escapeLike` neutraliza los comodines `% _ \` del término del usuario y usa
 * `ESCAPE '\'` (SQLite LIKE usa `%`/`_` como comodines; sin escape un `%` literal del término actuaría
 * de comodín). status active + deleted_at IS NULL + LIMIT 20. UNION synced + overlay (T6).
 *
 * @param column  columna de animal_profiles sobre la que matchear (whitelist: 'animal_tag_electronic',
 *                'idv', 'visual_id_alt'). NO es input de usuario — la elige el service (anti-injection).
 */
export function buildSearchLikeQuery(
  establishmentId: string,
  column: 'animal_tag_electronic' | 'idv' | 'visual_id_alt',
  term: string,
): LocalQuery {
  const pattern = `%${escapeLike(term)}%`;
  return buildSearchUnion(
    establishmentId,
    `ap.${column} LIKE ? ESCAPE '\\'`,
    `pap.${column} LIKE ? ESCAPE '\\'`,
    pattern,
  );
}

/**
 * Escapa los comodines de SQLite LIKE (`%` `_`) y el propio carácter de escape (`\`) en el término del
 * usuario, para usarse con `LIKE ? ESCAPE '\'`. Así un `%`/`_` literal del término NO actúa de comodín
 * (defensa; los identificadores rara vez los tienen, pero un atacante podría inyectar un `%` para
 * ampliar el match). NO toca el `%` envolvente que arma el patrón (ese sí es comodín, intencional).
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Detalle de un animal_profile para la ficha (espeja animals.fetchAnimalDetail). Identidad (tag/sex/
 * birth_date) desde `animal_profiles` (b1). LEFT JOIN management_groups (el lote puede estar
 * soft-deleted; la UI muestra "sin lote" si management_group_id es null). Filtro de DOMINIO:
 * `deleted_at IS NULL`. LIMIT 1 = maybeSingle.
 */
export function buildAnimalDetailQuery(profileId: string): LocalQuery {
  // UNION synced + overlay (T6/R6.11): un alta optimista (pending_animal_profiles) muestra su ficha
  // ANTES de que la RPC corra; al limpiarse el overlay (ACK), la fila real baja por la stream y la ficha
  // sale de la rama sincronizada (sin duplicado — un solo profileId existe en un lado por vez).
  //
  // Para una BAJA optimista (exit) de un perfil SINCRONIZADO, el override marca el `status` nuevo:
  // COALESCE(pso.status, ap.status) → la ficha refleja el archivado al instante. La FECHA de egreso
  // también sale del override (COALESCE(pso.exit_date, ap.exit_date)) → el badge "Vendido el {fecha}"
  // funciona OFFLINE con la misma fecha que la RPC persistirá (residual #2; sin esto salía "Vendido"
  // sin fecha porque ap.exit_date es NULL hasta que la RPC corre). El override NO oculta la ficha (un
  // animal dado de baja sigue visible/archivado, R4.12/R4.15) — solo la lista activa lo oculta.
  const synced =
    'SELECT ap.id AS id, ap.animal_id AS animal_id, ap.establishment_id AS establishment_id, ' +
    'ap.idv AS idv, ap.visual_id_alt AS visual_id_alt, ap.category_id AS category_id, ' +
    'ap.category_override AS category_override, ap.breed AS breed, ap.coat_color AS coat_color, ' +
    'ap.entry_date AS entry_date, ap.entry_weight AS entry_weight, ' +
    'COALESCE(pso.status, ap.status) AS status, ' +
    'ap.created_by AS created_by, COALESCE(pso.exit_date, ap.exit_date) AS exit_date, ' +
    'ap.exit_reason AS exit_reason, ' +
    'ap.rodeo_id AS rodeo_id, ap.management_group_id AS management_group_id, ' +
    'ap.animal_tag_electronic AS tag_electronic, ap.animal_sex AS sex, ' +
    'ap.animal_birth_date AS birth_date, ' +
    'r.name AS rodeo_name, c.code AS category_code, c.name AS category_name, ' +
    'mg.name AS management_group_name ' +
    'FROM animal_profiles ap ' +
    'JOIN rodeos r ON r.id = ap.rodeo_id ' +
    'JOIN categories_by_system c ON c.id = ap.category_id ' +
    'LEFT JOIN management_groups mg ON mg.id = ap.management_group_id ' +
    "LEFT JOIN pending_status_overrides pso ON pso.target_table = 'animal_profiles' " +
    "AND pso.target_id = ap.id AND pso.effect = 'exited' " +
    'WHERE ap.id = ? AND ap.deleted_at IS NULL';
  const overlay =
    'SELECT pap.id AS id, pap.animal_id AS animal_id, pap.establishment_id AS establishment_id, ' +
    'pap.idv AS idv, pap.visual_id_alt AS visual_id_alt, pap.category_id AS category_id, ' +
    'pap.category_override AS category_override, pap.breed AS breed, pap.coat_color AS coat_color, ' +
    'pap.entry_date AS entry_date, pap.entry_weight AS entry_weight, pap.status AS status, ' +
    'pap.created_by AS created_by, pap.exit_date AS exit_date, pap.exit_reason AS exit_reason, ' +
    'pap.rodeo_id AS rodeo_id, pap.management_group_id AS management_group_id, ' +
    'pap.animal_tag_electronic AS tag_electronic, pap.animal_sex AS sex, ' +
    'pap.animal_birth_date AS birth_date, ' +
    'r.name AS rodeo_name, c.code AS category_code, c.name AS category_name, ' +
    'mg.name AS management_group_name ' +
    'FROM pending_animal_profiles pap ' +
    'JOIN rodeos r ON r.id = pap.rodeo_id ' +
    'JOIN categories_by_system c ON c.id = pap.category_id ' +
    'LEFT JOIN management_groups mg ON mg.id = pap.management_group_id ' +
    'WHERE pap.id = ?';
  return {
    sql: `${synced} UNION ALL ${overlay} LIMIT 1`,
    args: [profileId, profileId],
  };
}

// ─── Lotes / management_groups (T4.3) ───────────────────────────────────────────────

/**
 * Lotes ACTIVOS (no soft-deleted) del campo (espeja management-groups.fetchManagementGroups).
 * Filtros de DOMINIO conservados: `active = 1` + `deleted_at IS NULL` (defensivo). Orden por nombre
 * ASC (lista estable, es-AR). El scoping ya lo hizo la stream est_management_groups.
 */
export function buildManagementGroupsQuery(establishmentId: string): LocalQuery {
  // UNION overlay (T6/R6.11): oculta los lotes con un `soft_deleted` pendiente (el borrado optimista
  // saca el lote de la lista antes de que la RPC corra). Overlay vacío → idéntico al swap T4.
  return {
    sql:
      'SELECT id, name FROM management_groups mg ' +
      'WHERE mg.establishment_id = ? AND mg.active = 1 AND mg.deleted_at IS NULL AND ' +
      notHiddenByOverride('management_groups', 'mg.id', ['soft_deleted']) +
      ' ORDER BY name ASC',
    args: [establishmentId],
  };
}

// ─── Timeline del animal (T4.2) — UNION ALL local de los 7 orígenes ─────────────────
//
// Reconstruye la RPC `animal_timeline` (security definer, 0035/0069) como SQL local sobre las tablas
// de evento YA sincronizadas. Replica EXACTAMENTE los 7 orígenes, sus columnas (event_kind/event_id/
// event_date/created_at/payload), el `event_date` por origen y el payload (jsonb_build_object → SQLite
// json_object). El filtro `has_role_in(...)` de la RPC era el SCOPING → ya lo aplicó la stream al
// sincronizar, así que NO se re-filtra; SÍ se conserva el `deleted_at IS NULL` propio de cada origen
// (animal_category_history NO tiene deleted_at, igual que en la RPC).
//
// El `payload` se construye con `json_object(...)` (JSON1, disponible en el SQLite de PowerSync) → baja
// como TEXT (string JSON). El service lo `JSON.parse`ea a un Record antes de pasarlo a parseTimelineRow
// (que espera `payload: Record`). El ORDEN visual lo hace el cliente (parseTimeline); el `ORDER BY
// event_date DESC` de acá es cosmético/defensivo (igual que el de la RPC).
//
// event_date por origen (fiel a 0069):
//   - weight: la RPC hace `weight_date::timestamptz + coalesce(time,'00:00')`. weight es un date-only
//     kind (parseTimelineRow → componentes UTC), y el orden intra-día lo da `created_at`, no la hora del
//     event_date → emitir `weight_date` (la columna `date`) reproduce fielmente el día calendario y el
//     estado vigente; la hora `time` se folda en created_at para el orden, igual que la RPC.
//   - reproductive/sanitary/condition_score: `event_date` (columna date).
//   - lab_sample: `collection_date`.
//   - category_change (animal_category_history): `changed_at` (instante real, sin deleted_at propio).
//   - observacion (animal_events): `created_at` (instante real).

export function buildTimelineQuery(profileId: string): LocalQuery {
  // 7 sub-selects unidos por UNION ALL. Cada uno scopea por animal_profile_id = ? (el del perfil) +
  // su deleted_at propio (salvo category_change, append-only de auditoría). El payload espeja el
  // jsonb_build_object de cada origen en 0069 (mismas claves: el parser lee esas claves).
  const sql =
    "SELECT 'weight' AS event_kind, id AS event_id, weight_date AS event_date, created_at AS created_at, " +
    "json_object('weight_kg', weight_kg, 'source', source, 'notes', notes) AS payload " +
    'FROM weight_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'reproductive', id, event_date, created_at, " +
    "json_object('event_type', event_type, 'pregnancy_status', pregnancy_status, 'calf_id', calf_id, 'notes', notes) " +
    'FROM reproductive_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'sanitary', id, event_date, created_at, " +
    "json_object('event_type', event_type, 'product_name', product_name, 'route', route, 'notes', notes) " +
    'FROM sanitary_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'condition_score', id, event_date, created_at, " +
    "json_object('score', score, 'notes', notes) " +
    'FROM condition_score_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'lab_sample', id, collection_date, created_at, " +
    "json_object('sample_type', sample_type, 'tube_number', tube_number, 'result', result, 'received', result_received_date) " +
    'FROM lab_samples WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'category_change', id, changed_at, changed_at, " +
    "json_object('from', from_category_id, 'to', to_category_id, 'reason', reason) " +
    'FROM animal_category_history WHERE animal_profile_id = ? ' +
    'UNION ALL ' +
    "SELECT 'observacion', id, created_at, created_at, " +
    "json_object('event_type', event_type, 'text', text, 'structured_payload', structured_payload, 'author_id', author_id, 'edit_window_until', edit_window_until) " +
    'FROM animal_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    // OVERLAY (T6/R6.11): el PARTO optimista (pending_reproductive_events, encolado por registerBirth)
    // aparece en la cronología de la madre ANTES de que register_birth corra server-side. Al limpiarse el
    // overlay (ACK), la fila real baja por la stream est_reproductive_events → el UNION la muestra desde la
    // rama sincronizada (sin duplicado). event_kind 'reproductive'; el payload espeja el de la rama synced.
    'UNION ALL ' +
    "SELECT 'reproductive', id, event_date, created_at, " +
    "json_object('event_type', event_type, 'pregnancy_status', NULL, 'calf_id', NULL, 'notes', notes) " +
    'FROM pending_reproductive_events WHERE animal_profile_id = ? ' +
    'ORDER BY event_date DESC';
  // 7 placeholders sincronizados + 1 del overlay (pending birth) = 8, todos = profileId.
  return {
    sql,
    args: [profileId, profileId, profileId, profileId, profileId, profileId, profileId, profileId],
  };
}

/**
 * service_type de los eventos reproductivos del perfil (espeja la query suplementaria de fetchTimeline,
 * que la RPC animal_timeline NO trae). Mapa eventId→service_type que applyReproMeta consume.
 */
export function buildReproServiceTypesQuery(profileId: string): LocalQuery {
  return {
    sql: 'SELECT id, service_type FROM reproductive_events WHERE animal_profile_id = ? AND deleted_at IS NULL',
    args: [profileId],
  };
}

/**
 * Nombres de categoría por id (espeja la query suplementaria de fetchTimeline para resolver los UUID
 * de los category_change). Genera el `IN (?, ?, …)` con un placeholder por id; sin ids → caller no llama.
 */
export function buildCategoryNamesQuery(categoryIds: readonly string[]): LocalQuery {
  const placeholders = categoryIds.map(() => '?').join(', ');
  return {
    sql: `SELECT id, name FROM categories_by_system WHERE id IN (${placeholders})`,
    args: [...categoryIds],
  };
}

// ─── Madre de un ternero (T4.2) — JOIN local birth_calves → parto → madre ───────────
//
// Reescribe el nested PostgREST de events.fetchMother como JOINs SQLite. Cadena:
//   birth_calves (calf_profile_id = ?) → reproductive_events (parto, por birth_event_id) →
//   animal_profiles (la MADRE, por reproductive_events.animal_profile_id).
// Identidad de la madre (tag) desde animal_profiles (b1; antes JOIN a `animals`). Categoría por id.
// NO se filtra por status de la madre (R14.7/R4.15: la madre puede estar vendida/muerta/transferida y
// el link DEBE funcionar). NO se re-scopea tenant (las 3 tablas ya sincronizaron scopeadas). LIMIT 1
// (un ternero pertenece a UN parto). `deleted_at IS NULL` del parto espeja birth_calves_select (la RPC
// filtraba el evento soft-deleted); la madre se trae aunque esté archivada (sin filtro de status).
export function buildMotherQuery(calfProfileId: string): LocalQuery {
  // Rama SINCRONIZADA: calf → birth_calves → reproductive_events (parto) → animal_profiles (madre).
  const synced =
    'SELECT m.id AS id, m.idv AS idv, m.visual_id_alt AS visual_id_alt, m.status AS status, ' +
    'm.animal_tag_electronic AS tag_electronic, c.name AS category_name ' +
    'FROM birth_calves bc ' +
    'JOIN reproductive_events re ON re.id = bc.birth_event_id AND re.deleted_at IS NULL ' +
    'JOIN animal_profiles m ON m.id = re.animal_profile_id ' +
    'LEFT JOIN categories_by_system c ON c.id = m.category_id ' +
    'WHERE bc.calf_profile_id = ?';
  // Rama OVERLAY (T6/R6.11): un parto optimista (registerBirth offline) crea el ternero en
  // pending_animal_profiles + pending_birth_calves + pending_reproductive_events; la MADRE ya está
  // SINCRONIZADA (animal_profiles real). Así el link calf→madre funciona offline ANTES de que la RPC corra.
  // Al limpiarse el overlay (ACK), la rama synced lo resuelve. Sin override de status de la madre acá
  // (el link debe funcionar aunque la madre esté archivada, R14.7/R4.15).
  const overlay =
    'SELECT m.id AS id, m.idv AS idv, m.visual_id_alt AS visual_id_alt, m.status AS status, ' +
    'm.animal_tag_electronic AS tag_electronic, c.name AS category_name ' +
    'FROM pending_birth_calves pbc ' +
    'JOIN pending_reproductive_events pre ON pre.client_op_id = pbc.client_op_id ' +
    'JOIN animal_profiles m ON m.id = pre.animal_profile_id ' +
    'LEFT JOIN categories_by_system c ON c.id = m.category_id ' +
    'WHERE pbc.calf_profile_id = ?';
  return {
    sql: `${synced} UNION ALL ${overlay} LIMIT 1`,
    args: [calfProfileId, calfProfileId],
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// ESCRITURA LOCAL — CRUD plano offline-safe (spec 15, T5 / R6.1, R6.3, R6.4)
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Builders PUROS de INSERT/UPDATE sobre las tablas SINCRONIZADAS (NO overlay `pending_*` — eso es T6,
// solo para las (b) RPC-bound). El service hace `getPowerSync().execute(sql, args)`; PowerSync encola
// UNA CrudEntry por statement → `connector.uploadData()` la sube al reconectar (upsert/update contra
// PostgREST, RLS+triggers+CHECKs re-validan, R6.2/R8.1). La fila local aparece al instante → las
// lecturas locales (timeline T4, lista de lote) la ven enseguida, offline (R5.3).
//
// `id` de cliente (R6.4, `crypto.randomUUID()` en el service) → se pasa como arg; el builder queda
// determinístico/testeable. NO se setea `created_by`/`author_id`/`created_at`/`source`/`edit_window_*`:
// los fuerza el TRIGGER server-side al SUBIR (desde auth.uid()/now()) — el valor del payload se ignora,
// así que ni siquiera los mandamos en el INSERT local (no se materializan localmente, las lecturas T4
// no dependen de ellos para estos eventos). El `establishment_id` de las tablas de evento (0077, NOT
// NULL en server, FORZADO por trigger desde el perfil al subir) se OMITE en el INSERT local: queda NULL
// local, pero las lecturas T4 filtran por `animal_profile_id` (NO por establishment_id) → no las rompe;
// y el trigger lo re-fuerza al subir → consistente server-side. `animal_events` es la EXCEPCIÓN: su
// `establishment_id` tiene un trigger de VALIDACIÓN (no de force) que exige que coincida con el del
// perfil (23514 si no) → SÍ se setea en el INSERT (el caller lo deriva del perfil, ver addObservation).
//
// R6.3 — el gotcha RLS-on-RETURNING DESAPARECE: la lectura post-escritura es una query LOCAL sobre
// SQLite (no roundtrip, no RETURNING que evalúe la SELECT-policy) → se ELIMINA el split-insert/`select`
// separado y el `count:'exact'`. La autorización real se valida al SUBIR (uploadData → PostgREST → RLS).

/**
 * INSERT local de un weight_event (espeja events.addWeight). `id` de cliente. `establishment_id`/
 * `created_by`/`created_at`/`source` los pone el trigger/default al subir → no se mandan. `notes`
 * opcional: el caller pasa null si no vino (columna nullable).
 */
export function buildAddWeightInsert(
  id: string,
  profileId: string,
  weightKg: number,
  weightDate: string,
  notes: string | null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO weight_events (id, animal_profile_id, weight_kg, weight_date, notes) ' +
      'VALUES (?, ?, ?, ?, ?)',
    args: [id, profileId, weightKg, weightDate, notes],
  };
}

/**
 * INSERT local de un condition_score_event (espeja events.addConditionScore). `id` de cliente. El score
 * viene de un selector CERRADO → cumple el CHECK del DB al subir. `notes` opcional.
 */
export function buildAddConditionScoreInsert(
  id: string,
  profileId: string,
  score: number,
  eventDate: string,
  notes: string | null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO condition_score_events (id, animal_profile_id, score, event_date, notes) ' +
      'VALUES (?, ?, ?, ?, ?)',
    args: [id, profileId, score, eventDate, notes],
  };
}

/**
 * INSERT local de un evento reproductivo `tacto` (espeja events.addTacto). `id` de cliente.
 * `pregnancy_status` de un selector CERRADO. El efecto colateral de TRANSICIÓN de categoría de la madre
 * lo dispara el trigger AFTER INSERT al SUBIR la fila a PostgREST (no local) — el cliente re-fetchea la
 * ficha al volver. `notes` opcional.
 */
export function buildAddTactoInsert(
  id: string,
  profileId: string,
  pregnancyStatus: string,
  eventDate: string,
  notes: string | null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events ' +
      '(id, animal_profile_id, event_type, event_date, pregnancy_status, notes) ' +
      "VALUES (?, ?, 'tacto', ?, ?, ?)",
    args: [id, profileId, eventDate, pregnancyStatus, notes],
  };
}

/**
 * INSERT local de un evento reproductivo `service` (espeja events.addService). `id` de cliente.
 * `service_type` de un selector CERRADO. NO dispara transición. `notes` opcional.
 */
export function buildAddServiceInsert(
  id: string,
  profileId: string,
  serviceType: string,
  eventDate: string,
  notes: string | null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events ' +
      '(id, animal_profile_id, event_type, event_date, service_type, notes) ' +
      "VALUES (?, ?, 'service', ?, ?, ?)",
    args: [id, profileId, eventDate, serviceType, notes],
  };
}

/**
 * INSERT local de un evento reproductivo `abortion` (espeja events.addAbortion). `id` de cliente. Sin
 * pregnancy_status ni service_type. El efecto colateral de REVERSIÓN de preñez (categoría) lo dispara el
 * trigger al SUBIR. `notes` opcional.
 */
export function buildAddAbortionInsert(
  id: string,
  profileId: string,
  eventDate: string,
  notes: string | null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events (id, animal_profile_id, event_type, event_date, notes) ' +
      "VALUES (?, ?, 'abortion', ?, ?)",
    args: [id, profileId, eventDate, notes],
  };
}

/**
 * INSERT local de una observación libre en animal_events (espeja events.addObservation). `id` de
 * cliente. ⚠️ `establishment_id` SÍ se setea (EXCEPCIÓN, ver banner): animal_events tiene un trigger de
 * VALIDACIÓN (no force) que exige que coincida con el establishment del perfil → el caller lo deriva del
 * PERFIL (NO del contexto activo). `author_id`/`edit_window_until` los pone el trigger/default al subir.
 */
export function buildAddObservationInsert(
  id: string,
  profileId: string,
  establishmentId: string,
  text: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO animal_events (id, animal_profile_id, establishment_id, event_type, text) ' +
      "VALUES (?, ?, ?, 'observacion', ?)",
    args: [id, profileId, establishmentId, text],
  };
}

// ─── Lotes / management_groups (T5.2) ──────────────────────────────────────────────

/**
 * INSERT local de un management_group (espeja management-groups.createManagementGroup). `id` de cliente.
 * `establishment_id` + `name` (ya trimeado por el caller). `active`/`created_at` los pone el default al
 * subir; el `active = 1` local lo escribimos explícito para que la lectura local de lotes (que filtra
 * `active = 1`, buildManagementGroupsQuery) vea el lote recién creado al instante, offline. Owner-only
 * lo valida la RLS al SUBIR (management_groups_insert = is_owner_of), NO el INSERT local (R6.3/R8.1).
 */
export function buildCreateManagementGroupInsert(
  id: string,
  establishmentId: string,
  name: string,
): LocalQuery {
  return {
    sql: 'INSERT INTO management_groups (id, establishment_id, name, active) VALUES (?, ?, ?, 1)',
    args: [id, establishmentId, name],
  };
}

/**
 * UPDATE local del nombre de un lote (espeja management-groups.renameManagementGroup). Filtra
 * `deleted_at IS NULL` (no se renombra un lote ya borrado). Se ELIMINA el `count:'exact'` (R6.3): el
 * UPDATE local siempre "tiene éxito" offline; owner-only lo valida la RLS al SUBIR (un no-owner es
 * rechazado allí → superficiado por uploadData, no por el return).
 */
export function buildRenameManagementGroupUpdate(groupId: string, name: string): LocalQuery {
  return {
    sql: 'UPDATE management_groups SET name = ? WHERE id = ? AND deleted_at IS NULL',
    args: [name, groupId],
  };
}

/**
 * UPDATE local de management_group_id de un perfil (espeja management-groups.assignAnimalToGroup).
 * `groupId = null` QUITA el lote (vuelve a agruparse por categoría). Filtra `deleted_at IS NULL` (no se
 * asigna a un perfil borrado). Se ELIMINA el `count:'exact'` (R6.3). El tenant-check del lote (mismo
 * establishment del perfil, trigger 0037) lo valida server-side al SUBIR el UPDATE.
 */
export function buildAssignAnimalToGroupUpdate(
  profileId: string,
  groupId: string | null,
): LocalQuery {
  return {
    sql: 'UPDATE animal_profiles SET management_group_id = ? WHERE id = ? AND deleted_at IS NULL',
    args: [groupId, profileId],
  };
}

/**
 * UPDATE local que REASIGNA a NULL los management_group_id de TODOS los perfiles de un lote (paso 1 del
 * borrado de lote, anti-FK-colgante — espeja la 1ra mitad de softDeleteManagementGroup). CRUD plano sobre
 * la tabla SINCRONIZADA → su propia CrudEntry → uploadData lo sube como UPDATE antes del soft-delete (FIFO).
 * NO filtra por status (toda fila que apunte al lote debe quedar limpia, incl. archivados).
 */
export function buildClearGroupMembersUpdate(groupId: string): LocalQuery {
  return {
    sql: 'UPDATE animal_profiles SET management_group_id = NULL WHERE management_group_id = ?',
    args: [groupId],
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// OUTBOX + OVERLAY — escritura offline de las (b) RPC-bound (spec 15, T6 / R6.8–R6.12)
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Builders PUROS del camino outbox: el INSERT de la intención en `op_intents` (insertOnly → SÍ genera
// CrudEntry → uploadData la mapea a supabase.rpc) + los INSERT del efecto optimista en el overlay
// `pending_*` (localOnly → NO genera CrudEntry → no se sube). outbox.ts los ejecuta en UNA writeTransaction
// local. clearOverlay/rollbackOverlay borran el overlay por client_op_id (ACK / rechazo permanente).
//
// El `id` del op_intent = client_op_id (clave de idempotencia, R6.10). Cada fila del overlay lleva ese
// client_op_id (para limpiar/rollbackear el set de una op). Los ids "visuales" del overlay son de cliente:
// para create_animal son los MISMOS que el upsert reusará (idempotente por PK); para register_birth son
// PROVISIONALES (los reales los asigna la RPC; el overlay se limpia en el ACK y la fila real baja).

/** INSERT del op_intent (la intención). El `id` = client_op_id. `params_json` = JSON.stringify de los params de la RPC. */
export function buildOpIntentInsert(
  clientOpId: string,
  opType: string,
  paramsJson: string,
  createdAt: string,
): LocalQuery {
  return {
    sql: 'INSERT INTO op_intents (id, op_type, params_json, created_at) VALUES (?, ?, ?, ?)',
    args: [clientOpId, opType, paramsJson, createdAt],
  };
}

/** INSERT optimista en pending_animals (identidad global del animal/ternero). */
export function buildPendingAnimalInsert(
  id: string,
  clientOpId: string,
  fields: { tagElectronic: string | null; speciesId: string | null; sex: string | null; birthDate: string | null },
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_animals (id, client_op_id, tag_electronic, species_id, sex, birth_date) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, clientOpId, fields.tagElectronic, fields.speciesId, fields.sex, fields.birthDate],
  };
}

/** Campos del perfil optimista (espejan animal_profiles + la identidad denormalizada b1). */
export type PendingProfileFields = {
  animalId: string;
  establishmentId: string;
  rodeoId: string;
  managementGroupId: string | null;
  idv: string | null;
  visualIdAlt: string | null;
  categoryId: string;
  categoryOverride: boolean;
  breed: string | null;
  coatColor: string | null;
  entryDate: string | null;
  entryWeight: number | null;
  status: string;
  createdBy: string | null;
  animalTagElectronic: string | null;
  animalSex: string | null;
  animalBirthDate: string | null;
  createdAt: string;
};

/** INSERT optimista en pending_animal_profiles. `id` = profileId (cliente). El UNION de lectura lee de acá. */
export function buildPendingAnimalProfileInsert(
  id: string,
  clientOpId: string,
  f: PendingProfileFields,
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_animal_profiles (' +
      'id, client_op_id, animal_id, establishment_id, rodeo_id, management_group_id, idv, ' +
      'visual_id_alt, category_id, category_override, breed, coat_color, entry_date, entry_weight, ' +
      'status, created_by, animal_tag_electronic, animal_sex, animal_birth_date, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [
      id, clientOpId, f.animalId, f.establishmentId, f.rodeoId, f.managementGroupId, f.idv,
      f.visualIdAlt, f.categoryId, f.categoryOverride ? 1 : 0, f.breed, f.coatColor, f.entryDate,
      f.entryWeight, f.status, f.createdBy, f.animalTagElectronic, f.animalSex, f.animalBirthDate,
      f.createdAt,
    ],
  };
}

/** INSERT optimista en pending_reproductive_events (el evento de parto). `id` = client provisional. */
export function buildPendingReproductiveEventInsert(
  id: string,
  clientOpId: string,
  fields: { animalProfileId: string; eventType: string; eventDate: string; notes: string | null; createdAt: string },
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_reproductive_events ' +
      '(id, client_op_id, animal_profile_id, event_type, event_date, notes, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, clientOpId, fields.animalProfileId, fields.eventType, fields.eventDate, fields.notes, fields.createdAt],
  };
}

/** INSERT optimista en pending_birth_calves (puente parto→ternero). `id` = client provisional. */
export function buildPendingBirthCalfInsert(
  id: string,
  clientOpId: string,
  birthEventId: string,
  calfProfileId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_birth_calves (id, client_op_id, birth_event_id, calf_profile_id) ' +
      'VALUES (?, ?, ?, ?)',
    args: [id, clientOpId, birthEventId, calfProfileId],
  };
}

/** INSERT optimista en pending_rodeos (el rodeo ALTA-optimista, Run T9.8). `id` = id de CLIENTE del rodeo
 *  (el mismo que la RPC create_rodeo reusará por ON CONFLICT → idempotente por PK). `active = 1` para que
 *  buildRodeosQuery (que filtra active = 1) lo muestre al instante offline. created_at = now() de cliente. */
export function buildPendingRodeoInsert(
  id: string,
  clientOpId: string,
  fields: {
    establishmentId: string;
    name: string;
    speciesId: string;
    systemId: string;
    createdAt: string;
  },
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_rodeos ' +
      '(id, client_op_id, establishment_id, name, species_id, system_id, active, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    args: [
      id, clientOpId, fields.establishmentId, fields.name, fields.speciesId, fields.systemId,
      fields.createdAt,
    ],
  };
}

/** INSERT optimista de UNA fila de la plantilla del rodeo en pending_rodeo_data_config (Run T9.8). `id` =
 *  uuid sintético de cliente (la fila no se referencia por id — solo por rodeo_id + field_definition_id).
 *  buildRodeoConfigQuery la UNIONa para mostrar la plantilla offline. `enabled` → 1/0. */
export function buildPendingRodeoConfigInsert(
  id: string,
  clientOpId: string,
  rodeoId: string,
  fieldDefinitionId: string,
  enabled: boolean,
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_rodeo_data_config ' +
      '(id, client_op_id, rodeo_id, field_definition_id, enabled) VALUES (?, ?, ?, ?, ?)',
    args: [id, clientOpId, rodeoId, fieldDefinitionId, enabled ? 1 : 0],
  };
}

/**
 * DELETE-PRIOR del overlay de plantilla por (rodeo_id, field_definition_id), de CUALQUIER client_op_id
 * (fix rowid (Run T9.9 follow-up, 2026-06-09)). Lo corre `enqueueSetRodeoConfig` ANTES de insertar el overlay de un field, para mantener
 * el INVARIANTE de ≤1 fila por (rodeo_id, field_definition_id) que `buildRodeoConfigQuery` necesita (su UNION
 * ALL del overlay ya no dedupa por rowid — `rowid` no existe sobre las views de PowerSync). Sin esto, una
 * doble-edición offline del MISMO field antes de syncear dejaría 2 filas → field DUPLICADO en la plantilla.
 */
export function buildDeletePendingRodeoConfig(
  rodeoId: string,
  fieldDefinitionId: string,
): LocalQuery {
  return {
    sql: 'DELETE FROM pending_rodeo_data_config WHERE rodeo_id = ? AND field_definition_id = ?',
    args: [rodeoId, fieldDefinitionId],
  };
}

/** Efecto de un override de estado: oculta/marca una fila objetivo (baja o soft-delete optimista). */
export type StatusOverrideEffect = 'exited' | 'soft_deleted';

/**
 * INSERT optimista en pending_status_overrides (baja/soft-delete: oculta/marca la fila objetivo).
 * `exitDate` (residual #2): fecha de egreso de cliente para una baja (effect 'exited') — la ficha la
 * surfacea (COALESCE) → el badge "Vendido el {fecha}" funciona OFFLINE. null para soft_deleted.
 */
export function buildPendingStatusOverrideInsert(
  id: string,
  clientOpId: string,
  targetTable: string,
  targetId: string,
  effect: StatusOverrideEffect,
  status: string | null,
  exitDate: string | null = null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO pending_status_overrides ' +
      '(id, client_op_id, target_table, target_id, effect, status, exit_date) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, clientOpId, targetTable, targetId, effect, status, exitDate],
  };
}

/** Las 7 tablas overlay (para limpiar/rollbackear todas por client_op_id en una sola pasada). */
export const PENDING_OVERLAY_TABLES = [
  'pending_animals',
  'pending_animal_profiles',
  'pending_reproductive_events',
  'pending_birth_calves',
  'pending_status_overrides',
  // Run T9.8 — overlay del alta de rodeo OFFLINE.
  'pending_rodeos',
  'pending_rodeo_data_config',
] as const;

/** DELETE de TODO el overlay de un client_op_id en una tabla pending_* (clear en ACK / rollback en rechazo). */
export function buildClearOverlayDelete(table: string, clientOpId: string): LocalQuery {
  return {
    sql: `DELETE FROM ${table} WHERE client_op_id = ?`,
    args: [clientOpId],
  };
}
