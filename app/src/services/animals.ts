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

import {
  type AnimalSex,
  type CategoryCatalogEntry,
  type DisplayCategory,
  type ReproEventInput,
  computeCategoryCode,
  computeDisplayOverrides,
  resolveCastrationTargetCategory,
} from '../utils/animal-category';
import { classifyIdentifier, classifySearchQuery } from '../utils/animal-identifier';
import { castrationObservationText } from '../utils/castration-copy';
import {
  type ExitReasonChoice,
  type ExitStatus,
} from './exit-animal';
import {
  buildSystemCategoriesQuery,
  buildAnimalsListQuery,
  buildAnimalsCountQuery,
  buildSearchByTagQuery,
  buildLookupTagAcrossFieldsQuery,
  buildSearchByIdvQuery,
  buildSearchLikeQuery,
  buildAnimalDetailQuery,
  buildCategoryIdByCodeQuery,
  buildCategoryByCodeQuery,
  buildCategoryMirrorEventsQuery,
  buildRevertCategoryOverrideUpdate,
  buildRodeoSpeciesQuery,
  buildSetCastratedUpdate,
  buildSetFutureBullUpdate,
  buildAddObservationInsert,
  buildProfileEstablishmentQuery,
  toBool,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle, runLocalWrite } from './powersync/local-query';
import { enqueueCreateAnimal, enqueueExitAnimal } from './powersync/outbox';
import { assertOnline } from './powersync/online-guard';
import { supabase } from './supabase';
import {
  type TransferAnimalInput,
  type TransferAnimalResult,
  type TransferAnimalRpcRow,
  classifyTransferError,
  mapTransferResult,
  TRANSFER_OFFLINE_MESSAGE,
} from './transfer-animal';
import {
  type TagLookupResult,
  type CrossFieldTagRow,
  resolveTagLookup,
} from './tag-lookup';

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
  /**
   * Fecha de nacimiento denormalizada (animal_profiles.animal_birth_date, b1 — ISO 'YYYY-MM-DD' o null).
   * spec 10 (T-UI.1/T-UI.3 / R11.9): alimenta la EDAD de la fila compacta de la vista de grupo. La tab
   * Animales no la usa (la fila grande no muestra edad) — es campo extra inofensivo.
   */
  animalBirthDate: string | null;
  /**
   * ⭐ futuro torito (animal_profiles.future_bull, 0085 — spec 10 R12.3). Lo usa la fila compacta de la
   * vista de grupo para el badge (solo positivo, oculto en `toro`). 0 en el overlay (alta nace sin flag).
   */
  futureBull: boolean;
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
  /**
   * is_castrated REAL del perfil (animal_profiles.is_castrated, denormalizado 0084 — spec 10 R13.3). Lo
   * usa la ficha para la fila "Castrado Sí/No" (R13.1) y la confirmación que anticipa el recálculo. El
   * espejo C6 ya lo refleja en categoryCode/categoryName cuando override=false (R13.6) — este campo es el
   * ESTADO crudo para el toggle, no la categoría derivada.
   */
  isCastrated: boolean;
  /**
   * future_bull del perfil (animal_profiles.future_bull, 0085 — spec 10 R12.1). "Futuro torito": solo
   * machos, badge ⭐ (R12.3), toggle desde la ficha (R12.2/setFutureBull). Auto-clear al castrar (R12.4).
   */
  futureBull: boolean;
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
  // C6 (RC6.3.1/RC6.3.2): inputs del espejo de categoría — proyectados por LOCAL_LIST_SELECT, consumidos
  // SOLO por applyCategoryMirror (el shape público AnimalListItem no los expone).
  category_override?: number | boolean | null;
  birth_date?: string | null;
  system_id?: string | null;
  // spec 10 (T-CL.12 / R13.6): is_castrated REAL (0084) — input del espejo con precedencia. No se expone
  // en AnimalListItem (lo descarta el mapper); lo lee SOLO computeMirrorOverrides.
  is_castrated?: number | boolean | null;
  // spec 10 (T-UI.1/T-UI.3 / R12.3): future_bull (0085) — badge ⭐ de la fila compacta de la vista de
  // grupo. Proyectado por LOCAL_LIST_SELECT (overlay = 0 constante). Lo expone AnimalListItem.
  future_bull?: number | boolean | null;
};

function toLocalListItem(
  r: LocalListRow,
  // C6 (RC6.3.2): si el espejo derivó una categoría para esta fila (override=false), pisa code/name en
  // memoria; sin override → la guardada. Display-only, sin tocar el shape público.
  mirror?: { code: string; name: string },
): AnimalListItem {
  return {
    profileId: r.id,
    animalId: r.animal_id,
    idv: r.idv,
    visualIdAlt: r.visual_id_alt,
    tagElectronic: r.tag_electronic,
    categoryCode: mirror?.code ?? r.category_code ?? '',
    categoryName: mirror?.name ?? r.category_name ?? '',
    sex: r.sex ?? 'female',
    rodeoId: r.rodeo_id,
    rodeoName: r.rodeo_name ?? '',
    status: r.status,
    managementGroupId: r.management_group_id,
    animalBirthDate: r.birth_date ?? null,
    futureBull: toBool(r.future_bull ?? 0),
  };
}

// ─── Espejo de categoría display-only (C6 / RC6.3) ───────────────────────────────────
//
// Inyecta, EN LA CAPA SERVICE, la categoría DERIVADA localmente por el espejo de compute_category
// (computeCategoryCode, animal-category.ts) cuando `category_override = false`. Lo heredan TODAS las
// superficies (lista, búsqueda find-or-create, ficha) sin tocar componentes — el shape público
// (categoryCode/categoryName) NO cambia, solo su VALOR en memoria (RC6.3.5: CERO writes).
//
// Cuándo NO toca la fila:
//   - `category_override = true` → la guardada manda (RC6.3.3).
//   - code derivado sin fila en el catálogo local del sistema, o sin system_id → fail-safe a la
//     guardada (RC6.3.4: nunca blanco, nunca crash).
//
// Todo del SQLite local (RC6.3.6, cero red): los inputs ya vienen proyectados en la fila
// (category_override/birth_date/system_id/sex); los eventos se leen batched de reproductive_events +
// el overlay (buildCategoryMirrorEventsQuery); el catálogo code→name por system_id distinto
// (buildSystemCategoriesQuery, ya existente). En el MVP el campo opera UN sistema (bovino/cría) → un
// solo catálogo; el código soporta varios system_id por las dudas.

/** Forma mínima de una fila para el espejo (la cumplen LocalListRow y LocalDetailRow). */
type MirrorableRow = {
  id: string;
  sex: AnimalSex | null;
  birth_date?: string | null;
  system_id?: string | null;
  category_override?: number | boolean | null;
  category_code: string | null;
  category_name: string | null;
  // spec 10 (T-CL.7/T-CL.12 / R13.6): is_castrated REAL denormalizado (0084), proyectado por los SELECT
  // de local-reads (0/1 de SQLite). El espejo lo pasa con PRECEDENCIA a computeDisplayOverrides — cuando
  // viene definido, la inferencia RC6.2.1 queda como fallback. undefined/null → fallback (cero regresión).
  is_castrated?: number | boolean | null;
};

/**
 * Capa de I/O del espejo de display: lee del SQLite local los eventos batched + el catálogo code→name de
 * cada system, y delega la DECISIÓN al núcleo PURO `computeDisplayOverrides` (animal-category.ts) — que no
 * puede escribir nada (RC6.3.5, propiedad estructural). Devuelve un Map profileId → { code, name } para
 * las filas que el espejo aplica (override=false + system con catálogo); las demás quedan con la guardada.
 * Fail-safe: si una lectura local falla, las filas afectadas se omiten del Map (muestran la guardada),
 * nunca rompe la vista.
 *
 * Las dos únicas operaciones de DB acá son SELECT (runLocalQuery). NUNCA un execute/write (RC6.3.5).
 */
async function computeMirrorOverrides(
  rows: readonly MirrorableRow[],
): Promise<Map<string, DisplayCategory>> {
  // 1) Filas candidatas: override=false (la guardada manda si true) + con system_id (sin él no se puede
  //    resolver code→name; el núcleo puro hace fail-safe a la guardada igual). El profileId = row.id.
  const candidates = rows.filter((r) => !toBool(r.category_override) && r.system_id);
  if (candidates.length === 0) return new Map();

  const profileIds = candidates.map((r) => r.id);

  // 2) Eventos reproductivos batched (synced + overlay) de todos los candidatos, ya ordenados por
  //    (event_date, created_at) por el SQL. emptyIsSyncing:false → "sin eventos" es legítimo (no degrada).
  const eventsRes = await runLocalQuery<{
    animal_profile_id: string;
    event_type: string;
    event_date: string;
    created_at: string | null;
    pregnancy_status: string | null;
  }>(buildCategoryMirrorEventsQuery(profileIds), { emptyIsSyncing: false });
  if (!eventsRes.ok) return new Map(); // fail-safe: sin eventos legibles, no derivamos (muestra guardada)

  // Agrupa los eventos por perfil, preservando el orden de la query (ORDER BY event_date, created_at).
  const eventsByProfile = new Map<string, ReproEventInput[]>();
  for (const e of eventsRes.value) {
    const list = eventsByProfile.get(e.animal_profile_id) ?? [];
    list.push({
      eventType: e.event_type,
      eventDate: e.event_date,
      createdAt: e.created_at,
      pregnancyStatus: e.pregnancy_status,
    });
    eventsByProfile.set(e.animal_profile_id, list);
  }

  // 3) Catálogo code→name por cada system_id DISTINTO de los candidatos (MVP: uno solo).
  const catalogBySystem = new Map<string, CategoryCatalogEntry[]>();
  const systemIds = [...new Set(candidates.map((r) => r.system_id as string))];
  for (const sysId of systemIds) {
    const catRes = await runLocalQuery<CategoryCatalogEntry>(buildSystemCategoriesQuery(sysId), {
      emptyIsSyncing: false,
    });
    catalogBySystem.set(sysId, catRes.ok ? catRes.value : []);
  }

  // 4) Decisión PURA (sin I/O): por candidato usa el is_castrated REAL (T-CL.7/T-CL.12 / R13.6) con
  //    PRECEDENCIA sobre la inferencia, computa la derivada y resuelve el display contra el catálogo
  //    (fail-safe a la guardada si no resuelve). Esto COMPLETA el cableado de T-CL.7: hasta ahora el
  //    caller no pasaba `isCastrated` → el espejo caía al fallback inferIsCastrated; ahora los SELECT de
  //    local-reads proyectan `is_castrated` (0084) → la castración offline da `novillito` SIN sync (R10.6).
  return computeDisplayOverrides(
    candidates.map((r) => ({
      profileId: r.id,
      sex: r.sex,
      birthDate: r.birth_date ?? null,
      systemId: r.system_id ?? null,
      categoryOverride: false, // candidates ya filtró override=false
      storedCode: r.category_code ?? '',
      storedName: r.category_name ?? '',
      // is_castrated REAL: solo lo pasamos cuando la fila lo PROYECTA (no undefined). Si una fila legacy
      // no lo trae, queda undefined → computeDisplayOverrides cae al fallback inferIsCastrated (R13.6).
      isCastrated: r.is_castrated == null ? undefined : toBool(r.is_castrated),
    })),
    eventsByProfile,
    catalogBySystem,
  );
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
  // C6 (RC6.3.2): espejo de categoría display-only — la lista muestra la categoría derivada localmente
  // cuando override=false (incluye eventos cargados offline). Cero writes (RC6.3.5).
  const overrides = await computeMirrorOverrides(r.value);
  return { ok: true, value: r.value.map((row) => toLocalListItem(row, overrides.get(row.id))) };
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
  // Acumulamos las FILAS CRUDAS deduplicadas (los exactos priorizados arriba); el espejo de categoría +
  // el mapeo a AnimalListItem se hacen UNA vez al final sobre el set deduplicado (C6: una sola pasada del
  // espejo batched, en vez de por sub-query).
  const rawRows: LocalListRow[] = [];

  // 1) TAG exacto (b1: animal_profiles.animal_tag_electronic) — solo si el texto tiene forma de
  //    caravana FDX-B. Priorizado arriba: un escaneo exacto de 15 díg es el match más fuerte.
  if (plan.tryTag) {
    const r = await runLocalQuery<LocalListRow>(
      buildSearchByTagQuery(establishmentId, plan.compact),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    pushLocalRows(r.value, seen, rawRows);
  }

  // 2) IDV exacto (animal_profiles.idv) — solo si el texto es numérico. Priorizado sobre el
  //    substring (el operario que tipea el IDV completo ve su animal primero).
  if (plan.tryIdv) {
    const r = await runLocalQuery<LocalListRow>(
      buildSearchByIdvQuery(establishmentId, plan.compact),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    pushLocalRows(r.value, seen, rawRows);
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
    pushLocalRows(idvRes.value, seen, rawRows);

    const tagRes = await runLocalQuery<LocalListRow>(
      buildSearchLikeQuery(establishmentId, 'animal_tag_electronic', plan.compact),
      { emptyIsSyncing: false },
    );
    if (!tagRes.ok) return { ok: false, error: tagRes.error };
    pushLocalRows(tagRes.value, seen, rawRows);
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
    pushLocalRows(r.value, seen, rawRows);
  }

  // C6 (RC6.3.2): mismo espejo que la lista — la búsqueda find-or-create muestra la categoría derivada
  // localmente cuando override=false. Una sola pasada batched sobre el set deduplicado. Cero writes.
  const overrides = await computeMirrorOverrides(rawRows);
  return { ok: true, value: rawRows.map((row) => toLocalListItem(row, overrides.get(row.id))) };
}

/** Acumula las filas crudas deduplicadas por profileId (los exactos priorizados se agregan primero). */
function pushLocalRows(
  rows: LocalListRow[] | null,
  seen: Set<string>,
  out: LocalListRow[],
): void {
  for (const r of rows ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
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

// ─── Motor find-or-create — rama BLE / TAG bastoneado (spec 09 chunk BLE global, RB4) ────────

// El tipo del resultado vive en tag-lookup.ts (módulo PURO, testeable sin SDK) y se RE-EXPORTA acá para
// que el contrato público "el tipo vive en animals.ts" se cumpla (mismo patrón que TransferAnimalInput).
export type { TagLookupResult } from './tag-lookup';

/**
 * Resuelve un EID BASTONEADO (ya validado + des-duplicado por el provider de spec 04) a uno de tres modos
 * (RB4.1-RB4.5 / design §3.2), íntegramente sobre PowerSync local (SQLite), SIN red (offline-first; el set
 * sincronizado ya incluye TODOS los campos del usuario por spec 15):
 *   - `edit`     → hay un perfil ACTIVO con ese TAG en el campo ACTIVO (RB4.3).
 *   - `transfer` → no en el campo activo pero SÍ activo en OTRO campo del usuario (RB4.4 / DEC-3, spec 11).
 *   - `create`   → sin match en ningún campo (RB4.5 / DEC-2, DIRECTO a CREATE con el TAG precargado).
 *
 * Dos lecturas locales (la decisión la toma `resolveTagLookup`, PURA):
 *   1. `buildSearchByTagQuery(establishmentId, tag)` (ya existe; UNION synced+overlay, status='active',
 *      scopeada al campo activo) → rama EDIT.
 *   2. SOLO si la rama 1 vino vacía: `buildLookupTagAcrossFieldsQuery(tag)` (cross-campo, sin filtro de
 *      establishment) → rama TRANSFER (otro campo) o CREATE (nada).
 *
 * Multi-tenant (CLAUDE.md ppio 6): el establishmentId llega por param (contexto activo), NUNCA hardcodeado.
 * emptyIsSyncing:false en ambas: "no hay match" es un resultado de negocio LEGÍTIMO (= create), no una
 * degradación a "Sincronizando" — un EID nuevo no debe quedar trabado pidiendo sync.
 */
export async function lookupByTag(
  tag: string,
  establishmentId: string,
): Promise<ServiceResult<TagLookupResult>> {
  // Rama 1 — campo ACTIVO (reusa la query exacta por TAG ya scopeada). emptyIsSyncing:false: vacío = no hay
  // match en este campo (caso de negocio), no "sincronizando".
  const activeRes = await runLocalQuery<{ id: string }>(
    buildSearchByTagQuery(establishmentId, tag),
    { emptyIsSyncing: false },
  );
  if (!activeRes.ok) return { ok: false, error: activeRes.error };

  // Si ya hay match en el campo activo, NO hace falta la query cross-campo (corta-circuito → EDIT).
  if (activeRes.value.length > 0) {
    return {
      ok: true,
      value: resolveTagLookup({
        activeFieldRows: activeRes.value,
        crossFieldRows: [],
        establishmentId,
      }),
    };
  }

  // Rama 2/3 — sin match en el campo activo: buscamos cross-campo (otro campo del usuario → transfer; nada
  // → create). emptyIsSyncing:false: vacío = no está en ningún campo (= create), no "sincronizando".
  const crossRes = await runLocalQuery<CrossFieldTagRow>(
    buildLookupTagAcrossFieldsQuery(tag),
    { emptyIsSyncing: false },
  );
  if (!crossRes.ok) return { ok: false, error: crossRes.error };

  return {
    ok: true,
    value: resolveTagLookup({
      activeFieldRows: [],
      crossFieldRows: crossRes.value,
      establishmentId,
    }),
  };
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
 * Atomicidad (as-built Run create-animal-rpc, 2026-06-10): el alta se persiste vía la RPC ATÓMICA
 * `create_animal` (0083) al drenar la outbox — una sola transacción server-side (animals + perfil),
 * sin half-state posible. Si el perfil falla (ej. unique de IDV), TODA la RPC aborta (tampoco queda
 * el animals; el TAG no queda tomado) y uploadData rollbackea el overlay + superficia. El camino
 * viejo (2 upserts no atómicos) dejaba huérfanos y PERDÍA el alta bajo reintento (backlog 2026-06-10);
 * la RPC además sana esos huérfanos preexistentes (ON CONFLICT (id) DO NOTHING).
 */
export async function createAnimal(
  input: CreateAnimalInput,
): Promise<ServiceResult<{ profileId: string; animalId: string }>> {
  // OFFLINE-FIRST (T6.2f): el alta es una op (b) RPC-bound (2 inserts cross-tabla animals→animal_profiles).
  // Va por la OUTBOX: se encola la intención `create_animal` (con los 2 payloads + ids de cliente) + el
  // efecto optimista en el overlay (pending_animals + pending_animal_profiles). El alta aparece en la
  // lista/ficha al instante, OFFLINE; al SUBIR, uploadData la mapea a la RPC ATÓMICA `create_animal`
  // (0083, Run create-animal-rpc): una sola transacción server-side, idempotente por los ids de cliente
  // (ON CONFLICT (id) DO NOTHING → un reintento at-least-once NO duplica, R6.10) y sin half-state posible
  // (el camino viejo de 2 upserts no atómicos perdía el alta bajo reintento — backlog 2026-06-10).
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

  // 3) Payload de `animals` (id de cliente). Solo TAG si vino. birth_date opcional. uploadData lo traduce
  //    a los args de la RPC create_animal (0083; ON CONFLICT por id = idempotente).
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
  // C6 (RC6.3.1): system_id del rodeo — para resolver el code derivado a name/id del catálogo local.
  system_id?: string | null;
  // spec 10 (T-CL.12): is_castrated REAL (0084, espejo C6 con precedencia) + future_bull (0085, badge ⭐).
  is_castrated?: number | boolean | null;
  future_bull?: number | boolean | null;
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
  // C6 (RC6.3.1): espejo de categoría display-only — la ficha muestra la categoría derivada localmente
  // cuando override=false (incluye eventos cargados offline). Cero writes (RC6.3.5). El badge del hero
  // sigue recibiendo categoryOverride sin tocar (RC6.4.1).
  const overrides = await computeMirrorOverrides([row]);
  const mirror = overrides.get(row.id);
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
      categoryCode: mirror?.code ?? row.category_code ?? '',
      categoryName: mirror?.name ?? row.category_name ?? '',
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
      // spec 10: estado crudo del perfil (0/1 de SQLite → boolean) para la ficha (R13.1 toggle, R12.3 badge).
      isCastrated: toBool(row.is_castrated ?? 0),
      futureBull: toBool(row.future_bull ?? 0),
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

// ─── Quitar fijación manual de categoría (C6 / RC6.4) ────────────────────────────────

/** Categoría AUTOMÁTICA resuelta del espejo para el revert: code derivado + id y name del catálogo local. */
type ResolvedRevertCategory = { derivedCode: string; categoryId: string; derivedName: string };

/**
 * Resolución COMPARTIDA del revert (C6 / RC6.4.3 + RC6.4.6): lee TODO del SQLite local (offline-safe) y
 * computa la categoría AUTOMÁTICA a la que volvería el animal al quitar la fijación — su `code` derivado
 * por el espejo + el `id` y el `name` legible del catálogo local. Es la ÚNICA fuente de la derivada: la
 * usan `previewRevertCategory` (mostrar la consecuencia ANTES de confirmar) y `revertCategoryOverride`
 * (ejecutar el UPDATE) ⇒ lo que se ANTICIPA en la confirmación es EXACTAMENTE la categoría a la que el
 * revert aterriza (no pueden divergir). 100% SELECT (sin write): el caller del revert hace el UPDATE.
 *
 * Pasos (todo LOCAL):
 *   1) detalle local (sex, birth_date, system_id). Sin animal o sin system_id → error es-AR (RC6.4.5);
 *   2) eventos reproductivos batched (synced + overlay) → `derivedCode = computeCategoryCode(...)` con
 *      is_castrated=FALSE (con override=true el code guardado es MANUAL → la inferencia no es confiable;
 *      HOY ningún write-path setea is_castrated=true → false espeja al server; header animal-category.ts);
 *   3) resuelve id+name por (system_id, derivedCode) en el catálogo local. Irresoluble → error es-AR
 *      accionable, SIN write (RC6.4.5: no escribir un category_id inválido — 0021 lo rechazaría con 23514).
 */
async function resolveRevertCategory(
  profileId: string,
): Promise<ServiceResult<ResolvedRevertCategory>> {
  // 1) Detalle local (sex, birth_date, system_id, category_code guardado). emptyIsSyncing:false: "no
  //    encontrado" es un caso de negocio.
  const detailRes = await runLocalQuerySingle<LocalDetailRow>(buildAnimalDetailQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!detailRes.ok) return { ok: false, error: detailRes.error };
  if (!detailRes.value) {
    return { ok: false, error: { kind: 'unknown', message: 'No se encontró el animal.' } };
  }
  const row = detailRes.value;
  const systemId = row.system_id ?? null;
  if (!systemId) {
    // Sin system_id no se puede resolver la categoría derivada → no ejecutar (RC6.4.5).
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No pudimos determinar la categoría automática. Probá de nuevo en unos segundos.' },
    };
  }

  // 2) Eventos reproductivos batched (synced + overlay) del perfil → derivada local.
  const eventsRes = await runLocalQuery<{
    animal_profile_id: string;
    event_type: string;
    event_date: string;
    created_at: string | null;
    pregnancy_status: string | null;
  }>(buildCategoryMirrorEventsQuery([profileId]), { emptyIsSyncing: false });
  if (!eventsRes.ok) return { ok: false, error: eventsRes.error };
  const events: ReproEventInput[] = eventsRes.value.map((e) => ({
    eventType: e.event_type,
    eventDate: e.event_date,
    createdAt: e.created_at,
    pregnancyStatus: e.pregnancy_status,
  }));

  // is_castrated=false al revertir (con override=true el code guardado es manual → la inferencia no es
  // confiable; hoy nada setea is_castrated=true → false espeja al server; documentado en el header).
  const derivedCode = computeCategoryCode({
    sex: row.sex ?? 'female',
    birthDate: row.birth_date ?? null,
    isCastrated: false,
    events,
  });

  // 3) Resolver el id+name de la derivada en el catálogo local del sistema. Irresoluble → error es-AR
  //    (RC6.4.5; el caller del revert NO escribe).
  const catRes = await runLocalQuerySingle<{ id: string; name: string }>(
    buildCategoryByCodeQuery(systemId, derivedCode),
    { emptyIsSyncing: false },
  );
  if (!catRes.ok) return { ok: false, error: catRes.error };
  if (!catRes.value) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'No pudimos calcular la categoría automática de este animal. Quitá la fijación cuando se sincronice el campo.',
      },
    };
  }

  return {
    ok: true,
    value: { derivedCode, categoryId: catRes.value.id, derivedName: catRes.value.name },
  };
}

/**
 * Anticipa la CONSECUENCIA del revert (C6 / RC6.4.6): devuelve el `name` legible de la categoría
 * AUTOMÁTICA a la que volvería el animal al quitar la fijación, para mostrarlo en la confirmación inline
 * ("La categoría pasará a …"). SOLO LECTURA (no escribe nada — es display, RC6.3.5): reusa
 * `resolveRevertCategory` ⇒ el name anticipado es EXACTAMENTE el de la categoría que `revertCategoryOverride`
 * va a escribir. Si la derivada NO es resoluble localmente (mismo caso que aborta el revert, RC6.4.5),
 * devuelve `ok:true, value:null` → la UI NO muestra la línea de consecuencia (el revert, si se intenta,
 * surfaceará el error real). Offline-safe (todo del SQLite local).
 */
export async function previewRevertCategory(
  profileId: string,
): Promise<ServiceResult<{ derivedCode: string; derivedName: string } | null>> {
  const r = await resolveRevertCategory(profileId);
  // Irresoluble (sin system_id / sin fila en el catálogo) → no anticipamos consecuencia (null): la línea
  // se omite y, si el usuario confirma igual, revertCategoryOverride muestra el error accionable real.
  if (!r.ok) return { ok: true, value: null };
  return { ok: true, value: { derivedCode: r.value.derivedCode, derivedName: r.value.derivedName } };
}

/**
 * Quita la fijación MANUAL de categoría (D2 / RC6.4.3): setea `category_override = false` Y
 * `category_id = <categoría DERIVADA por el espejo>` en UN ÚNICO UPDATE local sobre animal_profiles. El
 * cliente APORTA el valor recalculado (patrón as-built T2.5/T2.30): al SUBIR, el trigger `0040` ve el
 * revert en el mismo statement y lo respeta (no re-marca override); `0030` registra `revert_to_auto`;
 * `0021` re-valida la categoría contra el sistema del rodeo.
 *
 * La categoría derivada (code + id) la resuelve `resolveRevertCategory` (compartida con el preview de la
 * consecuencia, RC6.4.6) — todo LOCAL, OFFLINE-safe (RC6.4.4). Si la derivada no es resoluble → NO ejecuta
 * el revert + error es-AR accionable (RC6.4.5). El write es UN solo UPDATE local
 * (buildRevertCategoryOverrideUpdate): éxito local inmediato; la RLS `animal_profiles_update` es la barrera
 * real al subir (la autorización se valida ahí, no acá).
 *
 * Firma: ServiceResult<{ derivedCode }> (el caller recarga la ficha; no depende del valor, pero ayuda al
 * test/diagnóstico). NO recibe is_castrated ni la categoría — todo se deriva del estado local.
 */
export async function revertCategoryOverride(
  profileId: string,
): Promise<ServiceResult<{ derivedCode: string }>> {
  const resolved = await resolveRevertCategory(profileId);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  // UN solo UPDATE local: override=false + category_id derivada (mismo statement → un solo UPDATE al
  // subir → 0040 respeta el revert). Éxito local inmediato (offline-safe); RLS al subir.
  const writeRes = await runLocalWrite(
    buildRevertCategoryOverrideUpdate(profileId, resolved.value.categoryId),
  );
  if (!writeRes.ok) return { ok: false, error: { kind: writeRes.error.kind, message: writeRes.error.message } };

  return { ok: true, value: { derivedCode: resolved.value.derivedCode } };
}

// ─── Castración / futuro torito (spec 10, T-CL.11 — ficha) ───────────────────────────
//
// setCastrated es el write-path de castración DESDE LA FICHA (R13.1) — el mismo UPDATE de
// animal_profiles.is_castrated que usa la masiva (bulk-operations), pero de a uno. El UPDATE es el ÚNICO
// write-path offline (animal_profiles sincroniza; animals NO → write-through server-side 0084 §4.2 +
// recompute simétrico 0064/0086). La castración SIEMPRE encadena la observación automática (R13.7): UPDATE
// + INSERT animal_events = 2 CrudEntries INDEPENDIENTES (R10.2, sin transacción). setFutureBull NO genera
// observación (no es castración — design §3.3).

/**
 * Castra / des-castra un animal desde la ficha (R13.1 / R13.4). DOS escrituras locales independientes:
 *   (1) UPDATE animal_profiles.is_castrated = value (+ future_bull=0 si value=true, R12.4 auto-clear);
 *   (2) INSERT animal_events 'observacion' con el texto de R13.7 ("Castrado" / "Corrección: marcado como
 *       no castrado" — simetría) — author_id OMITIDO (lo fuerza el trigger 0034 al subir = usuario
 *       actual); establishment_id derivado del PERFIL (trigger de validación 0034, 23514 si no coincide).
 *
 * Offline-safe: ambos son CRUD plano sobre tablas SINCRONIZADAS (una CrudEntry cada uno → 2/animal,
 * R13.7). La transición de categoría la dispara el write-through+0064/0086 al SUBIR; el espejo C6 la
 * refleja AL TOQUE offline con el is_castrated real (R10.6/R13.6). La RLS (animal_profiles_update +
 * animal_events INSERT policy) es la barrera real al subir.
 *
 * Independencia (R10.2): si el UPDATE local tiene éxito y el INSERT falla (caso extremo: DB no booteada),
 * devolvemos error PERO el flip ya quedó local — coherente con el modelo N-mutaciones-independientes (el
 * caller re-fetchea; el reviewer/Gate 2 ven que no hay rollback de la exitosa). En la práctica los dos
 * writes locales tienen éxito offline (runLocalWrite solo falla si el execute local revienta).
 */
/**
 * Anticipa la CONSECUENCIA de flipear "Castrado Sí/No" en la ficha (R13.1): devuelve el `{ code, name }`
 * de la categoría a la que el animal pasaría al setear `is_castrated = nextValue`, para mostrarlo en la
 * confirmación ("La categoría se recalcula: Torito → Novillito"). SOLO LECTURA (display, RC6.3.5): espeja
 * `compute_category` (0062) con el is_castrated NUEVO vía `resolveCastrationTargetCategory` (puro) ⇒ el
 * destino anticipado es EXACTAMENTE el que el server computará al subir el UPDATE (write-through + 0064/
 * 0086 simétrico). Offline-safe (todo del SQLite local: detalle + eventos + catálogo).
 *
 * Devuelve `ok:true, value:null` (la UI omite la línea de consecuencia) cuando:
 *   - `category_override = true` → el server NO recalcula (override manda, R5.6);
 *   - sin `system_id` o el code destino no está en el catálogo local → irresoluble (fail-safe).
 * El flip en sí (R13.7: la observación automática) se aplica igual aunque acá no haya destino que anticipar.
 */
export async function previewCastrationCategory(
  profileId: string,
  nextValue: boolean,
): Promise<ServiceResult<DisplayCategory | null>> {
  // 1) Detalle local (sex, birth_date, system_id, category_override). emptyIsSyncing:false: "no
  //    encontrado" es un caso de negocio (el caller ya tiene el detalle; esto solo trae system_id + inputs).
  const detailRes = await runLocalQuerySingle<LocalDetailRow>(buildAnimalDetailQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!detailRes.ok) return { ok: false, error: detailRes.error };
  if (!detailRes.value) return { ok: true, value: null };
  const row = detailRes.value;
  const systemId = row.system_id ?? null;
  if (!systemId) return { ok: true, value: null }; // sin system_id no se resuelve code→name → sin anticipación

  // 2) Eventos reproductivos batched (synced + overlay) del perfil → inputs del espejo. Blando: si falla,
  //    no anticipamos (el flip real no depende de esto).
  const eventsRes = await runLocalQuery<{
    animal_profile_id: string;
    event_type: string;
    event_date: string;
    created_at: string | null;
    pregnancy_status: string | null;
  }>(buildCategoryMirrorEventsQuery([profileId]), { emptyIsSyncing: false });
  if (!eventsRes.ok) return { ok: true, value: null };
  const events: ReproEventInput[] = eventsRes.value.map((e) => ({
    eventType: e.event_type,
    eventDate: e.event_date,
    createdAt: e.created_at,
    pregnancyStatus: e.pregnancy_status,
  }));

  // 3) Catálogo code→name del sistema (local). Blando: si falla, no anticipamos.
  const catRes = await runLocalQuery<CategoryCatalogEntry>(buildSystemCategoriesQuery(systemId), {
    emptyIsSyncing: false,
  });
  if (!catRes.ok) return { ok: true, value: null };

  // 4) Decisión PURA: el destino con el is_castrated NUEVO (respeta override → null). null = sin anticipación.
  const target = resolveCastrationTargetCategory({
    sex: row.sex ?? 'female',
    birthDate: row.birth_date ?? null,
    categoryOverride: toBool(row.category_override),
    nextCastrated: nextValue,
    events,
    catalog: catRes.value,
  });
  return { ok: true, value: target };
}

export async function setCastrated(
  profileId: string,
  value: boolean,
): Promise<ServiceResult<true>> {
  // 1) establishment_id del PERFIL para la observación (NUNCA del contexto activo — el trigger 0034 valida
  //    que coincida con el del perfil). emptyIsSyncing:true: sin el perfil local aún, degradar a
  //    "Sincronizando" (no castrar a ciegas un perfil que no bajó).
  const estRes = await runLocalQuerySingle<{ establishment_id: string }>(
    buildProfileEstablishmentQuery(profileId),
    { emptyIsSyncing: true },
  );
  if (!estRes.ok) return { ok: false, error: { kind: estRes.error.kind, message: estRes.error.message } };
  if (!estRes.value) {
    return { ok: false, error: { kind: 'unknown', message: 'No se encontró el animal para registrar el cambio.' } };
  }
  const establishmentId = estRes.value.establishment_id;

  // 2) UPDATE de estado (is_castrated, + future_bull=0 si value=true). 1ra CrudEntry (PATCH).
  const updRes = await runLocalWrite(buildSetCastratedUpdate(profileId, value));
  if (!updRes.ok) return { ok: false, error: { kind: updRes.error.kind, message: updRes.error.message } };

  // 3) Observación automática (R13.7). 2da CrudEntry (PUT animal_events). author_id OMITIDO (el builder
  //    no lo manda; lo fuerza el trigger). Reusa el MISMO builder que addObservation (sin service nuevo).
  const obsRes = await runLocalWrite(
    buildAddObservationInsert(randomUuid(), profileId, establishmentId, castrationObservationText(value)),
  );
  if (!obsRes.ok) return { ok: false, error: { kind: obsRes.error.kind, message: obsRes.error.message } };

  return { ok: true, value: true };
}

/**
 * Marca / desmarca el flag ⭐ "futuro torito" desde la ficha (R12.2 / R12.4). UN solo UPDATE local de
 * future_bull (UNA CrudEntry). SIN observación automática (no es castración — design §3.3). El trigger
 * normalize 0085 lo lleva a false si el animal no es macho o está castrado (defensa server-side); el
 * cliente NO necesita replicar esa regla acá (la UI solo ofrece el toggle en machos no castrados). RLS al
 * subir.
 */
export async function setFutureBull(
  profileId: string,
  value: boolean,
): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(buildSetFutureBullUpdate(profileId, value));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
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

// ─── Transferencia de animal entre campos (spec 11, ONLINE-only) ─────────────────────────

export type { TransferAnimalInput, TransferAnimalResult } from './transfer-animal';

/**
 * Genera el `targetProfileId` (UUID estable) para una transferencia. El call-site debe GENERARLO UNA
 * vez por intent y PERSISTIRLO para el reintento del mismo intent (idempotencia, R6.2): si el ACK se
 * pierde, reintentar con el MISMO id hace que el RPC devuelva el resultado ya aplicado (replay) en vez
 * de crear un 2do perfil. NO regenerar el id en cada reintento.
 */
export function newTransferTargetProfileId(): string {
  return randomUuid();
}

/**
 * Transfiere un animal de un campo X a otro Y PRESERVANDO su historia, vía el RPC `transfer_animal`
 * (migración 0087, SECURITY DEFINER). El RPC: crea el perfil nuevo en Y (reusa el animal_id global) +
 * re-apunta TODA la historia del viejo al nuevo (con establishment_id→Y, aislando el wire de sync) +
 * archiva el viejo (status='transferred'), ATÓMICAMENTE.
 *
 * ONLINE-ONLY (R7.1): la transferencia toca datos de X que deben estar firmes (write cross-tenant,
 * análogo a crear-campo, spec 01 R9.2) → NO se encola offline. Fast-fail con `assertOnline` antes del
 * RPC: sin red devuelve un error `kind:'network'` accionable en vez de colgar la pantalla.
 *
 * El cliente NO arma el establishment_id de ORIGEN ni el animal_id: el RPC los deriva de la FILA REAL
 * del perfil de origen (anti-IDOR, R5.4). Authz server-side (la barrera real): destino Y = rol activo;
 * origen X = baja a paridad EXACTA con exit_animal_profile (has_role_in(X) AND owner-or-creator, R5.1).
 * Un rechazo (42501/23514/23503) se mapea a copy es-AR accionable SIN exponer el sqlerrm crudo.
 *
 * `targetProfileId` debe ser un UUID estable entre reintentos del mismo intent (idempotencia, R6.2);
 * usá `newTransferTargetProfileId()` UNA vez y persistilo. Si `idvDropped` viene true, la UI debe
 * avisar al operario que complete el idv (R2.5).
 */
export async function transferAnimal(
  input: TransferAnimalInput,
): Promise<ServiceResult<TransferAnimalResult>> {
  const off = assertOnline(TRANSFER_OFFLINE_MESSAGE);
  if (off) return off;

  const { data, error } = await supabase.rpc('transfer_animal', {
    p_source_profile_id: input.sourceProfileId,
    p_target_establishment_id: input.targetEstablishmentId,
    p_target_rodeo_id: input.targetRodeoId,
    p_target_profile_id: input.targetProfileId,
    p_target_category_id: input.targetCategoryId,
  });

  if (error) {
    return { ok: false, error: classifyTransferError(error) };
  }

  return { ok: true, value: mapTransferResult(data as TransferAnimalRpcRow | null, input.targetProfileId) };
}
