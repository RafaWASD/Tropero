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

import { supabase } from './supabase';
import { type AnimalSex } from '../utils/animal-category';
import { classifyIdentifier, classifySearchQuery } from '../utils/animal-identifier';

// ─── Error / Result uniforme (mismo shape que rodeo-config.ts / establishments.ts) ──

export type AppError = { kind: 'network' | 'duplicate_tag' | 'duplicate_idv' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

function classifyError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  // unique violation: distinguimos TAG (índice animals_tag_unique) de IDV (animal_profiles_idv_unique)
  // por el nombre del índice en el mensaje de Postgres, para un copy accionable (R4.8).
  if (code === '23505' || /duplicate key|unique/i.test(msg)) {
    if (/tag/i.test(msg)) {
      return { kind: 'duplicate_tag', message: 'Esa caravana electrónica ya está asignada a otro animal.' };
    }
    if (/idv/i.test(msg)) {
      return { kind: 'duplicate_idv', message: 'Ese número de caravana/IDV ya existe en este campo.' };
    }
    return { kind: 'unknown', message: 'Ese identificador ya existe.' };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

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
  rodeoId: string;
  rodeoName: string;
  managementGroupId: string | null;
  managementGroupName: string | null;
};

// ─── Filas crudas (shape de PostgREST) ──────────────────────────────────────────────

type ProfileListRow = {
  id: string;
  animal_id: string;
  idv: string | null;
  visual_id_alt: string | null;
  category_id: string;
  rodeo_id: string;
  status: AnimalStatus;
  animals: { tag_electronic: string | null; sex: AnimalSex } | null;
  rodeos: { name: string } | null;
  categories_by_system: { code: string; name: string } | null;
};

// SELECT compartido por fetchAnimals/searchAnimals (lista): join a animals (tag+sex), rodeo (name)
// y categoría (code+name). PostgREST resuelve los joins por FK. NO traemos campos sensibles extra.
const LIST_SELECT =
  'id, animal_id, idv, visual_id_alt, category_id, rodeo_id, status,' +
  ' animals!inner ( tag_electronic, sex ),' +
  ' rodeos!inner ( name ),' +
  ' categories_by_system!inner ( code, name )';

function toListItem(r: ProfileListRow): AnimalListItem {
  return {
    profileId: r.id,
    animalId: r.animal_id,
    idv: r.idv,
    visualIdAlt: r.visual_id_alt,
    tagElectronic: r.animals?.tag_electronic ?? null,
    categoryCode: r.categories_by_system?.code ?? '',
    categoryName: r.categories_by_system?.name ?? '',
    sex: r.animals?.sex ?? 'female',
    rodeoId: r.rodeo_id,
    rodeoName: r.rodeos?.name ?? '',
    status: r.status,
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
 * Lista los animal_profiles del establishment activo (R1.1), con filtros opcionales (R1.5). RLS
 * scopea por has_role_in(establishment_id) + deleted_at is null. Filtramos también por
 * establishment_id explícito (defensa en profundidad + claridad; la RLS es la barrera real).
 *
 * Orden: created_at desc (más reciente arriba, consistente con el mock que reemplaza).
 * Límite 200 (la tab es de lectura rápida; paginación/virtualización es refinamiento posterior).
 */
export async function fetchAnimals(
  establishmentId: string,
  filter: FetchAnimalsFilter = {},
): Promise<ServiceResult<AnimalListItem[]>> {
  let query = supabase
    .from('animal_profiles')
    .select(LIST_SELECT)
    .eq('establishment_id', establishmentId)
    .is('deleted_at', null);

  // Estado: por default solo activos (la tab Animales muestra el rodeo vivo). Un filtro explícito
  // (sold/dead/transferred) lo sobreescribe.
  query = query.eq('status', filter.status ?? 'active');

  if (filter.rodeoId) {
    query = query.eq('rodeo_id', filter.rodeoId);
  }
  if (filter.noTag) {
    // "sin caravana" = animals.tag_electronic IS NULL. El filtro va sobre la tabla embebida.
    query = query.is('animals.tag_electronic', null);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as unknown as ProfileListRow[];
  return { ok: true, value: rows.map(toListItem) };
}

// ─── Conteo liviano (home: paso "Cargá tu primer animal" por estado real) ────────────

/**
 * Cuenta los animales ACTIVOS del establishment activo, sin traer filas (head:true → solo el
 * count del header `Content-Range`). Lo usa la home para drivear el paso "Cargá tu primer animal"
 * del Stepper de primeros pasos por estado REAL (en vez de hardcodearlo siempre pendiente).
 *
 * Scope: establishment activo + status 'active' + deleted_at null (consistente con la tab Animales,
 * que muestra el rodeo vivo). RLS (has_role_in) es la barrera real (R11 spec 02 / R10.2 spec 09): el
 * cliente NO fuerza permisos; el `.eq('establishment_id', …)` es defensa en profundidad + claridad.
 * NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6): viene del contexto activo.
 */
export async function countAnimals(
  establishmentId: string,
): Promise<ServiceResult<number>> {
  const { count, error } = await supabase
    .from('animal_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('establishment_id', establishmentId)
    .eq('status', 'active')
    .is('deleted_at', null);

  if (error) return { ok: false, error: classifyError(error) };
  // head:true devuelve count en el header; si por algún motivo es null, asumimos 0 (no hay filas).
  return { ok: true, value: count ?? 0 };
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

  // 1) TAG exacto (animals.tag_electronic) — solo si el texto tiene forma de caravana FDX-B.
  //    Priorizado arriba: un escaneo exacto de 15 díg es el match más fuerte.
  if (plan.tryTag) {
    const { data, error } = await supabase
      .from('animal_profiles')
      .select(LIST_SELECT)
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .eq('animals.tag_electronic', plan.compact)
      .limit(20);
    if (error) return { ok: false, error: classifyError(error) };
    pushRows(data as unknown as ProfileListRow[], seen, out);
  }

  // 2) IDV exacto (animal_profiles.idv) — solo si el texto es numérico. Priorizado sobre el
  //    substring (el operario que tipea el IDV completo ve su animal primero).
  if (plan.tryIdv) {
    const { data, error } = await supabase
      .from('animal_profiles')
      .select(LIST_SELECT)
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .eq('idv', plan.compact)
      .limit(20);
    if (error) return { ok: false, error: classifyError(error) };
    pushRows(data as unknown as ProfileListRow[], seen, out);
  }

  // 3) Substring numérico (ilike PARCIAL) sobre idv Y tag_electronic — fix-loop 2: tipear "03200"
  //    (prefijo/fragmento de una caravana o IDV) debe ENCONTRAR los animales que lo contengan, no
  //    solo el match exacto. Son DOS sub-queries (una por columna) en vez de un `or` cross-tabla:
  //    PostgREST no combina en un solo `or` una columna de la tabla base (idv) con una de la tabla
  //    embebida (animals.tag_electronic); separarlas es simple y el dedup por profileId las une.
  //    El `escapeIlike` neutraliza los comodines `%`/`_` del término del usuario (defensa, R11/R10.2).
  //    Perf (documentado, no bloquea MVP): el substring ilike no usa el índice exacto → full scan
  //    DENTRO del set ya scopeado por establishment+status+deleted_at (RLS) + limit 20; aceptable
  //    para rodeos de cientos. Un índice trigram sobre idv/tag es refinamiento posterior.
  if (plan.tryNumericSubstring) {
    const pattern = `%${escapeIlike(plan.compact)}%`;

    // 3a) substring sobre animal_profiles.idv (columna de la tabla base).
    const idvRes = await supabase
      .from('animal_profiles')
      .select(LIST_SELECT)
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .ilike('idv', pattern)
      .limit(20);
    if (idvRes.error) return { ok: false, error: classifyError(idvRes.error) };
    pushRows(idvRes.data as unknown as ProfileListRow[], seen, out);

    // 3b) substring sobre animals.tag_electronic (columna de la tabla embebida, inner-join).
    const tagRes = await supabase
      .from('animal_profiles')
      .select(LIST_SELECT)
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .ilike('animals.tag_electronic', pattern)
      .limit(20);
    if (tagRes.error) return { ok: false, error: classifyError(tagRes.error) };
    pushRows(tagRes.data as unknown as ProfileListRow[], seen, out);
  }

  // 4) visual_id_alt fuzzy (GIN trigram, similarity ≥ 0.3 por el operador % default). El server
  //    ordena por similarity desc. Usamos ilike como red adicional (substring) unido por OR para
  //    que "112" matchee "112" exacto aunque el % trigram no lo prenda en textos muy cortos.
  if (plan.tryVisual) {
    const term = plan.normalized;
    // F1-1 (R7.1, forma parametrizada — preferida): `.ilike(column, pattern)` envía el patrón
    // como VALOR (fuera del string de filtro), no como un fragmento de `.or(...)`. Esto neutraliza
    // de RAÍZ el filter injection de los metacaracteres de `.or()` (`. ( ) : *` y comillas): un
    // término malicioso ya no puede alterar la estructura del filtro ni cruzar a otra columna.
    // Como esta sub-query filtra UNA sola columna (visual_id_alt), no necesita `.or()`. El
    // `escapeIlike` se conserva solo para los comodines `% _` del PATRÓN de ilike (que un `%`
    // literal del término no actúe de comodín), no para los metacaracteres de `.or()` (que ya no
    // aplican). El recorte de largo del término ya lo hizo classifySearchQuery (R7.3).
    const { data, error } = await supabase
      .from('animal_profiles')
      .select(LIST_SELECT)
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .ilike('visual_id_alt', `%${escapeIlike(term)}%`)
      .limit(20);
    if (error) return { ok: false, error: classifyError(error) };
    pushRows(data as unknown as ProfileListRow[], seen, out);
  }

  return { ok: true, value: out };
}

function pushRows(
  rows: ProfileListRow[] | null,
  seen: Set<string>,
  out: AnimalListItem[],
): void {
  for (const r of rows ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(toListItem(r));
  }
}

// PostgREST `or`/`ilike` usa `%`/`_` como comodines; escapamos los del término del usuario para
// que un visual_id_alt con "%" no rompa el patrón. (Defensivo; visual_id_alt rara vez los tiene.)
function escapeIlike(term: string): string {
  return term.replace(/[%_,]/g, ' ');
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
 * `systemId` del rodeo elegido) — el picker CERRADO de la alta guiada (paso 3). SELECT abierto a
 * authenticated (catálogo global, mismo patrón que field_definitions). Multi-tenant (CLAUDE.md
 * ppio 6): NUNCA se hardcodea el systemId ni los codes — salen del sistema del rodeo activo.
 *
 * No filtra por sexo (la tabla no tiene columna de sexo): el filtrado por sexo lo hace el cliente
 * con el mapeo conocido por `code` (codes fijos del catálogo de cría). Devuelve todas las del
 * sistema; el screen las filtra. Orden por sort_order (presentación estable del catálogo).
 */
export async function fetchSystemCategories(
  systemId: string,
): Promise<ServiceResult<SystemCategory[]>> {
  const { data, error } = await supabase
    .from('categories_by_system')
    .select('code, name')
    .eq('system_id', systemId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as CategoryRow[];
  return { ok: true, value: rows.map((r) => ({ code: r.code, name: r.name })) };
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
  // 1) Resolver category_id por el code ELEGIDO (catálogo del system del rodeo). No hardcodeamos
  //    UUID; el code viene del picker (paso 3 del wizard), que lo sacó de fetchSystemCategories.
  const { data: cat, error: catErr } = await supabase
    .from('categories_by_system')
    .select('id')
    .eq('system_id', input.systemId)
    .eq('code', input.categoryCode)
    .eq('active', true)
    .maybeSingle();
  if (catErr) return { ok: false, error: classifyError(catErr) };
  if (!cat) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo determinar la categoría del animal.' },
    };
  }

  // 2) Resolver species_id del rodeo (animals.species_id NOT NULL). Lo leemos del rodeo elegido
  //    (no hardcodeamos bovino: lo deriva del rodeo, que ya validó su species/system en C1).
  const { data: rodeo, error: rErr } = await supabase
    .from('rodeos')
    .select('species_id')
    .eq('id', input.rodeoId)
    .maybeSingle();
  if (rErr) return { ok: false, error: classifyError(rErr) };
  if (!rodeo) {
    return { ok: false, error: { kind: 'unknown', message: 'El rodeo seleccionado ya no está disponible.' } };
  }

  // 3) Insert animals (id generado en cliente). Solo seteamos TAG si vino (NULL si no — R4.2 ya
  //    cubierto por idv/visual). birth_date opcional.
  const animalId = randomUuid();
  const animalPayload: Record<string, unknown> = {
    id: animalId,
    sex: input.sex,
    species_id: rodeo.species_id,
  };
  const tag = cleanStr(input.tagElectronic);
  if (tag) animalPayload.tag_electronic = tag;
  if (input.birthDate) animalPayload.birth_date = input.birthDate;

  const { error: aErr } = await supabase.from('animals').insert(animalPayload);
  if (aErr) return { ok: false, error: classifyError(aErr) };

  // 4) Insert animal_profiles (id generado en cliente). category_id NOT NULL (computado arriba).
  const profileId = randomUuid();
  const profilePayload: Record<string, unknown> = {
    id: profileId,
    animal_id: animalId,
    establishment_id: input.establishmentId,
    rodeo_id: input.rodeoId,
    category_id: cat.id,
    // Override de la categoría elegida (alta guiada A #4): si difiere de la computada por sexo+edad,
    // se preserva (true) y el recálculo del server no la revierte; si coincide, false (auto-transiciona).
    category_override: input.categoryOverride,
    status: 'active',
  };
  const idv = cleanStr(input.idv);
  const visual = cleanStr(input.visualIdAlt);
  if (idv) profilePayload.idv = idv;
  if (visual) profilePayload.visual_id_alt = visual;
  const breed = cleanStr(input.breed);
  if (breed) profilePayload.breed = breed;
  const coat = cleanStr(input.coatColor);
  if (coat) profilePayload.coat_color = coat;
  if (input.entryDate) profilePayload.entry_date = input.entryDate;
  if (input.entryWeight != null) profilePayload.entry_weight = input.entryWeight;
  if (input.managementGroupId) profilePayload.management_group_id = input.managementGroupId;
  // Datos por categoría (sub-chunk B): dientes (enum) + cría al pie (boolean). Solo se setean si el
  // caller los mandó (la alta guiada los manda solo para las categorías que los piden). teeth_state
  // viene de un selector CERRADO → enum válido. nursing en INSERT NO lo pisa el trigger (AFTER INSERT
  // sobre reproductive_events/birth_calves, no sobre animal_profiles).
  const teeth = cleanStr(input.teethState);
  if (teeth) profilePayload.teeth_state = teeth;
  if (input.nursing != null) profilePayload.nursing = input.nursing;

  const { error: pErr } = await supabase.from('animal_profiles').insert(profilePayload);
  if (pErr) return { ok: false, error: classifyError(pErr) };

  return { ok: true, value: { profileId, animalId } };
}

// ─── Detalle para la ficha básica (R5 — versión básica de C2) ─────────────────────────

type ProfileDetailRow = {
  id: string;
  animal_id: string;
  establishment_id: string;
  idv: string | null;
  visual_id_alt: string | null;
  category_id: string;
  category_override: boolean;
  breed: string | null;
  coat_color: string | null;
  entry_date: string | null;
  entry_weight: number | null;
  status: AnimalStatus;
  rodeo_id: string;
  management_group_id: string | null;
  animals: { tag_electronic: string | null; sex: AnimalSex; birth_date: string | null } | null;
  rodeos: { name: string } | null;
  categories_by_system: { code: string; name: string } | null;
  management_groups: { name: string } | null;
};

/**
 * Lee el detalle de un animal_profile para la ficha básica (C2): identidad + atributos + rodeo +
 * categoría + lote. RLS scopea por has_role_in (animal_profiles_select). El timeline + eventos son
 * C3 (NO se traen acá). El lote (management_groups) puede estar soft-deleted → el join `left` lo
 * trae igual si la fila existe (la UI muestra "sin lote" si management_group_id es null).
 */
export async function fetchAnimalDetail(profileId: string): Promise<ServiceResult<AnimalDetail>> {
  const { data, error } = await supabase
    .from('animal_profiles')
    .select(
      'id, animal_id, establishment_id, idv, visual_id_alt, category_id, category_override, breed, coat_color,' +
        ' entry_date, entry_weight, status, rodeo_id, management_group_id,' +
        ' animals!inner ( tag_electronic, sex, birth_date ),' +
        ' rodeos!inner ( name ),' +
        ' categories_by_system!inner ( code, name ),' +
        ' management_groups ( name )',
    )
    .eq('id', profileId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return { ok: false, error: classifyError(error) };
  if (!data) {
    return { ok: false, error: { kind: 'unknown', message: 'No se encontró el animal. Puede que ya no tengas acceso.' } };
  }
  const r = data as unknown as ProfileDetailRow;
  return {
    ok: true,
    value: {
      profileId: r.id,
      animalId: r.animal_id,
      establishmentId: r.establishment_id,
      idv: r.idv,
      visualIdAlt: r.visual_id_alt,
      tagElectronic: r.animals?.tag_electronic ?? null,
      sex: r.animals?.sex ?? 'female',
      birthDate: r.animals?.birth_date ?? null,
      categoryCode: r.categories_by_system?.code ?? '',
      categoryName: r.categories_by_system?.name ?? '',
      categoryOverride: r.category_override,
      breed: r.breed,
      coatColor: r.coat_color,
      entryDate: r.entry_date,
      entryWeight: r.entry_weight,
      status: r.status,
      rodeoId: r.rodeo_id,
      rodeoName: r.rodeos?.name ?? '',
      managementGroupId: r.management_group_id,
      managementGroupName: r.management_groups?.name ?? null,
    },
  };
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
