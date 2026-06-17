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
 * category_id + NAME por (system_id, code) ACTIVO. Igual que `buildCategoryIdByCodeQuery` pero proyecta
 * también el `name` legible del catálogo. Lo usa la resolución compartida del revert de override (C6 /
 * RC6.4.3 + RC6.4.6): el id para el UPDATE local, el name para anticipar la CONSECUENCIA en la
 * confirmación inline ("La categoría pasará a …"). SELECT puro (display-only en el preview). LIMIT 1.
 */
export function buildCategoryByCodeQuery(systemId: string, code: string): LocalQuery {
  return {
    sql: 'SELECT id, name FROM categories_by_system WHERE system_id = ? AND code = ? AND active = 1 LIMIT 1',
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
 * system_id de un rodeo (spec 03 M1.1): lo necesita el gating capa 1 para leer los defaults/required del
 * sistema (system_default_fields) y derivar el `required` de cada data_key (R5.6). El rodeo ya está
 * sincronizado (est_rodeos). LIMIT 1 = maybeSingle.
 */
export function buildRodeoSystemQuery(rodeoId: string): LocalQuery {
  return {
    sql: 'SELECT system_id FROM rodeos WHERE id = ? LIMIT 1',
    args: [rodeoId],
  };
}

/**
 * rodeo_id del PERFIL ACTIVO de un animal (spec 03 M1.1 / R5.3 / SEC-SPEC-03-02): el gating capa 1
 * resuelve el rodeo REAL del animal leyendo `animal_profiles.rodeo_id` del perfil ACTIVO (deleted_at IS
 * NULL), NO vía una función `current_animal_rodeo` (NO existe as-built). Mismo criterio que la capa 2
 * (assert_data_keys_enabled, 0054). LIMIT 1 (PK). Un perfil soft-deleted/inexistente → null (el caller
 * NO debe ofrecer maniobras gateadas: fail-safe del lado UI, paralelo al fail-closed de la DB).
 */
export function buildActiveProfileRodeoQuery(profileId: string): LocalQuery {
  return {
    sql: 'SELECT rodeo_id FROM animal_profiles WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    args: [profileId],
  };
}

/**
 * establishment_id de UN perfil (spec 10, T-CL.11): lo necesita la observación automática de castración
 * (R13.7) — animal_events.establishment_id tiene un trigger de VALIDACIÓN (no force) que exige que coincida
 * con el del PERFIL (23514 si no) → se deriva de ACÁ (el perfil), NUNCA del contexto activo (un usuario con
 * rol en varios campos podría tener activo el campo B mientras castra un animal del campo A). LIMIT 1 (PK).
 * No filtra status/deleted_at: la observación de una corrección puede caer sobre un perfil archivado.
 */
export function buildProfileEstablishmentQuery(profileId: string): LocalQuery {
  return {
    sql: 'SELECT establishment_id FROM animal_profiles WHERE id = ? LIMIT 1',
    args: [profileId],
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
//
// C6 (RC6.3.1/RC6.3.2): se agregan `category_override`, `animal_birth_date` y `r.system_id` — inputs del
// espejo de categoría (`applyCategoryMirror` en animals.ts). El shape PÚBLICO (AnimalListItem) NO cambia:
// estas columnas extra las consume solo el mirror del service; el mapper toLocalListItem las descarta.
// spec 10 (T-CL.12 / R13.6): se agrega `is_castrated` denormalizado (0084) — el espejo C6 lo consume como
// el is_castrated REAL (precedencia sobre la inferencia RC6.2.1). El shape PÚBLICO (AnimalListItem) lo
// descarta; lo lee SOLO computeMirrorOverrides. spec 10 (T-UI.1/T-UI.3 / R11.9, R12.3): se agregan
// `animal_birth_date` (edad de la fila compacta) y `future_bull` (badge ⭐ en la lista de la vista de
// grupo) al shape público AnimalListItem — antes `future_bull` solo lo traía fetchAnimalDetail. La fila
// compacta de la vista de grupo (AnimalRow `compact`) los necesita por animal.
const LOCAL_LIST_SELECT =
  'SELECT ap.id AS id, ap.animal_id AS animal_id, ap.idv AS idv, ' +
  'ap.visual_id_alt AS visual_id_alt, ap.category_id AS category_id, ap.rodeo_id AS rodeo_id, ' +
  'ap.status AS status, ap.management_group_id AS management_group_id, ' +
  'ap.animal_tag_electronic AS tag_electronic, ap.animal_sex AS sex, ' +
  'ap.category_override AS category_override, ap.animal_birth_date AS birth_date, ' +
  'ap.is_castrated AS is_castrated, ap.future_bull AS future_bull, ' +
  'r.system_id AS system_id, ' +
  'r.name AS rodeo_name, c.code AS category_code, c.name AS category_name, ' +
  'ap.created_at AS created_at ' +
  'FROM animal_profiles ap ' +
  'JOIN rodeos r ON r.id = ap.rodeo_id ' +
  'JOIN categories_by_system c ON c.id = ap.category_id';

// Mismo SELECT (mismo shape de columnas) PERO desde el overlay `pending_animal_profiles` (alias `pap`).
// La identidad/atributos salen denormalizados del overlay; rodeo/categoría se JOINean a las tablas
// SINCRONIZADAS (para createAnimal/ternero el rodeo y la categoría son filas reales ya sincronizadas).
// Mismas columnas C6 (`category_override`/`birth_date`/`system_id`) — ambas ramas del UNION proyectan
// idéntico set (requisito del UNION ALL).
const LOCAL_LIST_SELECT_OVERLAY =
  'SELECT pap.id AS id, pap.animal_id AS animal_id, pap.idv AS idv, ' +
  'pap.visual_id_alt AS visual_id_alt, pap.category_id AS category_id, pap.rodeo_id AS rodeo_id, ' +
  'pap.status AS status, pap.management_group_id AS management_group_id, ' +
  'pap.animal_tag_electronic AS tag_electronic, pap.animal_sex AS sex, ' +
  'pap.category_override AS category_override, pap.animal_birth_date AS birth_date, ' +
  // spec 10 (T-CL.12): is_castrated del overlay = SIEMPRE 0 (un alta/ternero optimista nace ENTERO;
  // la castración es un UPDATE de la fila SINCRONIZADA — nunca toca el overlay). future_bull = SIEMPRE 0
  // (el flag se marca desde la ficha de un animal ya sincronizado, R12.2 — nunca en el alta). Constantes
  // para alinear las columnas del UNION (requisito del UNION ALL: ambas ramas, idéntico set/orden).
  '0 AS is_castrated, 0 AS future_bull, ' +
  'r.system_id AS system_id, ' +
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
 * Inyecta una columna EXTRA en la lista de proyección de un `SELECT ... FROM ...`, justo antes del primer
 * ` FROM ` (la columna se agrega al final de la lista de columnas, no como tabla del FROM). Lo usa la
 * opción A para agregar el alias `updated_at` a `LOCAL_LIST_SELECT`/`_OVERLAY` (que YA incluyen FROM/JOINs)
 * sin reescribir el SELECT entero. `expr` es una expresión CONTROLADA por el código (nunca input de
 * usuario) → sin riesgo de injection.
 */
function injectProjection(select: string, expr: string): string {
  const idx = select.indexOf(' FROM ');
  if (idx === -1) return select; // defensivo: un SELECT sin FROM no debería pasar acá
  return `${select.slice(0, idx)}, ${expr}${select.slice(idx)}`;
}

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
  filter: {
    rodeoId?: string | null;
    status?: string | null;
    noTag?: boolean;
    /**
     * Columna de ORDEN del listado (DESC). Default `'created_at'` (orden de la tab Animales). Opción A
     * del chunk dedup (RD3.3 / design §3.4): los candidatos `noTag` de la intermedia se ordenan por
     * `updated_at DESC` (RECIÉN tocados primero — un animal que el operario está cargando/editando en la
     * manga es el más probable de caravanear ahora). La rama SINCRONIZADA proyecta `ap.updated_at`; la
     * rama OVERLAY (pending_animal_profiles — un alta optimista sin caravana) NO tiene columna
     * `updated_at`, así que usa su `created_at` como señal de frescura (una fila optimista recién creada
     * ES lo más nuevo localmente) — column-aligned con el UNION. Sin esta opción, el orden es idéntico al
     * histórico (cero regresión para los callers existentes).
     */
    orderBy?: 'created_at' | 'updated_at';
  } = {},
): LocalQuery {
  const status = filter.status ?? 'active';
  const orderBy = filter.orderBy ?? 'created_at';
  // Cuando ordenamos por updated_at, AMBAS ramas deben PROYECTAR el alias `updated_at` (el ORDER BY de un
  // UNION solo referencia columnas proyectadas). La synced usa ap.updated_at REAL; la overlay no tiene esa
  // columna → proyecta pap.created_at AS updated_at (señal de frescura del alta optimista). Para el orden
  // por created_at (default) NO se proyecta nada extra (cero cambio sobre los callers históricos).
  // El alias va INYECTADO en la lista de proyección (antes del ` FROM`), NO concatenado al final del SELECT
  // (que ya incluye FROM/JOINs — concatenar ahí lo tomaría como una tabla del FROM).
  const syncedSelect =
    orderBy === 'updated_at'
      ? injectProjection(LOCAL_LIST_SELECT, 'ap.updated_at AS updated_at')
      : LOCAL_LIST_SELECT;
  const overlaySelect =
    orderBy === 'updated_at'
      ? injectProjection(LOCAL_LIST_SELECT_OVERLAY, 'pap.created_at AS updated_at')
      : LOCAL_LIST_SELECT_OVERLAY;
  // Parte SINCRONIZADA (con ocultación de exits/soft-deletes pendientes).
  const dom = listDomainFilters(establishmentId, status);
  let synced = `${syncedSelect} WHERE ${dom.where} AND ${HIDE_EXITED_PROFILE}`;
  const args: unknown[] = [...dom.args];
  // Parte OVERLAY (altas/terneros optimistas; ocultos si ya tienen un override — defensivo).
  const domO = listDomainFiltersOverlay(establishmentId, status);
  let overlay =
    `${overlaySelect} WHERE ${domO.where} AND ` +
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
  // El ORDER BY usa el alias proyectado por ambas ramas (created_at por default; updated_at en opción A).
  const sql = `${synced} UNION ALL ${overlay} ORDER BY ${orderBy} DESC LIMIT 200`;
  return { sql, args: [...args, ...overlayArgs] };
}

/**
 * Conteo de candidatos `noTag` activos del campo activo (opción A del chunk dedup, RD8.2 / design §3.2).
 * Lo usa el host BLE (`FindOrCreateOverlay`) para decidir, tras un lookup `mode:'create'`, si abre la
 * intermedia `assign_or_create` (≥1 candidato) o va directo a CREATE (0 candidatos) — una lectura LOCAL
 * más, sin red. Suma synced (oculta exits/soft-deletes pendientes) + overlay (altas optimistas sin
 * caravana), exactamente el mismo universo que `buildAnimalsListQuery(est, { noTag:true })` recorrería —
 * pero como COUNT(*) (siempre 1 fila → NO degrada a "sincronizando"). Mismo criterio `noTag` que la lista:
 * `animal_tag_electronic IS NULL` + status='active' + deleted_at IS NULL + establishment activo.
 *
 * Multi-tenant (CLAUDE.md ppio 6): el establishment_id llega por param (del contexto activo), nunca hardcode.
 */
export function buildNoTagCandidatesCountQuery(establishmentId: string): LocalQuery {
  const sql =
    'SELECT (' +
    'SELECT COUNT(*) FROM animal_profiles ap ' +
    "WHERE ap.establishment_id = ? AND ap.status = 'active' AND ap.deleted_at IS NULL " +
    'AND ap.animal_tag_electronic IS NULL AND ' +
    HIDE_EXITED_PROFILE +
    ') + (' +
    'SELECT COUNT(*) FROM pending_animal_profiles pap ' +
    "WHERE pap.establishment_id = ? AND pap.status = 'active' " +
    'AND pap.animal_tag_electronic IS NULL AND ' +
    notHiddenByOverride('animal_profiles', 'pap.id', ['exited', 'soft_deleted']) +
    ') AS count';
  return { sql, args: [establishmentId, establishmentId] };
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

/**
 * Conteo de animales ACTIVOS POR RODEO del campo (spec 10 T-UI.2, Inicio rodeo-céntrico): una fila
 * `(rodeo_id, count)` por rodeo con ≥1 animal activo. UNION de synced + overlay (altas/terneros
 * optimistas) agrupado por rodeo_id; los exits/soft-deletes pendientes se OCULTAN (mismo criterio que la
 * lista). El caller mapea por rodeo_id (los rodeos sin animales no aparecen → cuentan 0). Scoping de
 * tenant: ya lo aplicó la stream; conservamos status='active' + deleted_at + establishment_id propio.
 */
export function buildRodeoHeadCountsQuery(establishmentId: string): LocalQuery {
  const sql =
    'SELECT rodeo_id, COUNT(*) AS count FROM (' +
    'SELECT ap.rodeo_id AS rodeo_id FROM animal_profiles ap ' +
    "WHERE ap.establishment_id = ? AND ap.status = 'active' AND ap.deleted_at IS NULL AND " +
    HIDE_EXITED_PROFILE +
    ' UNION ALL ' +
    'SELECT pap.rodeo_id AS rodeo_id FROM pending_animal_profiles pap ' +
    "WHERE pap.establishment_id = ? AND pap.status = 'active' AND " +
    notHiddenByOverride('animal_profiles', 'pap.id', ['exited', 'soft_deleted']) +
    ') GROUP BY rodeo_id';
  return { sql, args: [establishmentId, establishmentId] };
}

/**
 * Conteo de animales ACTIVOS POR LOTE (management_group) del campo (spec 10 T-UI.2): una fila
 * `(management_group_id, count)` por lote con ≥1 animal activo asignado. Solo cuenta perfiles con
 * `management_group_id` no NULL (los sin lote se agrupan por categoría, no son un grupo). Mismo UNION +
 * ocultación de exits que el conteo por rodeo. El caller mapea por management_group_id.
 */
export function buildGroupHeadCountsQuery(establishmentId: string): LocalQuery {
  const sql =
    'SELECT management_group_id, COUNT(*) AS count FROM (' +
    'SELECT ap.management_group_id AS management_group_id FROM animal_profiles ap ' +
    "WHERE ap.establishment_id = ? AND ap.status = 'active' AND ap.deleted_at IS NULL " +
    'AND ap.management_group_id IS NOT NULL AND ' +
    HIDE_EXITED_PROFILE +
    ' UNION ALL ' +
    'SELECT pap.management_group_id AS management_group_id FROM pending_animal_profiles pap ' +
    "WHERE pap.establishment_id = ? AND pap.status = 'active' " +
    'AND pap.management_group_id IS NOT NULL AND ' +
    notHiddenByOverride('animal_profiles', 'pap.id', ['exited', 'soft_deleted']) +
    ') GROUP BY management_group_id';
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
 * Lookup EXACTO por TAG electrónico CROSS-CAMPO (spec 09 chunk BLE global, RB4.6 / design §3.3): matchea
 * `animal_profiles.animal_tag_electronic = ?` con `status='active'` + `deleted_at IS NULL` **SIN** filtrar
 * por establishment_id — es justo lo que la distingue de `buildSearchByTagQuery` (que sí scopea al campo
 * activo vía listDomainFilters). Sirve a `lookupByTag` para detectar que un EID bastoneado pertenece a un
 * animal vivo en OTRO campo del usuario (→ modo 'transfer', spec 11) cuando NO matcheó en el campo activo.
 *
 * Proyecta `profile_id` + `establishment_id` + el `name` legible del establishment (JOIN local a
 * `establishments`, que está sincronizado con su name — buildMembershipsQuery/buildEstablishmentDetailQuery
 * ya lo usan). LIMIT 2: con 1 fila distinguimos "solo en otro campo" del caso (raro) de >1 perfil activo con
 * el mismo TAG; el caller (resolveTagLookup) ignora una fila que sea del campo activo (defensivo — esa ya la
 * habría tomado buildSearchByTagQuery).
 *
 * NO consulta el overlay `pending_*` (design §3.3): un transfer aplica sobre filas REALES sincronizadas; un
 * alta optimista del campo activo ya la cubre la rama 1 (buildSearchByTagQuery, que sí UNIONa overlay).
 *
 * Multi-tenancy (RB9.2): NO debilita la RLS — solo NO re-aplica el filtro de campo activo que las queries
 * operativas sí aplican. El set local ya está scopeado por la stream (has_role_in, solo campos del usuario);
 * la RLS de spec 02/11 es la barrera final del server. NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6).
 */
export function buildLookupTagAcrossFieldsQuery(tag: string): LocalQuery {
  return {
    sql:
      'SELECT ap.id AS profile_id, ap.establishment_id AS establishment_id, ' +
      'e.name AS establishment_name ' +
      'FROM animal_profiles ap ' +
      'JOIN establishments e ON e.id = ap.establishment_id ' +
      "WHERE ap.animal_tag_electronic = ? AND ap.status = 'active' AND ap.deleted_at IS NULL " +
      'LIMIT 2',
    args: [tag],
  };
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
    // spec 10 (T-CL.12 / R13.6): is_castrated REAL (0084) → el espejo C6 lo usa con precedencia sobre la
    // inferencia. future_bull (0085) → la ficha lo muestra como badge ⭐ (R12.3, Fase 4) + el toggle.
    'ap.is_castrated AS is_castrated, ap.future_bull AS future_bull, ' +
    // C6 (RC6.3.1): system_id del rodeo → el espejo resuelve code→name/id del catálogo local del sistema.
    'r.system_id AS system_id, ' +
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
    // spec 10 (T-CL.12): is_castrated=0 / future_bull=0 del overlay (alta/ternero optimista nace entero,
    // sin ⭐); constantes para alinear las columnas del UNION (requisito del UNION ALL).
    '0 AS is_castrated, 0 AS future_bull, ' +
    // C6 (RC6.3.1): system_id del rodeo (misma proyección que la rama synced, requisito del UNION).
    'r.system_id AS system_id, ' +
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

// ─── Espejo de categoría (C6 / RC6.3.6): eventos reproductivos crudos por perfil ─────────────
//
// Builder BATCHED de los eventos reproductivos que alimentan el espejo client-side de compute_category
// (`computeCategoryCode`, animal-category.ts). Sirve para la ficha (1 id) y para la lista (≤200 ids).
// Trae las filas CRUDAS (event_type/event_date/created_at/pregnancy_status) — la decisión de categoría
// vive 100% en TS (design §2/§8: una sola implementación espejo, sin replicar EXISTS/COUNT en SQL local).
//
// Dos orígenes UNION ALL (igual que el timeline):
//   - `reproductive_events` SINCRONIZADO: tactos/servicios/destetes/abortos cargados offline por CRUD plano
//     + los partos ya sincronizados. Filtro `deleted_at IS NULL` (el espejo cuenta solo no-borrados) +
//     `event_type IN (...)` (espeja el gate del trigger 0063 — no acarrear eventos irrelevantes).
//   - `pending_reproductive_events` OVERLAY: los partos OPTIMISTAS de register_birth offline (aún no
//     subidos). El overlay NO tiene pregnancy_status ni deleted_at (solo porta partos `birth`) → proyecta
//     NULL en pregnancy_status; el `event_type IN (...)` igual lo acota (será 'birth').
//
// ORDER BY event_date ASC, created_at ASC: el orden que el tacto+ vigente (RT2.7.5) usa para el desempate
// por la tupla (event_date, created_at). El espejo TS recibe las filas en ese orden — el tie-break de
// `created_at NULL` (fila local recién insertada) lo resuelve el espejo, no el SQL (RC6.1.4).
//
// El scoping de tenant ya lo aplicó la stream est_reproductive_events al sincronizar → NO se re-filtra.

const MIRROR_EVENT_TYPES = "('birth','weaning','service','tacto','abortion')";

/**
 * Eventos reproductivos crudos (synced + overlay) de un conjunto de perfiles, para el espejo de
 * categoría (RC6.3.6/RC6.3.1). `profileIds` ≥ 1 (el caller no llama con lista vacía). Devuelve filas
 * `{ animal_profile_id, event_type, event_date, created_at, pregnancy_status }`.
 */
export function buildCategoryMirrorEventsQuery(profileIds: readonly string[]): LocalQuery {
  const placeholders = profileIds.map(() => '?').join(', ');
  const sql =
    'SELECT animal_profile_id, event_type, event_date, created_at, pregnancy_status ' +
    'FROM reproductive_events ' +
    `WHERE animal_profile_id IN (${placeholders}) AND deleted_at IS NULL ` +
    `AND event_type IN ${MIRROR_EVENT_TYPES} ` +
    'UNION ALL ' +
    'SELECT animal_profile_id, event_type, event_date, created_at, NULL AS pregnancy_status ' +
    'FROM pending_reproductive_events ' +
    `WHERE animal_profile_id IN (${placeholders}) AND event_type IN ${MIRROR_EVENT_TYPES} ` +
    'ORDER BY event_date ASC, created_at ASC';
  return { sql, args: [...profileIds, ...profileIds] };
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
// (que espera `payload: Record`). El ORDEN VISUAL lo hace el cliente (parseTimeline) — el ORDER BY de acá
// NO es el orden de pantalla.
//
// ORDER BY event_date ASC, (created_at IS NULL) ASC, created_at ASC (TAREA 2, fix flake del estado repro):
// el índice de la fila en este set es la fuente del `seq` que fetchTimeline asigna a cada TimelineItem
// (proxy FIEL del ORDEN DE INSERCIÓN local). Dentro de un mismo event_date: primero los created_at PRESENTES
// en orden ascendente, y LOS NULL AL FINAL (`created_at IS NULL ASC` → 0=no-null antes que 1=null). Un
// created_at NULL = fila CRUD-plano recién insertada local que el trigger aún no selló = la MÁS RECIENTE
// (semántica null-as-newest del isAfter de buildCategoryMirrorEventsQuery/RC6.1.4, acá codificada en el
// propio ORDER BY) → queda con índice MAYOR ⇒ posterior. Entre dos NULL (ambos sin sellar, p.ej. tacto +
// aborto offline el mismo día) SQLite entrega su orden de almacenamiento estable (proxy del orden de
// inserción) → el INSERTADO DESPUÉS queda con índice MAYOR. Todo esto reproduce lo que el server sellará
// (created_at = now() en orden de subida = orden de inserción local). Antes era `event_date DESC` (cosmético)
// y el desempate del estado repro caía al eventId UUID random ⇒ ~50/50 (el bug). El orden de PANTALLA no
// cambia (parseTimeline re-ordena por su cuenta).
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
  const union =
    "SELECT 'weight' AS event_kind, id AS event_id, weight_date AS event_date, created_at AS created_at, " +
    "json_object('weight_kg', weight_kg, 'source', source, 'notes', notes) AS payload " +
    'FROM weight_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'reproductive', id, event_date, created_at, " +
    // spec 10 T-UI.8 / R4.5: `created_by` se proyecta para gatear (best-effort) el borrado del evento desde
    // la ficha (owner|autor). La barrera REAL es la RLS UPDATE server-side (is_owner_of OR created_by=uid).
    "json_object('event_type', event_type, 'pregnancy_status', pregnancy_status, 'calf_id', calf_id, 'notes', notes, 'created_by', created_by) " +
    'FROM reproductive_events WHERE animal_profile_id = ? AND deleted_at IS NULL ' +
    'UNION ALL ' +
    "SELECT 'sanitary', id, event_date, created_at, " +
    "json_object('event_type', event_type, 'product_name', product_name, 'route', route, 'notes', notes, 'created_by', created_by) " +
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
    'FROM pending_reproductive_events WHERE animal_profile_id = ?';
  // El ORDER BY va en un SELECT EXTERNO que envuelve el UNION: en un compound (UNION) SQLite NO acepta
  // EXPRESIONES en el ORDER BY (solo columnas del result set / posiciones) → `(created_at IS NULL)` daría
  // "2nd ORDER BY term does not match any column". En el SELECT externo, `created_at` ES una columna del
  // subquery → la expresión es válida. `created_at IS NULL ASC` empuja los NULL AL FINAL (recién insertado
  // = más reciente); `created_at ASC` ordena los presentes. (Ver nota TAREA 2 arriba.)
  const sql =
    `SELECT event_kind, event_id, event_date, created_at, payload FROM (${union}) ` +
    'ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC';
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

/** Tablas de evento TIPADO sobre las que la ficha permite corrección (soft-delete) desde el timeline. */
export type DeletableEventTable = 'sanitary_events' | 'reproductive_events';

/** Mapa kind del timeline → tabla de evento tipado borrable (spec 10 T-UI.8). null = no borrable desde la ficha. */
export const DELETABLE_EVENT_TABLE: Readonly<Record<string, DeletableEventTable>> = {
  sanitary: 'sanitary_events',
  reproductive: 'reproductive_events',
};

/**
 * SOFT-DELETE local de un evento TIPADO (spec 10 T-UI.8 / R4.5 — corrección individual desde la ficha,
 * reuso de spec 02 R6.8.1). UPDATE `deleted_at = now()` sobre la fila del evento → una CrudEntry → uploadData
 * lo sube al reconectar; la RLS UPDATE (`is_owner_of(...) OR created_by = auth.uid()`, 0026/0027) es la
 * BARRERA REAL (owner|autor; un rechazo lo superficia uploadData). El guard `deleted_at IS NULL` lo hace
 * idempotente (re-borrar = no-op). Sobre `reproductive_events`, el trigger 0046 (AFTER UPDATE OF deleted_at)
 * RECALCULA la categoría si el evento había disparado transición (p. ej. un `weaning` borrado revierte el
 * destete); `sanitary_events 'vaccination'` no transiciona → su borrado no recalcula. Offline-safe.
 *
 * `now()` lo resuelve SQLite (`datetime('now')`); el formato exacto del timestamp local no importa: la
 * lectura del timeline filtra por `deleted_at IS NULL` (cualquier no-NULL lo oculta) y al subir el server
 * persiste el UPDATE tal cual (el cliente puede escribir `deleted_at`, no es columna forzada por trigger).
 */
export function buildSoftDeleteEventUpdate(table: DeletableEventTable, eventId: string): LocalQuery {
  return {
    sql: `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
    args: [eventId],
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
 *
 * `sessionId` (spec 03 M2.2, R5.11) — opcional: vincula el evento a la JORNADA de manga (`session_id`).
 * Default null (la ficha de spec 02 NO pasa session_id → evento "suelto", igual que hoy). El tenant-check
 * server-side (`tg_event_session_tenant_check`, 0056) valida al SUBIR que la sesión sea del mismo
 * establishment que el animal; un session_id ajeno es rechazado allí (NO local).
 */
export function buildAddWeightInsert(
  id: string,
  profileId: string,
  weightKg: number,
  weightDate: string,
  notes: string | null,
  sessionId: string | null = null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO weight_events (id, animal_profile_id, weight_kg, weight_date, notes, session_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, profileId, weightKg, weightDate, notes, sessionId],
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

// ⚠️ created_at de CLIENTE en los INSERT de reproductive_events (TAREA 2, fix flake del estado repro).
// A diferencia del resto de las tablas de evento, los reproductivos CRUD-plano SÍ setean `created_at` con
// el wall-clock del cliente al insertar. Motivo: el ESTADO REPRODUCTIVO vigente (deriveCurrentState) y el
// tacto+ vigente (compute_category) desempatan los eventos del MISMO `event_date` (columna `date`, sin
// hora) por `created_at` — y un tacto + un parto/aborto el mismo día son indistinguibles sin él. El parto
// llega por el OVERLAY (pending_reproductive_events) con un created_at de cliente; si el tacto (CRUD-plano)
// quedara con created_at NULL hasta sincronizar, el desempate se rompía (~50/50 por el eventId UUID random;
// el flake del backlog). Con created_at de cliente AMBOS tienen un instante real de creación → orden total
// determinístico (el insertado después gana). Server-side `created_at` es `default now()` SIN trigger de
// force (0026) → el valor del cliente PERSISTE al subir: es semánticamente correcto (instante de CREACIÓN
// en el dispositivo, no de subida) y fiel al orden de creación, mejor que el now() de subida para un evento
// cargado offline. `created_by`/`establishment_id` los SIGUE forzando el trigger (no se tocan). El caller
// pasa `new Date().toISOString()`.

/**
 * INSERT local de un evento reproductivo `tacto` (espeja events.addTacto). `id` + `createdAt` de cliente
 * (ver nota del banner). `pregnancy_status` de un selector CERRADO. El efecto colateral de TRANSICIÓN de
 * categoría de la madre lo dispara el trigger AFTER INSERT al SUBIR la fila a PostgREST (no local). `notes`
 * opcional. `sessionId` (spec 03 M2.2, R5.11) opcional: vincula el tacto a la jornada de manga; default
 * null (la ficha de spec 02 no lo pasa). El tenant-check (0056) lo valida al subir.
 */
export function buildAddTactoInsert(
  id: string,
  profileId: string,
  pregnancyStatus: string,
  eventDate: string,
  notes: string | null,
  createdAt: string,
  sessionId: string | null = null,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events ' +
      '(id, animal_profile_id, event_type, event_date, pregnancy_status, notes, created_at, session_id) ' +
      "VALUES (?, ?, 'tacto', ?, ?, ?, ?, ?)",
    args: [id, profileId, eventDate, pregnancyStatus, notes, createdAt, sessionId],
  };
}

// ─── UPDATE de evento de maniobra (spec 03 M2.2) — corrección desde el resumen (R5.9) ──────────────────
//
// En la manga, el id de cliente del evento es ESTABLE por (animal, maniobra). La 1ra captura usa INSERT
// (buildAddWeightInsert/buildAddTactoInsert con session_id); CORREGIR desde el resumen (R5.9) re-captura con
// el MISMO id → un 2do INSERT fallaría (PK duplicada) y un upsert `ON CONFLICT` NO lo captura bien PowerSync
// (el evento no sube). Por eso la corrección hace un UPDATE explícito de la(s) columna(s) de dato. PowerSync
// rastrea el UPDATE como un PATCH → el connector hace `table.update(...).eq('id', ...)` al subir → el server
// queda con el valor corregido, sin duplicar. `created_at`/`session_id`/`animal_profile_id` NO se tocan en
// la corrección (la jornada, el instante de creación y el animal no cambian). Filtra `deleted_at IS NULL`
// (defensivo). NO afecta a la ficha (events.ts): cada peso de la ficha es un evento con id nuevo → INSERT.

/** UPDATE del peso de un weight_event de manga ya cargado (R5.9 corrección). Solo weight_kg/date. */
export function buildUpdateManeuverWeight(
  id: string,
  weightKg: number,
  weightDate: string,
): LocalQuery {
  return {
    sql: 'UPDATE weight_events SET weight_kg = ?, weight_date = ? WHERE id = ? AND deleted_at IS NULL',
    args: [weightKg, weightDate, id],
  };
}

/** UPDATE del resultado de un tacto de manga ya cargado (R5.9 corrección). Solo pregnancy_status/date. */
export function buildUpdateManeuverTacto(
  id: string,
  pregnancyStatus: string,
  eventDate: string,
): LocalQuery {
  return {
    sql:
      'UPDATE reproductive_events SET pregnancy_status = ?, event_date = ? ' +
      "WHERE id = ? AND event_type = 'tacto' AND deleted_at IS NULL",
    args: [pregnancyStatus, eventDate, id],
  };
}

// ─── Write-paths de las maniobras restantes (spec 03 M3.1) — INSERT + UPDATE de corrección ─────────────
//
// Mismo contrato que los de M2.2 (arriba): INSERT LOCAL sobre la tabla SINCRONIZADA con `session_id`
// (R5.11); `created_by`/`establishment_id` los FUERZA el trigger server-side al subir (R5.12, NO se mandan);
// el gating capa 2 (0054 + 0091) y el tenant-check (0056) re-validan al SUBIR (fail-closed). La CORRECCIÓN
// desde el resumen (R5.9) re-captura con el MISMO id → UPDATE explícito de la(s) columna(s) de dato (no un
// 2do INSERT ni un upsert `ON CONFLICT` — PowerSync no captura bien el upsert). `id` de cliente lo pasa el
// caller (determinístico/testeable). Filtran `deleted_at IS NULL` (defensivo) en los UPDATE.

/**
 * INSERT local de un sanitary_event silent_apply de UN producto para la manga (R6.13 antiparasitario →
 * `deworming` / R6.15 antibiótico → `treatment`). `eventType` lo pasa el caller (uno de 'deworming' |
 * 'treatment' — el orquestador NO permite otros). `product_name` texto libre (de la pre-config /
 * autocompletar). ⚠️ NO se setea `route`: el antiparasitario es UNA maniobra SIN distinción estructurada
 * interno/externo (D10 RESUELTO Raf 2026-06-14; la vía, si se anota, va en `product_name`/notas). El gating
 * capa 2 (`tg_sanitary_events_gating`, 0091) re-valida `deworming` (OR antiparasitario_interno/externo) y
 * `treatment` (antibiotico) fail-closed al subir.
 */
export function buildAddManeuverSanitaryInsert(
  id: string,
  profileId: string,
  eventType: string,
  productName: string,
  eventDate: string,
  sessionId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO sanitary_events ' +
      '(id, animal_profile_id, event_type, product_name, event_date, session_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, profileId, eventType, productName, eventDate, sessionId],
  };
}

/** UPDATE del producto de un sanitary_event silent_apply de manga ya cargado (R5.9). Solo product_name/date. */
export function buildUpdateManeuverSanitary(
  id: string,
  productName: string,
  eventDate: string,
): LocalQuery {
  return {
    sql:
      'UPDATE sanitary_events SET product_name = ?, event_date = ? WHERE id = ? AND deleted_at IS NULL',
    args: [productName, eventDate, id],
  };
}

/**
 * INSERT local de UNA vacunación de manga (R6.1). `event_type='vaccination'`, `product_name` texto libre.
 * Multi-vacuna = el orquestador llama este builder UNA VEZ POR VACUNA (cada una con su id de cliente) →
 * N `sanitary_events`. `route` NULL (la vía de vacuna no se captura en la manga — la maniobra es silent;
 * si se quisiera, sería un refinamiento de M3.2). El gating capa 2 (`vacunacion` enabled) re-valida al subir.
 */
export function buildAddManeuverVaccinationInsert(
  id: string,
  profileId: string,
  productName: string,
  eventDate: string,
  sessionId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO sanitary_events ' +
      '(id, animal_profile_id, event_type, product_name, event_date, session_id) ' +
      "VALUES (?, ?, 'vaccination', ?, ?, ?)",
    args: [id, profileId, productName, eventDate, sessionId],
  };
}

/**
 * INSERT local de una condición corporal de manga (R6.6). `score` ∈ 1.00–5.00 step 0.25 (selector cerrado
 * → cumple el CHECK del DB al subir). Espeja `buildAddConditionScoreInsert` + `session_id`. El gating capa 2
 * (`condicion_corporal` enabled) re-valida al subir.
 */
export function buildAddManeuverConditionScoreInsert(
  id: string,
  profileId: string,
  score: number,
  eventDate: string,
  sessionId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO condition_score_events (id, animal_profile_id, score, event_date, session_id) ' +
      'VALUES (?, ?, ?, ?, ?)',
    args: [id, profileId, score, eventDate, sessionId],
  };
}

/** UPDATE del score de una condición corporal de manga ya cargada (R5.9). Solo score/date. */
export function buildUpdateManeuverConditionScore(
  id: string,
  score: number,
  eventDate: string,
): LocalQuery {
  return {
    sql:
      'UPDATE condition_score_events SET score = ?, event_date = ? WHERE id = ? AND deleted_at IS NULL',
    args: [score, eventDate, id],
  };
}

/**
 * INSERT local de un tacto vaquillona de manga (R6.3 / R5.13). `event_type='tacto_vaquillona'` (enum 0053)
 * + `heifer_fitness` ∈ apta|no_apta|diferida (enum 0053; selector cerrado). `created_at` de cliente (mismo
 * patrón que el tacto vaca — desempate del estado repro del mismo día). El gating capa 2 (`tacto_vaquillona`
 * enabled) re-valida al subir.
 */
export function buildAddManeuverTactoVaquillonaInsert(
  id: string,
  profileId: string,
  heiferFitness: string,
  eventDate: string,
  createdAt: string,
  sessionId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events ' +
      '(id, animal_profile_id, event_type, event_date, heifer_fitness, created_at, session_id) ' +
      "VALUES (?, ?, 'tacto_vaquillona', ?, ?, ?, ?)",
    args: [id, profileId, eventDate, heiferFitness, createdAt, sessionId],
  };
}

/** UPDATE del resultado de un tacto vaquillona de manga ya cargado (R5.9). Solo heifer_fitness/date. */
export function buildUpdateManeuverTactoVaquillona(
  id: string,
  heiferFitness: string,
  eventDate: string,
): LocalQuery {
  return {
    sql:
      'UPDATE reproductive_events SET heifer_fitness = ?, event_date = ? ' +
      "WHERE id = ? AND event_type = 'tacto_vaquillona' AND deleted_at IS NULL",
    args: [heiferFitness, eventDate, id],
  };
}

/**
 * INSERT local de una inseminación de manga (R6.5). `event_type='service'`, `service_type='ai'` (IA;
 * selector). La pajuela elegida (texto libre + autocompletar, R1.8) va en `notes` — NO hay columna
 * estructurada de pajuela en `reproductive_events` (semen_id es FK a `semen_registry`, que el MVP no usa).
 * `created_at` de cliente. NO dispara transición de categoría (un service es un registro). El gating capa 2
 * (`inseminacion` enabled) re-valida al subir.
 */
export function buildAddManeuverInseminationInsert(
  id: string,
  profileId: string,
  semenNote: string | null,
  eventDate: string,
  createdAt: string,
  sessionId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events ' +
      '(id, animal_profile_id, event_type, service_type, event_date, notes, created_at, session_id) ' +
      "VALUES (?, ?, 'service', 'ai', ?, ?, ?, ?)",
    args: [id, profileId, eventDate, semenNote, createdAt, sessionId],
  };
}

/** UPDATE de la pajuela (notes) de una inseminación de manga ya cargada (R5.9). Solo notes/date. */
export function buildUpdateManeuverInsemination(
  id: string,
  semenNote: string | null,
  eventDate: string,
): LocalQuery {
  return {
    sql:
      'UPDATE reproductive_events SET notes = ?, event_date = ? ' +
      "WHERE id = ? AND event_type = 'service' AND deleted_at IS NULL",
    args: [semenNote, eventDate, id],
  };
}

/**
 * INSERT local de UN lab_sample de manga (R6.4 sangrado / R6.11 raspado). `sampleType` lo pasa el caller
 * (uno de 'blood' | 'scrape_tricho' | 'scrape_campylo'). `tube_number` texto libre (el resultado llega luego
 * por import, spec 06 → `result` queda NULL). El raspado (R6.11) llama este builder DOS VECES (un id por
 * tubo, scrape_tricho + scrape_campylo). El gating capa 2 ramifica por sample_type (blood→`brucelosis`,
 * scrape_*→`raspado_toros`) y re-valida al subir.
 */
export function buildAddManeuverLabSampleInsert(
  id: string,
  profileId: string,
  sampleType: string,
  tubeNumber: string | null,
  collectionDate: string,
  sessionId: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO lab_samples ' +
      '(id, animal_profile_id, sample_type, tube_number, collection_date, session_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, profileId, sampleType, tubeNumber, collectionDate, sessionId],
  };
}

/** UPDATE del número de tubo de un lab_sample de manga ya cargado (R5.9). Solo tube_number/date. */
export function buildUpdateManeuverLabSample(
  id: string,
  tubeNumber: string | null,
  collectionDate: string,
): LocalQuery {
  return {
    sql:
      'UPDATE lab_samples SET tube_number = ?, collection_date = ? WHERE id = ? AND deleted_at IS NULL',
    args: [tubeNumber, collectionDate, id],
  };
}

/**
 * UPDATE local del estado dentario de un animal (R6.7) — dientes es PROPIEDAD que sobrescribe
 * `animal_profiles.teeth_state` (no es evento con historial). `teethState` ∈ enum teeth_state_enum (0020;
 * selector cerrado). Es un UPDATE de `animal_profiles` → CrudEntry PATCH → uploadData lo sube. El gating
 * capa 2 del DESTINO UPDATE (`tg_animal_profiles_teeth_gating`, 0054) re-valida al subir que el rodeo real
 * tenga `dientes` enabled (cambio aditivo: teeth_state → no-NULL). Filtra `deleted_at IS NULL`.
 *
 * Idempotencia: el id es el del PERFIL (no un evento) → re-confirmar/corregir desde el resumen es OTRO
 * UPDATE del mismo perfil (LWW), NO duplica (dientes no tiene historial). No lleva session_id (no es una
 * tabla de evento; la propiedad no se vincula a la jornada — el seguimiento de dientes no es time-series).
 */
export function buildSetTeethStateUpdate(profileId: string, teethState: string): LocalQuery {
  return {
    sql: 'UPDATE animal_profiles SET teeth_state = ? WHERE id = ? AND deleted_at IS NULL',
    args: [teethState, profileId],
  };
}

/**
 * UPDATE local de la transición a CUT (R6.8): marca `is_cut = true` + fija la categoría CUT del sistema
 * (`category_id = ?` la pasa el caller, resuelta del catálogo local) + `category_override = true` (la
 * elección de CUT es manual, el server NO la recalcula). UN solo statement → una CrudEntry PATCH. El gating
 * capa 2 del UPDATE (0054) re-valida `dientes` enabled (cambio aditivo: is_cut false→true). `category_id`
 * se valida server-side contra el sistema del rodeo (0021, 23514 si no cuadra). Filtra `deleted_at IS NULL`.
 *
 * NO se aplica a TERNEROS (R6.8) — ese gate es del cliente (predicado puro `shouldOfferCutPrompt`,
 * maneuver-applicability.ts); el orquestador NO ofrece este builder para terneros.
 */
export function buildSetCutUpdate(profileId: string, cutCategoryId: string): LocalQuery {
  return {
    sql:
      'UPDATE animal_profiles SET is_cut = 1, category_id = ?, category_override = 1 ' +
      'WHERE id = ? AND deleted_at IS NULL',
    args: [cutCategoryId, profileId],
  };
}

/**
 * UPDATE local que REVIERTE la marca CUT (corrección, R6.8): `is_cut = false` + restaura la categoría
 * DERIVADA (`category_id = ?` la pasa el caller = la categoría que el espejo computa sin CUT) +
 * `category_override = false` (vuelve al recálculo automático del server). Espeja el patrón de
 * `buildRevertCategoryOverrideUpdate` (revert de override en un solo statement). El gating capa 2 PERMITE
 * el cambio sustractivo (is_cut true→false NO se gatea, 0054 §D8) → la limpieza no requiere `dientes`
 * enabled. Mantiene consistente la categoría (no deja un is_cut=false con la categoría CUT colgada).
 */
export function buildUnsetCutUpdate(profileId: string, derivedCategoryId: string): LocalQuery {
  return {
    sql:
      'UPDATE animal_profiles SET is_cut = 0, category_id = ?, category_override = 0 ' +
      'WHERE id = ? AND deleted_at IS NULL',
    args: [derivedCategoryId, profileId],
  };
}

/**
 * INSERT local de un evento reproductivo `service` (espeja events.addService). `id` + `createdAt` de
 * cliente. `service_type` de un selector CERRADO. NO dispara transición. `notes` opcional.
 */
export function buildAddServiceInsert(
  id: string,
  profileId: string,
  serviceType: string,
  eventDate: string,
  notes: string | null,
  createdAt: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events ' +
      '(id, animal_profile_id, event_type, event_date, service_type, notes, created_at) ' +
      "VALUES (?, ?, 'service', ?, ?, ?, ?)",
    args: [id, profileId, eventDate, serviceType, notes, createdAt],
  };
}

/**
 * INSERT local de un evento reproductivo `abortion` (espeja events.addAbortion). `id` + `createdAt` de
 * cliente. Sin pregnancy_status ni service_type. El efecto colateral de REVERSIÓN de preñez (categoría) lo
 * dispara el trigger al SUBIR. `notes` opcional.
 */
export function buildAddAbortionInsert(
  id: string,
  profileId: string,
  eventDate: string,
  notes: string | null,
  createdAt: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events (id, animal_profile_id, event_type, event_date, notes, created_at) ' +
      "VALUES (?, ?, 'abortion', ?, ?, ?)",
    args: [id, profileId, eventDate, notes, createdAt],
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

// ─── Operaciones masivas (spec 10, T-CL.8) — builders de las N mutaciones ─────────────────────
//
// Las 3 ops escriben tablas YA en el sync set → CRUD plano sobre la fila sincronizada → una CrudEntry por
// statement → uploadData la sube al reconectar (RLS+triggers+CHECKs re-validan). NO hay canal "bulk": son
// las MISMAS escrituras que las individuales (vacunación/destete espejan events.ts; castración espeja el
// UPDATE de animal_profiles de revertCategoryOverride). `id` de cliente lo pasa el service (para vacunación/
// destete es el UUIDv5 determinístico de bulk-idempotency — dedup por PK ante syncs concurrentes).

/**
 * INSERT local de una VACUNACIÓN masiva en sanitary_events (R3.1). `event_type='vaccination'`,
 * `campaign_id` NULL (sanitary_campaigns NO existe as-built — design §2.2). `id` determinístico (UUIDv5,
 * R6.1) lo pasa el service. `product_name` de la pre-config. La VÍA se eliminó (decisión de producto
 * 2026-06-15: el producto la implica): el INSERT OMITE la columna `route` → queda NULL por default (la
 * columna sigue en la DB, dormida — no se dropeó). `established_id`/`created_by`/`created_at`/`source`
 * los pone el trigger/default al SUBIR (NO se mandan, igual que events.add*). El gating capa 2
 * (`vacunacion` enabled, fail-closed) lo re-valida `tg_sanitary_events_gating` al subir.
 */
export function buildAddVaccinationInsert(
  id: string,
  profileId: string,
  productName: string,
  eventDate: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO sanitary_events ' +
      '(id, animal_profile_id, event_type, product_name, event_date) ' +
      "VALUES (?, ?, 'vaccination', ?, ?)",
    args: [id, profileId, productName, eventDate],
  };
}

/**
 * INSERT local de un DESTETE masivo en reproductive_events (R3.2). `event_type='weaning'`, uno por
 * ternero/a seleccionado (R3.5: mellizos = un weaning cada uno). `id` determinístico (UUIDv5, R6.1) +
 * `createdAt` de cliente (mismo patrón que addTacto/addWeaning individual: el desempate por created_at del
 * mismo event_date — banner de reproductive_events arriba). La TRANSICIÓN de categoría la dispara el
 * trigger 0063 al SUBIR (ternera→vaquillona, ternero→torito/novillito) — el cliente NO la aplica.
 */
export function buildAddWeaningInsert(
  id: string,
  profileId: string,
  eventDate: string,
  createdAt: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO reproductive_events (id, animal_profile_id, event_type, event_date, created_at) ' +
      "VALUES (?, ?, 'weaning', ?, ?)",
    args: [id, profileId, eventDate, createdAt],
  };
}

/**
 * UPDATE local de CASTRACIÓN (R3.3 / R13.4): setea `is_castrated` sobre el perfil — el ÚNICO write-path
 * offline de la castración (animal_profiles sincroniza; animals NO → el write-through server-side 0084
 * §4.2 lo propaga a animals.is_castrated y dispara el recompute simétrico 0064/0086). Al CASTRAR
 * (`value=true`) limpia `future_bull` en la MISMA mutación (R12.4: auto-clear; el trigger normalize 0085 lo
 * garantiza igual server-side — defensa en profundidad). Al revertir (`value=false`) NO toca future_bull
 * (el animal vuelve a ser entero; conserva su marca ⭐ si la tenía). Idempotente por valor (re-UPDATE =
 * no-op; el guard IS DISTINCT FROM de los triggers evita disparos espurios). Filtra deleted_at IS NULL
 * (no se castra un perfil borrado). RLS animal_profiles_update es la barrera real al subir.
 *
 * Es UN solo statement → UNA CrudEntry (PATCH). La observación automática (R13.7) es OTRA CrudEntry
 * (INSERT animal_events) que el service encadena aparte → 2 CrudEntries/animal, INDEPENDIENTES (R10.2).
 */
export function buildSetCastratedUpdate(profileId: string, value: boolean): LocalQuery {
  if (value) {
    // Castrar: is_castrated=1 + future_bull=0 (auto-clear, R12.4) en un solo UPDATE.
    return {
      sql:
        'UPDATE animal_profiles SET is_castrated = 1, future_bull = 0 ' +
        'WHERE id = ? AND deleted_at IS NULL',
      args: [profileId],
    };
  }
  // Revertir (des-castrar): solo is_castrated=0. future_bull NO se toca (el animal vuelve a entero).
  return {
    sql: 'UPDATE animal_profiles SET is_castrated = 0 WHERE id = ? AND deleted_at IS NULL',
    args: [profileId],
  };
}

/**
 * UPDATE local del flag ⭐ "futuro torito" (R12.2 / setFutureBull): setea `future_bull` sobre el perfil.
 * SIN observación automática (no es castración — design §3.3). El trigger normalize 0085 lo lleva a false
 * si el animal no es macho o está castrado (defensa server-side). `value` boolean → 0/1 (SQLite). Filtra
 * deleted_at IS NULL. RLS animal_profiles_update es la barrera real al subir. UNA CrudEntry (PATCH).
 */
export function buildSetFutureBullUpdate(profileId: string, value: boolean): LocalQuery {
  return {
    sql: 'UPDATE animal_profiles SET future_bull = ? WHERE id = ? AND deleted_at IS NULL',
    args: [value ? 1 : 0, profileId],
  };
}

/**
 * `id`s de las VACUNACIONES ya aplicadas localmente para un conjunto de perfiles en una fecha (spec 10,
 * T-CL.8 / R6.3 — barrera idempotente local). El service compara estos ids contra el UUIDv5 determinístico
 * de cada candidato (filterNewEventKeys) → re-ejecutar la masiva EXCLUYE los ya procesados. `deleted_at IS
 * NULL` (un evento borrado no cuenta como aplicado → re-vacunar es legítimo). El scoping ya lo aplicó la
 * stream. `profileIds` ≥ 1 (el caller no llama con lista vacía). Idéntico patrón para destete abajo.
 */
export function buildExistingVaccinationIdsQuery(
  profileIds: readonly string[],
  eventDate: string,
): LocalQuery {
  const placeholders = profileIds.map(() => '?').join(', ');
  return {
    sql:
      'SELECT id FROM sanitary_events ' +
      `WHERE animal_profile_id IN (${placeholders}) AND event_type = 'vaccination' ` +
      'AND event_date = ? AND deleted_at IS NULL',
    args: [...profileIds, eventDate],
  };
}

/**
 * `id`s de los DESTETES ya aplicados localmente para un conjunto de perfiles en una fecha (R6.3). Igual
 * que la vacunación, sobre reproductive_events 'weaning'. La barrera principal del destete es que los ya
 * destetados ni son candidatos (bulk-candidates filtra hasWeaning), pero esta query cubre la re-ejecución
 * con la MISMA fecha (dedup por el UUIDv5 determinístico). `deleted_at IS NULL`.
 */
export function buildExistingWeaningIdsQuery(
  profileIds: readonly string[],
  eventDate: string,
): LocalQuery {
  const placeholders = profileIds.map(() => '?').join(', ');
  return {
    sql:
      'SELECT id FROM reproductive_events ' +
      `WHERE animal_profile_id IN (${placeholders}) AND event_type = 'weaning' ` +
      'AND event_date = ? AND deleted_at IS NULL',
    args: [...profileIds, eventDate],
  };
}

/**
 * establishment_id de un CONJUNTO de perfiles (spec 10, T-CL.8 — castración masiva): la observación
 * automática de cada animal (R13.7) lo deriva del PERFIL (NUNCA inventado; el trigger 0034 lo valida). Una
 * sola query batched (no N+1). Devuelve { id, establishment_id }. `profileIds` ≥ 1.
 */
export function buildProfileEstablishmentsQuery(profileIds: readonly string[]): LocalQuery {
  const placeholders = profileIds.map(() => '?').join(', ');
  return {
    sql: `SELECT id, establishment_id FROM animal_profiles WHERE id IN (${placeholders})`,
    args: [...profileIds],
  };
}

/**
 * Flags de CANDIDATURA de un conjunto de perfiles para la pantalla de selección masiva (spec 10, T-UI.4):
 * los 3 campos que la fila de lista (AnimalListItem) NO expone pero que bulk-candidates/bulk-selection
 * necesitan por animal — `is_castrated` (excluye candidatos de castración, D3), `category_override`
 * (aviso R5.6 en el bottom-sheet, NO afecta candidatura) y `has_weaning` (excluye candidatos de destete,
 * R11.4). La identidad/categoría/sexo ya las trae fetchAnimals (con la categoría del espejo C6); acá SOLO
 * estos 3 flags, keyed por id, para mergear. `has_weaning` = EXISTS un `weaning` NO borrado (synced o
 * pending overlay). Una sola query batched (no N+1). `profileIds` ≥ 1. El scoping ya lo aplicó la stream.
 */
export function buildGroupCandidateFlagsQuery(profileIds: readonly string[]): LocalQuery {
  const placeholders = profileIds.map(() => '?').join(', ');
  return {
    sql:
      'SELECT ap.id AS id, ap.is_castrated AS is_castrated, ' +
      'ap.category_override AS category_override, ' +
      'CASE WHEN EXISTS (' +
      'SELECT 1 FROM reproductive_events re ' +
      "WHERE re.animal_profile_id = ap.id AND re.event_type = 'weaning' AND re.deleted_at IS NULL" +
      ') OR EXISTS (' +
      'SELECT 1 FROM pending_reproductive_events pre ' +
      "WHERE pre.animal_profile_id = ap.id AND pre.event_type = 'weaning'" +
      ') THEN 1 ELSE 0 END AS has_weaning ' +
      `FROM animal_profiles ap WHERE ap.id IN (${placeholders})`,
    args: [...profileIds],
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
 * UPDATE local que QUITA la fijación manual de categoría (revert override, C6 / RC6.4.3). UN ÚNICO
 * statement que setea `category_override = 0` Y `category_id = ?` (la categoría DERIVADA por el espejo,
 * resuelta a id por el caller). Patrón as-built T2.5/T2.30: el cliente APORTA el valor recalculado; al
 * SUBIR, PowerSync lo manda como un solo UPDATE → el trigger `0040` ve `old.override=true ∧
 * new.override=false` EN EL MISMO statement y respeta el revert (no re-marca override); `0030` registra
 * `revert_to_auto`; `0021` re-valida la categoría contra el sistema del rodeo (23514 si no cuadra).
 *
 * Filtra `deleted_at IS NULL` (no se revierte un perfil borrado). Se ELIMINA cualquier `count:'exact'`
 * (R6.3): el UPDATE local siempre "tiene éxito" offline (RC6.4.4); la authz real (RLS
 * `animal_profiles_update`) se valida al SUBIR. `category_override` se escribe como 0 (SQLite no tiene
 * boolean; PowerSync lo materializa al `false` de PG al subir).
 */
export function buildRevertCategoryOverrideUpdate(profileId: string, categoryId: string): LocalQuery {
  return {
    sql:
      'UPDATE animal_profiles SET category_override = 0, category_id = ? ' +
      'WHERE id = ? AND deleted_at IS NULL',
    args: [categoryId, profileId],
  };
}

/**
 * UPDATE local del `rodeo_id` del PERFIL ACTIVO de un animal (spec 03 R4.4 — "pasar el animal a este
 * rodeo"). Espeja `buildAssignAnimalToGroupUpdate`: CRUD-plano sobre la tabla SINCRONIZADA → su propia
 * CrudEntry → uploadData lo sube como UPDATE de `rodeo_id`. Filtra `deleted_at IS NULL` (no se mueve un
 * perfil borrado).
 *
 * La VALIDACIÓN vive server-side (NO en el cliente — design §4 / SEC): al subir el UPDATE, el trigger
 * `tg_animal_profiles_rodeo_same_system_check` (0047, before update of rodeo_id) rechaza el cruce de
 * sistemas productivos (R4.5.1, errcode 23514), y `tg_animal_profiles_rodeo_check` (0021) re-valida que
 * el rodeo destino sea del MISMO establishment del perfil y esté activo. La RLS
 * (`animal_profiles_update` = has_role_in) re-valida el tenant al SUBIR. El cliente solo APORTA el
 * `rodeoId` destino (un rodeo del MISMO campo activo, de `rodeo.available` del RodeoContext — la UI nunca
 * ofrece un rodeo ajeno). Contrato T5: el local write siempre "tiene éxito" offline; la authz real se
 * valida al subir (un rodeo de otro sistema/inactivo es rechazado allí y superficiado por uploadData).
 */
export function buildMoveAnimalToRodeoUpdate(profileId: string, rodeoId: string): LocalQuery {
  return {
    sql: 'UPDATE animal_profiles SET rodeo_id = ? WHERE id = ? AND deleted_at IS NULL',
    args: [rodeoId, profileId],
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
// MODO MANIOBRAS (spec 03 M1.2/M1.3) — sessions + maneuver_presets (CRUD plano offline)
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Mismo patrón CRUD-plano de events.ts / management-groups.ts: INSERT/UPDATE local sobre la tabla
// SINCRONIZADA → 1 CrudEntry → uploadData la sube al reconectar (RLS+triggers+CHECK re-validan, 0050/0051).
// `id` de cliente (R1.11/R2.5). `created_by`/`establishment_id` (audit) los FUERZA el trigger
// tg_force_created_by_auth_uid (0050/0051) al subir → NO se mandan. `config` es jsonb pass-through: el
// caller lo serializa con JSON.stringify (la columna es TEXT en SQLite; PostgREST lo castea a jsonb al subir).

// ─── sessions (R1.9/R1.10/R10.7) ────────────────────────────────────────────────────

/**
 * INSERT local de una `session` (jornada de maniobra). `id` de cliente (R1.11). `establishment_id` +
 * `rodeo_id` van en el INSERT (load-bearing: la sesión es de un establishment/rodeo, el trigger
 * tg_sessions_rodeo_check 0050 los re-valida al subir). `config` = snapshot jsonb de la jornada
 * (maniobras + pre-config), serializado por el caller. `status` arranca en 'active' (default del DB,
 * lo seteamos explícito para que la fila local lo tenga). `created_by` lo FUERZA el trigger al subir.
 *
 * ⚠️ `started_at` de CLIENTE (wall-clock del inicio de la jornada): el DB lo tiene `default now()` SIN
 * force-trigger (0050) → el valor del cliente PERSISTE al subir (instante de INICIO en el dispositivo,
 * fiel a una jornada arrancada offline — mejor que el now() de subida). Lo necesita la reanudación local
 * (R10.5: buildActiveSessionQuery ordena por started_at DESC) para tener un orden determinístico OFFLINE.
 */
export function buildCreateSessionInsert(
  id: string,
  establishmentId: string,
  rodeoId: string,
  configJson: string,
  workLotLabel: string | null,
  startedAt: string,
): LocalQuery {
  return {
    sql:
      'INSERT INTO sessions (id, establishment_id, rodeo_id, config, status, work_lot_label, ' +
      'animal_count, event_count, started_at) ' +
      "VALUES (?, ?, ?, ?, 'active', ?, 0, 0, ?)",
    args: [id, establishmentId, rodeoId, configJson, workLotLabel, startedAt],
  };
}

/**
 * UPDATE local que CIERRA una sesión (R10.7): `status='closed'` + `ended_at`. Filtra `deleted_at IS NULL`
 * (no se cierra una sesión borrada). El caller pasa el ended_at de cliente (wall-clock del cierre). La
 * RLS sessions_update (has_role_in) re-valida al subir.
 */
export function buildCloseSessionUpdate(id: string, endedAt: string): LocalQuery {
  return {
    sql: "UPDATE sessions SET status = 'closed', ended_at = ? WHERE id = ? AND deleted_at IS NULL",
    args: [endedAt, id],
  };
}

/**
 * UPDATE local que CIERRA TODAS las sesiones ACTIVAS de un establishment (R10.6: una sola sesión activa
 * por dispositivo a la vez). Lo dispara `createSession` ANTES de insertar la jornada nueva → tras crear,
 * queda a lo sumo 1 activa (la nueva). Espeja `buildCloseSessionUpdate` pero scopeado por
 * `establishment_id` + `status='active'` (en vez de por `id`): cierra el set entero de huérfanas que
 * "Salir sin terminar" (R10.5) o un arranque previo sin cierre hubieran dejado activas. Filtra
 * `status='active'` (las cerradas no se re-tocan) + `deleted_at IS NULL`. El caller pasa el ended_at de
 * cliente (wall-clock). La RLS sessions_update (has_role_in) re-valida al subir.
 *
 * Multi-tenant (CLAUDE.md ppio 6): el `establishment_id` lo pasa el caller (el establishment activo del
 * contexto, NUNCA hardcodeado). La stream de PowerSync ya scopea el SQLite local a los establishments del
 * usuario (has_role_in) → este UPDATE solo alcanza sesiones del propio establishment; la RLS lo re-confirma
 * al subir.
 */
export function buildCloseActiveSessionsUpdate(establishmentId: string, endedAt: string): LocalQuery {
  return {
    sql:
      "UPDATE sessions SET status = 'closed', ended_at = ? " +
      "WHERE establishment_id = ? AND status = 'active' AND deleted_at IS NULL",
    args: [endedAt, establishmentId],
  };
}

/**
 * UPDATE local del `work_lot_label` (R9.4): metadata informativa NO-autoritativa de la jornada (texto
 * libre, NUNCA FK asignadora a management_groups). Filtra `deleted_at IS NULL`. El caller pasa null para
 * limpiarlo.
 */
export function buildSetWorkLotLabelUpdate(id: string, label: string | null): LocalQuery {
  return {
    sql: 'UPDATE sessions SET work_lot_label = ? WHERE id = ? AND deleted_at IS NULL',
    args: [label, id],
  };
}

/**
 * UPDATE local de los contadores app-maintained de la sesión (D5): `animal_count`/`event_count`. Se
 * setean a un valor ABSOLUTO (el caller recomputa o incrementa client-side y pasa el total) — evita
 * carreras de `count = count + 1` concurrentes que LWW de PowerSync resolvería mal. Filtra `deleted_at
 * IS NULL`. NO son constraints de integridad: el conteo autoritativo se recomputa con count(*) por
 * session_id (ver design §2.1 nota).
 */
export function buildSetSessionCountsUpdate(
  id: string,
  animalCount: number,
  eventCount: number,
): LocalQuery {
  return {
    sql:
      'UPDATE sessions SET animal_count = ?, event_count = ? WHERE id = ? AND deleted_at IS NULL',
    args: [animalCount, eventCount, id],
  };
}

/**
 * UPDATE local del `rodeo_id` de una sesión (R4.4 — cambiar el rodeo de la jornada). Lo dispara el flujo
 * de manga cuando el operario decide cambiar la jornada al rodeo de un animal de otro rodeo del mismo
 * establecimiento (o desde el aviso R4.7 de rodeo mal elegido). NO es destructivo: los animales ya
 * procesados quedan con sus eventos correctos (vinculados a sus rodeos reales por session_id, no por
 * el rodeo de la sesión) — solo cambia el rodeo por defecto de los próximos. Filtra `deleted_at IS NULL`
 * y `status='active'` (no se re-apunta el rodeo de una sesión cerrada). La RLS (sessions_update =
 * has_role_in) + el rodeo-check (tg_sessions_rodeo_check, 0050: rodeo del mismo establishment + activo)
 * re-validan al SUBIR — un rodeo ajeno/inactivo es rechazado allí (superficiado por uploadData).
 */
export function buildSetSessionRodeoUpdate(id: string, rodeoId: string): LocalQuery {
  return {
    sql: "UPDATE sessions SET rodeo_id = ? WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    args: [rodeoId, id],
  };
}

/**
 * Lee la sesión ACTIVA de un establishment (R10.6: una sola sesión activa por dispositivo a la vez). El
 * scoping (has_role_in) ya lo aplicó la stream. Filtra `status='active'` + `deleted_at IS NULL`. Orden por
 * started_at DESC + LIMIT 1: si por algún borde hubiera más de una activa, devolvemos la más reciente (el
 * caller ofrece retomarla/cerrarla). Devuelve las columnas que el caller necesita para reanudar.
 */
export function buildActiveSessionQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      'SELECT id, establishment_id, rodeo_id, config, status, work_lot_label, ' +
      'animal_count, event_count, started_at, ended_at ' +
      "FROM sessions WHERE establishment_id = ? AND status = 'active' AND deleted_at IS NULL " +
      'ORDER BY started_at DESC LIMIT 1',
    args: [establishmentId],
  };
}

/**
 * Lee UNA sesión por id (para reanudación / lectura puntual). Filtra `deleted_at IS NULL`. Mismas columnas
 * que buildActiveSessionQuery. LIMIT 1 (PK).
 */
export function buildSessionByIdQuery(id: string): LocalQuery {
  return {
    sql:
      'SELECT id, establishment_id, rodeo_id, config, status, work_lot_label, ' +
      'animal_count, event_count, started_at, ended_at ' +
      'FROM sessions WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    args: [id],
  };
}

// ─── maneuver_presets (R2.1/R2.2/R2.5) ──────────────────────────────────────────────

/**
 * INSERT local de un `maneuver_preset` (scope establishment, R2.4). `id` de cliente (R2.5). `name` ya
 * trimeado/validado por el caller (el CHECK maneuver_presets_name_not_empty exige length(trim(name)) > 0).
 * `config` = snapshot jsonb (maniobras + pre-config), serializado por el caller (mismo shape que
 * sessions.config). `created_by` lo FUERZA el trigger al subir.
 */
export function buildCreateManeuverPresetInsert(
  id: string,
  establishmentId: string,
  name: string,
  configJson: string,
): LocalQuery {
  return {
    sql: 'INSERT INTO maneuver_presets (id, establishment_id, name, config) VALUES (?, ?, ?, ?)',
    args: [id, establishmentId, name, configJson],
  };
}

/**
 * UPDATE local de un preset (renombrar + reconfigurar). Filtra `deleted_at IS NULL` (no se edita un
 * preset borrado). La RLS maneuver_presets_update (has_role_in) re-valida al subir.
 */
export function buildUpdateManeuverPresetUpdate(
  id: string,
  name: string,
  configJson: string,
): LocalQuery {
  return {
    sql:
      'UPDATE maneuver_presets SET name = ?, config = ? WHERE id = ? AND deleted_at IS NULL',
    args: [name, configJson, id],
  };
}

/**
 * Lista los presets ACTIVOS (no soft-deleted) de un establishment, al tope de la pantalla de inicio
 * (R2.2). El scoping (has_role_in) ya lo aplicó la stream → no se re-filtra; SÍ se conserva el filtro de
 * dominio `deleted_at IS NULL` (defensivo). Orden por nombre para una lista estable.
 *
 * UNION overlay (R6.11, mismo patrón que buildManagementGroupsQuery): oculta los presets con un
 * `soft_deleted` pendiente (el borrado optimista de softDeletePreset, vía la OUTBOX, saca el preset de la
 * lista al instante OFFLINE antes de que la RPC corra). Overlay vacío → idéntico al swap plano.
 */
export function buildManeuverPresetsQuery(establishmentId: string): LocalQuery {
  return {
    sql:
      'SELECT id, name, config FROM maneuver_presets mp ' +
      'WHERE mp.establishment_id = ? AND mp.deleted_at IS NULL AND ' +
      notHiddenByOverride('maneuver_presets', 'mp.id', ['soft_deleted']) +
      ' ORDER BY name ASC',
    args: [establishmentId],
  };
}

/** Lee UN preset por id (para cargarlo / loadPreset). Filtra `deleted_at IS NULL`. LIMIT 1 (PK). */
export function buildManeuverPresetByIdQuery(id: string): LocalQuery {
  return {
    sql:
      'SELECT id, name, config FROM maneuver_presets WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    args: [id],
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
