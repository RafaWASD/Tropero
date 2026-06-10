// Capa de datos de animales (spec 02 frontend C2, T3.2 + spec 09 puerta manual R3/R5).
//
// Queries DIRECTAS a Supabase con supabase-js (PowerSync es C5, diferido — los services son la
// ÚNICA capa que tocará PowerSync; mantenerlos delgados y swappables, design.md §retrofit).
// RLS protege server-side (0022): SELECT de animal_profiles con has_role_in(establishment_id) +
// deleted_at is null; SELECT de animals derivado de existencia de perfil. El cliente NO fuerza
// permisos: la RLS es la barrera real (R10.2 de spec 09 / R11 de spec 02).
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id ni species/system/category
// UUID. El establishment viene del contexto activo; species/category se resuelven por `code`.
//
// El ALTA (R4.6) es operación administrativa ONLINE en C2 (como crear campo/rodeo en C1); el
// offline-first real (PowerSync) es C5. Sin red → kind:'network' con copy accionable.

import { type AnimalSex } from '../utils/animal-category';
import { classifyIdentifier, classifySearchQuery } from '../utils/animal-identifier';
import {
  type ExitReasonChoice,
  type ExitStatus,
} from './exit-animal';
import {
  buildSystemCategoriesQuery,
  buildAnimalsListQuery,
  buildAnimalsCountQuery,
  buildSearchByTagQuery,
  buildSearchByIdvQuery,
  buildSearchLikeQuery,
  buildAnimalDetailQuery,
  buildCategoryIdByCodeQuery,
  buildRodeoSpeciesQuery,
  toBool,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle } from './powersync/local-query';
import { enqueueCreateAnimal, enqueueExitAnimal } from './powersync/outbox';

// ─── Error / Result uniforme (mismo shape que rodeo-config.ts / establishments.ts) ──

// AppError conserva los kinds duplicate_tag/duplicate_idv en el TIPO (otros services/screens los usan en
// el shape compartido). Con el swap a OUTBOX (T6) el alta ya NO clasifica el 23505 en el return: el local
// write SIEMPRE tiene éxito offline y el rechazo REAL (tag/idv duplicado) lo resuelve uploadData al SUBIR
// (rollback del overlay + superficia por el canal de status, R8.1) — NO por el return de createAnimal.
export type AppError = { kind: 'network' | 'duplicate_tag' | 'duplicate_idv' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

// ─── Tipos de dominio (espejan las tablas, sin acoplar a supabase-js en los callers) ──

/** Una fila de la lista de la tab Animales (R1.1). */
export type AnimalListItem = {
  profileId: string;
  animalId: string;
  idv: string | null;
  visualIdAlt: string | null;
  tagElectronic: string | null;
  categoryCode: string;
  categoryName: string;
  sex: AnimalSex;
  rodeoId: string;
  rodeoName: string;
  status: AnimalStatus;
  /** Lote asignado (ADR-020). null = sin lote (se agrupa por categoría). Lo usa fetchGroupMembers (C4). */
  managementGroupId: string | null;
};

export type AnimalStatus = 'active' | 'sold' | 'dead' | 'transferred';

/** Detalle para la ficha básica (C2): identidad + atributos + rodeo + categoría + lote. */
export type AnimalDetail = {
  profileId: string;
  animalId: string;
  /**
   * establishment_id del PERFIL (C3.1). Necesario para la observación libre (animal_events): su
   * establishment_id está denormalizado y un trigger valida que coincida con el establishment del
   * perfil → se deriva de ACÁ (el perfil), no del contexto activo (el usuario podría tener el campo
   * B activo mientras mira la ficha del campo A).
   */
  establishmentId: string;
  idv: string | null;
  visualIdAlt: string | null;
  tagElectronic: string | null;
  sex: AnimalSex;
  birthDate: string | null;
  categoryCode: string;
  categoryName: string;
  categoryOverride: boolean;
  breed: string | null;
  coatColor: string | null;
  entryDate: string | null;
  entryWeight: number | null;
  status: AnimalStatus;
  /**
   * Autor del alta (animal_profiles.created_by, 0043 — seteado server-side por trigger a auth.uid()).
   * Lo usa el gating del botón "Dar de baja" (C3.3, R4.14): además del owner del campo, el operario
   * que CARGÓ el animal puede darlo de baja. null = alta sin autor registrado (datos viejos / seed).
   */
  createdBy: string | null;
  /** Fecha de egreso (animal_profiles.exit_date, 0020/0044) — null si el animal sigue activo. Modo archivada. */
  exitDate: string | null;
  /**
   * Motivo de egreso (animal_profiles.exit_reason, enum 0044: sale|death|transfer|culling|theft|other).
   * null si activo. Lo usa el badge de modo archivada para derivar el verbo (vendido/muerto/transferido).
   */
  exitReason: string | null;
  rodeoId: string;
  rodeoName: string;
  managementGroupId: string | null;
  managementGroupName: string | null;
};

// ─── Filas crudas del SQLite local (shape PLANO; b1: identidad desde animal_profiles) ──
//
// El swap a SQLite local (T4.1) reescribe los JOINs embebidos de PostgREST (`animals!inner`,
// `rodeos!inner`, …) como JOINs SQLite que devuelven filas PLANAS (aliaseadas en local-reads). La
// identidad (tag/sex) viene de las columnas denormalizadas de animal_profiles (b1), NO de `animals`.

type LocalListRow = {
  id: string;
  animal_id: string;
  idv: string | null;
  visual_id_alt: string | null;
  category_id: string;
  rodeo_id: string;
  status: AnimalStatus;
  management_group_id: string | null;
  tag_electronic: string | null;
  sex: AnimalSex | null;
  rodeo_name: string | null;
  category_code: string | null;
  category_name: string | null;
};

function toLocalListItem(r: LocalListRow): AnimalListItem {
  return {
    profileId: r.id,
    animalId: r.animal_id,
    idv: r.idv,
    visualIdAlt: r.visual_id_alt,
    tagElectronic: r.tag_electronic,
    categoryCode: r.category_code ?? '',
    categoryName: r.category_name ?? '',
    sex: r.sex ?? 'female',
    rodeoId: r.rodeo_id,
    rodeoName: r.rodeo_name ?? '',
    status: r.status,
    managementGroupId: r.management_group_id,
  };
}

// ─── Lista (R1.1, R1.5) ────────────────────────────────────────────────────────────

export type FetchAnimalsFilter = {
  /** Filtra por rodeo (R1.5). */
  rodeoId?: string | null;
  /** Filtra por estado (R1.5). Default: solo 'active' (la tab muestra activos). */
  status?: AnimalStatus | null;
  /** Solo animales sin caravana electrónica: animals.tag_electronic IS NULL (R1.5). */
  noTag?: boolean;
};

/**
 * Lista los animal_profiles del establishment activo (R1.1), con filtros opcionales (R1.5), desde el
 * SQLite local (T4.1/R5.1). El scoping (has_role_in + deleted_at del campo) ya lo aplicó la stream
 * est_animal_profiles al sincronizar → NO se re-filtra; SÍ se conservan los filtros de DOMINIO:
 * `deleted_at IS NULL` propio (defensivo), `status` (default 'active'), `rodeo_id`, `noTag`.
 *
 * b1 (ADR-026): la identidad (tag/sex) sale de las columnas denormalizadas de animal_profiles
 * (animal_tag_electronic/animal_sex), NO de un JOIN a `animals` (que no se sincroniza). El `noTag`
 * filtra `animal_tag_electronic IS NULL`.
 *
 * Orden: created_at desc + LIMIT 200, idénticos a la versión PostgREST. Si aún no sincronizó (vacío +
 * !hasSynced) degrada a "Sincronizando…" (kind:'network').
 */
export async function fetchAnimals(
  establishmentId: string,
  filter: FetchAnimalsFilter = {},
): Promise<ServiceResult<AnimalListItem[]>> {
  const r = await runLocalQuery<LocalListRow>(
    buildAnimalsListQuery(establishmentId, {
      rodeoId: filter.rodeoId,
      status: filter.status,
      noTag: filter.noTag,
    }),
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map(toLocalListItem) };
}

// ─── Conteo liviano (home: paso "Cargá tu primer animal" por estado real) ────────────

/**
 * Cuenta los animales ACTIVOS del establishment activo desde el SQLite local (T4.1). Lo usa la home
 * para drivear el paso "Cargá tu primer animal" del Stepper por estado REAL (en vez de hardcodearlo
 * siempre pendiente).
 *
 * Scope: establishment activo + status 'active' + deleted_at null (consistente con la tab Animales).
 * El scoping de tenant ya lo aplicó la stream. NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6):
 * viene del contexto activo. COUNT(*) siempre devuelve 1 fila → NO degrada a "Sincronizando"; antes
 * del primer sync da 0 (dirección segura: alimenta un hint de UI, no autorización).
 */
export async function countAnimals(
  establishmentId: string,
): Promise<ServiceResult<number>> {
  const r = await runLocalQuerySingle<{ count: number }>(buildAnimalsCountQuery(establishmentId));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value?.count ?? 0 };
}

// ─── Búsqueda (R5 de spec 02: TAG/IDV exacto + visual fuzzy) ─────────────────────────

/**
 * Busca animales del establishment activo (R1.2/R5). Para texto NUMÉRICO corre, en este orden:
 *   1) TAG exacto (caravana electrónica FDX-B, solo si son 15 díg)
 *   2) IDV exacto (animal_profiles.idv)
 *   3) substring PARCIAL (ilike) sobre idv Y tag_electronic — fix-loop 2: un prefijo/fragmento
 *      como "03200" ENCUENTRA los animales cuya caravana/IDV lo contengan (antes solo el exacto
 *      de 15 díg matcheaba la caravana → un prefijo daba "no encontramos").
 * Para CUALQUIER texto corre además el fuzzy de visual_id_alt (red de seguridad).
 *
 * Devuelve resultados deduplicados por profileId, con los exactos priorizados arriba (se concatenan
 * antes que el substring/fuzzy; el dedup descarta el duplicado posterior). Cada sub-query es
 * scopeada por establishment_id + deleted_at + status active (la tab busca el rodeo vivo). RLS es
 * la barrera real (R10.2): el cliente NO fuerza permisos.
 */
export async function searchAnimals(
  establishmentId: string,
  rawQuery: string,
): Promise<ServiceResult<AnimalListItem[]>> {
  const plan = classifySearchQuery(rawQuery);
  if (!plan.tryTag && !plan.tryIdv && !plan.tryNumericSubstring && !plan.tryVisual) {
    return { ok: true, value: [] };
  }

  const seen = new Set<string>();
  const out: AnimalListItem[] = [];

  // 1) TAG exacto (b1: animal_profiles.animal_tag_electronic) — solo si el texto tiene forma de
  //    caravana FDX-B. Priorizado arriba: un escaneo exacto de 15 díg es el match más fuerte.
  if (plan.tryTag) {
    const r = await runLocalQuery<LocalListRow>(
      buildSearchByTagQuery(establishmentId, plan.compact),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    pushLocalRows(r.value, seen, out);
  }

  // 2) IDV exacto (animal_profiles.idv) — solo si el texto es numérico. Priorizado sobre el
  //    substring (el operario que tipea el IDV completo ve su animal primero).
  if (plan.tryIdv) {
    const r = await runLocalQuery<LocalListRow>(
      buildSearchByIdvQuery(establishmentId, plan.compact),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    pushLocalRows(r.value, seen, out);
  }

  // 3) Substring numérico (LIKE PARCIAL local) sobre idv Y tag_electronic — fix-loop 2: tipear
  //    "03200" (prefijo/fragmento de una caravana o IDV) debe ENCONTRAR los animales que lo
  //    contengan, no solo el match exacto. DEGRADACIÓN: SQLite no tiene pg_trgm → el fuzzy/ilike de
  //    PostgREST se reescribe como `LIKE '%term%' ESCAPE '\'` local (buildSearchLikeQuery escapa los
  //    comodines del término). Son DOS sub-queries (una por columna), el dedup por profileId las une.
  if (plan.tryNumericSubstring) {
    const idvRes = await runLocalQuery<LocalListRow>(
      buildSearchLikeQuery(establishmentId, 'idv', plan.compact),
      { emptyIsSyncing: false },
    );
    if (!idvRes.ok) return { ok: false, error: idvRes.error };
    pushLocalRows(idvRes.value, seen, out);

    const tagRes = await runLocalQuery<LocalListRow>(
      buildSearchLikeQuery(establishmentId, 'animal_tag_electronic', plan.compact),
      { emptyIsSyncing: false },
    );
    if (!tagRes.ok) return { ok: false, error: tagRes.error };
    pushLocalRows(tagRes.value, seen, out);
  }

  // 4) visual_id_alt fuzzy → DEGRADADO a `LIKE '%term%'` local (sin trigram). Cubre el caso operativo
  //    de tipear un fragmento del identificador visual. El ranking por similaridad (pg_trgm) es
  //    post-MVP; el LIKE alcanza para el buscador de campo. El recorte de largo del término lo hizo
  //    classifySearchQuery (R7.3); buildSearchLikeQuery escapa los comodines del término.
  if (plan.tryVisual) {
    const r = await runLocalQuery<LocalListRow>(
      buildSearchLikeQuery(establishmentId, 'visual_id_alt', plan.normalized),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    pushLocalRows(r.value, seen, out);
  }

  return { ok: true, value: out };
}

function pushLocalRows(
  rows: LocalListRow[] | null,
  seen: Set<string>,
  out: AnimalListItem[],
): void {
  for (const r of rows ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(toLocalListItem(r));
  }
}

// ─── Catálogo de categorías del sistema (picker de la alta guiada, paso 3) ────────────

/** Una categoría del catálogo de un sistema productivo (alta guiada A, picker cerrado). */
export type SystemCategory = {
  /** code estable del catálogo (ej. 'multipara', 'ternero'). Lo usa el override + el insert. */
  code: string;
  /** name legible es-AR (ej. 'Multípara', 'Ternero') — lo que ve el usuario en el picker. */
  name: string;
};

type CategoryRow = { code: string; name: string };

/**
 * Lee las categorías ACTIVAS del catálogo de un sistema productivo (categories_by_system del
 * `systemId` del rodeo elegido) — el picker CERRADO de la alta guiada (paso 3). Desde el SQLite
 * local (T3.1/R5.4; catálogo global sincronizado por catalog_categories). Multi-tenant (CLAUDE.md
 * ppio 6): NUNCA se hardcodea el systemId ni los codes — salen del sistema del rodeo activo.
 *
 * No filtra por sexo (la tabla no tiene columna de sexo): el filtrado por sexo lo hace el cliente
 * con el mapeo conocido por `code` (codes fijos del catálogo de cría). Devuelve todas las del
 * sistema; el screen las filtra. Orden por sort_order (presentación estable del catálogo).
 */
export async function fetchSystemCategories(
  systemId: string,
): Promise<ServiceResult<SystemCategory[]>> {
  const r = await runLocalQuery<CategoryRow>(buildSystemCategoriesQuery(systemId));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map((row) => ({ code: row.code, name: row.name })) };
}

// ─── Motor find-or-create — puerta MANUAL (R3) ───────────────────────────────────────

/**
 * Resultado del lookup manual (R3). Solo la rama MANUAL (R3.3): la rama BLE (R3.3 tag) es de
 * spec 04 y NO se implementa acá.
 *   - found:true, mode:'edit'  → hay match único activo → abrir ficha/EDIT (R3.2).
 *   - found:false, mode:'create' → no hay match → CREATE con el id precargado (R3.3 manual).
 */
export type LookupResult =
  | { found: true; mode: 'edit'; profileId: string }
  | { found: false; mode: 'create'; prefilled: { idv?: string; visual?: string } };

/**
 * Motor find-or-create de la PUERTA MANUAL (R3, R1.3/R1.4). Recibe el texto que el operario tipeó.
 * Lookup (R5): exacto por IDV (numérico) → fuzzy por visual. Si encuentra UN match activo → 'edit'
 * con ese profileId (R3.2). Si no → 'create' con el identificador precargado en el campo que
 * corresponde por la heurística R1.4 (classifyIdentifier vía searchAnimals + classifySearchQuery).
 *
 * NOTA: la rama TAG/BLE de R3.3 (asignar a animal sin caravana / pantalla intermedia) es de
 * spec 04/09-resto; en la puerta manual de C2 no aplica (el operario tipea idv o visual, no
 * bastonea un TAG). Por eso aun si el texto tiene forma de TAG (15 díg), lo tratamos como IDV
 * tipeado para el match exacto, y el precargado del no-match cae en idv (numérico) por R1.4.
 */
export async function findOrCreateLookup(
  identifier: string,
  establishmentId: string,
): Promise<ServiceResult<LookupResult>> {
  const result = await searchAnimals(establishmentId, identifier);
  if (!result.ok) return result;

  // Match: si hay exactamente uno, vamos directo a EDIT. Si hay varios (fuzzy ambiguo), el caller
  // (el screen) muestra la lista de resultados y el operario elige; acá, para el lookup directo
  // del CTA, tratamos "1 match" como edit y "0 match" como create. El screen ya renderiza la lista
  // para el caso de varios (no llama a findOrCreateLookup en ese caso, usa searchAnimals).
  if (result.value.length === 1) {
    return { ok: true, value: { found: true, mode: 'edit', profileId: result.value[0].profileId } };
  }

  // No-match (o múltiple-ambiguo del CTA directo) → CREATE con el id precargado (heurística R1.4).
  const kind = classifyIdentifier(identifier);
  const trimmed = identifier.trim();
  const prefilled = kind === 'idv' ? { idv: trimmed } : { visual: trimmed };
  return { ok: true, value: { found: false, mode: 'create', prefilled } };
}

// ─── Alta (R4.6) — split insert + select ─────────────────────────────────────────────

export type CreateAnimalInput = {
  establishmentId: string;
  rodeoId: string;
  /** system_id del rodeo (para resolver category_id por code). */
  systemId: string;
  sex: AnimalSex;
  /**
   * code de la categoría ELEGIDA por el usuario en el wizard (paso 3, alta guiada A). Reemplaza a la
   * computada: se resuelve a category_id por (systemId, code). En vez de computar siempre la
   * categoría del sexo+edad, el screen elige una del catálogo del sistema → la mandamos acá.
   */
  categoryCode: string;
  /**
   * ¿La categoría elegida debe PRESERVARSE (override) frente al recálculo del server? Lo decide el
   * screen con categoryOverrideFor (coincide con la computada → false; difiere → true). Se setea
   * en animal_profiles.category_override.
   */
  categoryOverride: boolean;
  /** ISO 'YYYY-MM-DD' o null. */
  birthDate?: string | null;
  /** Identificadores (al menos uno debe venir no vacío — lo garantiza el precargado de R4.2). */
  tagElectronic?: string | null;
  idv?: string | null;
  visualIdAlt?: string | null;
  breed?: string | null;
  coatColor?: string | null;
  entryDate?: string | null;
  entryWeight?: number | null;
  /** Lote opcional (ADR-020). */
  managementGroupId?: string | null;
  /**
   * Estado de dientes (boca) — columna `teeth_state` (enum teeth_state_enum, 0020). Solo lo pide la
   * alta guiada para vacas (2º serv/multípara) y toros (sub-chunk B, dominio §2). Selector CERRADO →
   * siempre un enum válido. Omitido si no aplica a la categoría o no se eligió.
   */
  teethState?: string | null;
  /**
   * Cría al pie — columna `nursing` (boolean, 0061). La alta guiada lo pide para vacas con servicio
   * (2º serv/multípara). El cliente puede setearla en el INSERT (el trigger de nursing es AFTER INSERT
   * sobre reproductive_events/birth_calves, NO sobre animal_profiles → no pisa este valor inicial). Si
   * no se capturó (no aplica o sin elegir), se omite y queda el default false NOT NULL.
   */
  nursing?: boolean | null;
};

/**
 * Crea un animal nuevo: `animals` (global) + `animal_profiles` (presencia en el campo), R4.6.
 *
 * ⚠️ SPLIT insert + select — NO usar `.insert().select()` (RLS-on-RETURNING, lección B.1.2/C1):
 *   el RETURNING evalúa la policy de SELECT sobre la fila antes de que sea visible → riesgo de
 *   403. Generamos los UUID en el CLIENTE (como el helper createAnimal de la suite backend): un
 *   animal recién insertado es invisible vía RLS hasta que existe su perfil (animals_select deriva
 *   de la presencia de un perfil con has_role_in), así que NO se puede re-seleccionar por TAG.
 *   Generar los ids resuelve el find-or-create y replica cómo un cliente real opera.
 *
 * Categoría inicial (R4.7 / alta guiada A): la ELIGE el usuario en el wizard (paso 3) — recibimos su
 * `code` + el `categoryOverride` ya decidido por el screen (coincide con la computada → false;
 * difiere → true). Resolvemos category_id por (systemId, code) y seteamos category_override en el
 * perfil. NO se puede llamar compute_category(profile_id) porque el perfil aún no existe y
 * category_id es NOT NULL.
 *
 * Atomicidad: si el insert del perfil falla (ej. unique de IDV), el `animals` ya quedó insertado
 * pero SIN perfil → invisible por RLS y sin TAG-colisión persistente si el fallo fue del perfil.
 * En MVP (online, sin transacción cross-tabla desde el cliente) esto es aceptable: el animal
 * huérfano no aparece en ninguna lista (no tiene perfil) y no bloquea reintentar (el TAG, si vino,
 * sí quedó tomado — por eso el caller debe mostrar el error de duplicate_tag y el operario corrige).
 * Si el insert de animals falla (duplicate_tag), no se inserta nada del perfil. La transacción
 * atómica real llega con PowerSync/RPC (C5); documentado.
 */
export async function createAnimal(
  input: CreateAnimalInput,
): Promise<ServiceResult<{ profileId: string; animalId: string }>> {
  // OFFLINE-FIRST (T6.2f): el alta es una op (b) RPC-bound (2 inserts cross-tabla animals→animal_profiles,
  // no atómicos online). Va por la OUTBOX: se encola la intención `create_animal` (con los 2 payloads + ids
  // de cliente) + el efecto optimista en el overlay (pending_animals + pending_animal_profiles). El alta
  // aparece en la lista/ficha al instante, OFFLINE; al SUBIR, uploadData aplica 2 upserts idempotentes
  // (ON CONFLICT por PK → un reintento at-least-once NO duplica, R6.10). NO hay RPC create_animal en el
  // schema as-built → el "orden atómico en uploadData" (animals primero) reemplaza la RPC (design §5.3.1).
  // La firma pública (ServiceResult<{profileId, animalId}>) NO cambia (R11.1).

  // 1) Resolver category_id por (system, code) DESDE LOCAL (catálogo sincronizado). No hardcodeamos UUID;
  //    el code viene del picker (paso 3), que lo sacó de fetchSystemCategories (local).
  const catRes = await runLocalQuerySingle<{ id: string }>(
    buildCategoryIdByCodeQuery(input.systemId, input.categoryCode),
    { emptyIsSyncing: true },
  );
  if (!catRes.ok) return { ok: false, error: { kind: catRes.error.kind, message: catRes.error.message } };
  if (!catRes.value) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo determinar la categoría del animal.' },
    };
  }

  // 2) Resolver species_id del rodeo DESDE LOCAL (animals.species_id NOT NULL; deriva del rodeo, ya
  //    sincronizado). No hardcodeamos bovino.
  const rodeoRes = await runLocalQuerySingle<{ species_id: string }>(
    buildRodeoSpeciesQuery(input.rodeoId),
    { emptyIsSyncing: true },
  );
  if (!rodeoRes.ok) return { ok: false, error: { kind: rodeoRes.error.kind, message: rodeoRes.error.message } };
  if (!rodeoRes.value) {
    return { ok: false, error: { kind: 'unknown', message: 'El rodeo seleccionado ya no está disponible.' } };
  }
  const speciesId = rodeoRes.value.species_id;
  const categoryId = catRes.value.id;

  // 3) Payload de `animals` (id de cliente). Solo TAG si vino. birth_date opcional. Es lo que el upsert
  //    de uploadData aplicará (ON CONFLICT por id = idempotente).
  const animalId = randomUuid();
  const tag = cleanStr(input.tagElectronic);
  const birthDate = input.birthDate ? input.birthDate : null;
  const animalPayload: Record<string, unknown> = {
    id: animalId,
    sex: input.sex,
    species_id: speciesId,
  };
  if (tag) animalPayload.tag_electronic = tag;
  if (birthDate) animalPayload.birth_date = birthDate;

  // 4) Payload de `animal_profiles` (id de cliente). category_id NOT NULL. created_by / la identidad
  //    denormalizada (animal_*) los FUERZA el trigger server-side al subir (NO se mandan, igual que online).
  const profileId = randomUuid();
  const idv = cleanStr(input.idv);
  const visual = cleanStr(input.visualIdAlt);
  const breed = cleanStr(input.breed);
  const coat = cleanStr(input.coatColor);
  const teeth = cleanStr(input.teethState);
  const profilePayload: Record<string, unknown> = {
    id: profileId,
    animal_id: animalId,
    establishment_id: input.establishmentId,
    rodeo_id: input.rodeoId,
    category_id: categoryId,
    category_override: input.categoryOverride,
    status: 'active',
  };
  if (idv) profilePayload.idv = idv;
  if (visual) profilePayload.visual_id_alt = visual;
  if (breed) profilePayload.breed = breed;
  if (coat) profilePayload.coat_color = coat;
  if (input.entryDate) profilePayload.entry_date = input.entryDate;
  if (input.entryWeight != null) profilePayload.entry_weight = input.entryWeight;
  if (input.managementGroupId) profilePayload.management_group_id = input.managementGroupId;
  if (teeth) profilePayload.teeth_state = teeth;
  if (input.nursing != null) profilePayload.nursing = input.nursing;

  // 5) Encolar: intención create_animal (los 2 payloads) + overlay optimista. El overlay del perfil lleva
  //    la identidad DENORMALIZADA (animal_*) para que la lista/ficha la muestren offline (b1) — la fila
  //    sincronizada la rellenará el trigger al subir. created_by null en el overlay (el real lo pone el
  //    trigger; la ficha tolera null en createdBy).
  const enq = await enqueueCreateAnimal({
    animalId,
    profileId,
    params: { animals: animalPayload, animal_profiles: profilePayload },
    overlay: {
      animal: { tagElectronic: tag, speciesId, sex: input.sex, birthDate },
      profile: {
        animalId,
        establishmentId: input.establishmentId,
        rodeoId: input.rodeoId,
        managementGroupId: input.managementGroupId ?? null,
        idv,
        visualIdAlt: visual,
        categoryId,
        categoryOverride: input.categoryOverride,
        breed,
        coatColor: coat,
        entryDate: input.entryDate ?? null,
        entryWeight: input.entryWeight ?? null,
        status: 'active',
        createdBy: null,
        animalTagElectronic: tag,
        animalSex: input.sex,
        animalBirthDate: birthDate,
        createdAt: new Date().toISOString(),
      },
    },
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };

  return { ok: true, value: { profileId, animalId } };
}

// ─── Detalle para la ficha básica (R5 — versión básica de C2) ─────────────────────────

// Fila cruda del SQLite local (shape PLANO; b1: identidad desde animal_profiles).
type LocalDetailRow = {
  id: string;
  animal_id: string;
  establishment_id: string;
  idv: string | null;
  visual_id_alt: string | null;
  category_id: string;
  category_override: number | boolean;
  breed: string | null;
  coat_color: string | null;
  entry_date: string | null;
  entry_weight: number | null;
  status: AnimalStatus;
  created_by: string | null;
  exit_date: string | null;
  exit_reason: string | null;
  rodeo_id: string;
  management_group_id: string | null;
  tag_electronic: string | null;
  sex: AnimalSex | null;
  birth_date: string | null;
  rodeo_name: string | null;
  category_code: string | null;
  category_name: string | null;
  management_group_name: string | null;
};

/**
 * Lee el detalle de un animal_profile para la ficha básica (C2), desde el SQLite local (T4.1): identidad
 * + atributos + rodeo + categoría + lote. El scoping (has_role_in) ya lo aplicó la stream
 * est_animal_profiles. El timeline + eventos son C3 (NO se traen acá). El lote (management_groups)
 * puede estar soft-deleted → el LEFT JOIN lo trae igual si la fila existe (la UI muestra "sin lote" si
 * management_group_id es null).
 *
 * b1 (ADR-026): la identidad (tag/sex/birth_date) sale de las columnas denormalizadas de
 * animal_profiles, NO de un JOIN a `animals` (que no se sincroniza). `category_override` viene 0/1 de
 * SQLite → toBool lo coerce al boolean del shape público. emptyIsSyncing:false ("no encontrado" es un
 * resultado de negocio válido que el caller ya maneja — no degrada a "Sincronizando").
 */
export async function fetchAnimalDetail(profileId: string): Promise<ServiceResult<AnimalDetail>> {
  const r = await runLocalQuerySingle<LocalDetailRow>(buildAnimalDetailQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.value) {
    return { ok: false, error: { kind: 'unknown', message: 'No se encontró el animal. Puede que ya no tengas acceso.' } };
  }
  const row = r.value;
  return {
    ok: true,
    value: {
      profileId: row.id,
      animalId: row.animal_id,
      establishmentId: row.establishment_id,
      idv: row.idv,
      visualIdAlt: row.visual_id_alt,
      tagElectronic: row.tag_electronic,
      sex: row.sex ?? 'female',
      birthDate: row.birth_date,
      categoryCode: row.category_code ?? '',
      categoryName: row.category_name ?? '',
      categoryOverride: toBool(row.category_override),
      breed: row.breed,
      coatColor: row.coat_color,
      entryDate: row.entry_date,
      entryWeight: row.entry_weight,
      status: row.status,
      createdBy: row.created_by,
      exitDate: row.exit_date,
      exitReason: row.exit_reason,
      rodeoId: row.rodeo_id,
      rodeoName: row.rodeo_name ?? '',
      managementGroupId: row.management_group_id,
      managementGroupName: row.management_group_name,
    },
  };
}

// ─── Baja / egreso de animal (R4.14 / R14.9, C3.3) ───────────────────────────────────

export type ExitAnimalInput = {
  /** El animal_profile a dar de baja. */
  profileId: string;
  /** Status de egreso resuelto del motivo (sold|dead|transferred). NUNCA 'active' (el RPC lo rechaza). */
  status: ExitStatus;
  /** exit_reason resuelto del motivo (sale|death|transfer en MVP). */
  exitReason: ExitReasonChoice;
  /** Fecha de egreso 'YYYY-MM-DD'. */
  exitDate: string;
  /** Peso de salida en kg (opcional, SOLO Venta — analytics). */
  exitWeight?: number | null;
  /** Precio de salida en $ (opcional, SOLO Venta — analytics). */
  exitPrice?: number | null;
};

/**
 * Da de baja (egreso) un animal_profile vía el RPC `exit_animal_profile` (migration 0044). NO es
 * soft-delete: el perfil queda archivado y visible en historial (deleted_at NULL), pero sale del
 * rodeo activo por el filtro status='active' de las queries operativas (R4.12/R4.15).
 *
 * OFFLINE-FIRST (T6.2f): es una op (b) RPC-bound → va por la OUTBOX. Se encola la intención
 * `exit_animal_profile` (con los params de la RPC) + el efecto optimista en el overlay
 * pending_status_overrides (effect='exited', status). La lista activa OCULTA el animal y la ficha marca
 * el status al instante, OFFLINE; al SUBIR, uploadData llama supabase.rpc('exit_animal_profile', ...). La
 * idempotencia es NATURAL (transición de status, §5.4.3(2) — sin delta): un reintento re-aplica el mismo
 * end-state. La firma pública (ServiceResult<void>) NO cambia (R11.1).
 *
 * Authz: el RPC enforça server-side `has_role_in(est) AND (is_owner_of(est) OR created_by=auth.uid())`
 * (R4.14, SEC-SPEC-01) al SUBIR — la barrera real. Un rechazo (42501) lo maneja uploadData (rollback del
 * overlay + descarte + superficia, R8.1): el animal RE-APARECE en la lista y la baja se revierte.
 *
 * Los nombres de params son los del SQL (p_profile_id, p_status, …). exit_weight/exit_price se mandan
 * siempre (null explícito si no vinieron → el RPC los coalesce: null no pisa un valor previo).
 */
export async function exitAnimalProfile(input: ExitAnimalInput): Promise<ServiceResult<void>> {
  const enq = await enqueueExitAnimal({
    profileId: input.profileId,
    status: input.status,
    exitDate: input.exitDate,
    params: {
      p_profile_id: input.profileId,
      p_status: input.status,
      p_exit_reason: input.exitReason,
      p_exit_date: input.exitDate,
      p_exit_weight: input.exitWeight ?? null,
      p_exit_price: input.exitPrice ?? null,
    },
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };
  return { ok: true, value: undefined };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

/** Trim → null si queda vacío (para no mandar strings vacíos a columnas opcionales). */
function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** UUID v4. crypto.randomUUID está en RN (Hermes), web y Node — sin dependencia extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
